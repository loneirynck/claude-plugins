#!/usr/bin/env npx tsx
/**
 * Scrape HubSpot CRM contacts into PLI via BrightData.
 *
 * Tier 1 (default): Contacts with LinkedIn URLs → BrightData → PLI
 * Tier 2 (--mode tier2): Contacts with name+company but no LinkedIn URL
 *   → Serper discovery → BrightData → PLI
 *
 * Uses the same vmid derivation as handle_bd_person_result():
 *   vmid = left(COALESCE(linkedin_num_id, sha256_hex(url)), 16)
 *
 * Usage:
 *   npx tsx scripts/enrich-hubspot-contacts.ts --profile conveo [--limit 10] [--dry-run]
 *   npx tsx scripts/enrich-hubspot-contacts.ts --profile conveo --mode tier2 --dry-run
 *   npx tsx scripts/enrich-hubspot-contacts.ts --profile conveo --mode tier2 --limit 20
 *   npx tsx scripts/enrich-hubspot-contacts.ts --profile conveo --batch-start 5 --batch-end 10
 */

import { loadSettings } from "../../shared/settings.js";
import { createHash } from "crypto";
import pg from "pg";
import { ScriptRun } from "./ops-logger.js";

const { Pool } = pg;
const BD_PERSON_DATASET = "gd_l1viktl72bvl7bjuj0";
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 60;
const BATCH_SIZE = 100;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  return {
    profile: get("--profile") || "conveo",
    mode: (get("--mode") || "tier1") as "tier1" | "tier2" | "tier2b",
    limit: get("--limit") ? Number(get("--limit")) : undefined,
    dryRun: args.includes("--dry-run"),
    batchStart: get("--batch-start") ? Number(get("--batch-start")) : 0,
    batchEnd: get("--batch-end") ? Number(get("--batch-end")) : undefined,
  };
}

async function resolveBrightDataKey(pool: pg.Pool): Promise<string> {
  if (process.env.BRIGHTDATA_API_KEY) return process.env.BRIGHTDATA_API_KEY;
  const { rows } = await pool.query(
    "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BRIGHTDATA_API_KEY' LIMIT 1"
  );
  if (rows[0]?.decrypted_secret) return rows[0].decrypted_secret;
  throw new Error("No BRIGHTDATA_API_KEY found in env var or vault");
}

async function resolveSerperKey(pool: pg.Pool): Promise<string> {
  if (process.env.SERPER_API_KEY) return process.env.SERPER_API_KEY;
  const { rows } = await pool.query(
    "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERPER_API_KEY' LIMIT 1"
  );
  if (rows[0]?.decrypted_secret) return rows[0].decrypted_secret;
  throw new Error("No SERPER_API_KEY found in env var or vault");
}

async function discoverLinkedInUrl(
  serperKey: string,
  firstname: string,
  lastname: string,
  company: string
): Promise<string | null> {
  const query = `"${firstname} ${lastname}" "${company}" site:linkedin.com/in`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: 3 }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      for (const result of data.organic || []) {
        const link = result.link || "";
        if (link.match(/linkedin\.com\/in\/[^/?]+/i)) return link;
      }
      return null;
    } catch (err: any) {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      return null;
    }
  }
  return null;
}

async function triggerDataset(apiKey: string, datasetId: string, inputs: Record<string, string>[]): Promise<string> {
  const res = await fetch(
    `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${datasetId}&include_errors=true`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(inputs),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BrightData trigger failed (${res.status}): ${text}`);
  }
  const { snapshot_id } = await res.json();
  return snapshot_id;
}

async function pollSnapshot(apiKey: string, snapshotId: string): Promise<any[]> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const res = await fetch(
      `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    if (res.status === 200) return res.json();
    if (res.status === 202) {
      console.log(`  Polling... attempt ${i + 1}/${MAX_POLL_ATTEMPTS}`);
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    const text = await res.text();
    throw new Error(`Poll failed (${res.status}): ${text}`);
  }
  throw new Error("Polling timed out");
}

function normalizeLinkedInSlug(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([^/?]+)/i);
  return match ? match[1].toLowerCase().replace(/\/+$/, "") : null;
}

/** Derive vmid exactly like handle_bd_person_result():
 *  left(COALESCE(linkedin_num_id, sha256_hex(lower(url))), 16) */
function deriveVmid(result: any): string | null {
  const linkedinNumId = result.linkedin_num_id;
  if (linkedinNumId) return String(linkedinNumId).substring(0, 16);

  const url = result.url || result.input_url || "";
  if (!url) return null;
  const hash = createHash("sha256").update(url.toLowerCase()).digest("hex");
  return hash.substring(0, 16);
}

async function main() {
  const opts = parseArgs();
  const settings = loadSettings(opts.profile);
  const pool = new Pool(settings.pg);

  const run = new ScriptRun(pool, "enrichment_enrich_hubspot_contacts");

  try {
    const bdKey = await resolveBrightDataKey(pool);
    const isTier2 = opts.mode === "tier2" || opts.mode === "tier2b";
    const queryTag = isTier2 ? `hubspot:crm-enrichment-${opts.mode}` : "hubspot:crm-enrichment";

    // Find HubSpot contacts based on mode
    const limitClause = opts.limit ? `LIMIT ${opts.limit}` : "";
    let contacts: { hs_id: string; linkedin_url: string | null; firstname: string; lastname: string; company: string }[];

    if (isTier2) {
      // Tier 2: name + company, no LinkedIn URL, not in PLI
      const serperKey = opts.dryRun ? "" : await resolveSerperKey(pool);
      const { rows } = await pool.query(`
        SELECT h.id as hs_id, NULL as linkedin_url,
               h.properties_firstname as firstname, h.properties_lastname as lastname,
               COALESCE(
                 NULLIF(h.properties_company, ''),
                 co.properties_name,
                 co.properties_domain
               ) as company
        FROM hubspot.contacts h
        LEFT JOIN hubspot.companies co
          ON h.properties_associatedcompanyid IS NOT NULL
          AND h.properties_associatedcompanyid != 0
          AND co.id = h.properties_associatedcompanyid::text
        WHERE h.properties_firstname IS NOT NULL AND LENGTH(h.properties_firstname) > 2
          AND h.properties_lastname IS NOT NULL AND LENGTH(h.properties_lastname) > 2
          AND COALESCE(NULLIF(h.properties_company, ''), co.properties_name, co.properties_domain) IS NOT NULL
          AND LENGTH(COALESCE(NULLIF(h.properties_company, ''), co.properties_name, co.properties_domain)) > 3
          AND COALESCE(NULLIF(h.properties_company, ''), co.properties_name, co.properties_domain) !~ '^[\-_\.\s"]+$'
          ${opts.mode === "tier2" ? "AND h.properties_jobtitle IS NOT NULL AND h.properties_jobtitle != ''" : ""}
          AND (h.properties_hs_linkedin_url IS NULL OR h.properties_hs_linkedin_url = '')
          AND (h.properties_jobtitle IS NULL OR h.properties_jobtitle NOT ILIKE '%student%')
          AND COALESCE(NULLIF(h.properties_company, ''), co.properties_name, co.properties_domain) NOT ILIKE '%demo%'
          AND COALESCE(NULLIF(h.properties_company, ''), co.properties_name, co.properties_domain) NOT ILIKE '%university%'
          AND COALESCE(NULLIF(h.properties_company, ''), co.properties_name, co.properties_domain) NOT ILIKE '%college%'
          AND NOT EXISTS (
            SELECT 1 FROM public.pli p WHERE p.hubspot_contact_id = h.id::bigint
          )
          AND NOT EXISTS (
            SELECT 1 FROM core.enrichment_log el
            WHERE el.source_table = 'hubspot.contacts'
              AND el.source_id = h.id::text
              AND el.script = 'enrich-hubspot-contacts'
          )
        ORDER BY h."updatedAt" DESC
        ${limitClause}
      `);
      contacts = rows;
      console.log(`[TIER 2] Found ${contacts.length} HubSpot contacts (name+company, no LinkedIn URL)`);

      if (contacts.length > 0 && !opts.dryRun) {
        // Serper discovery: find LinkedIn URLs (concurrent batches of 10)
        const SERPER_CONCURRENCY = 10;
        console.log(`\n--- Serper LinkedIn URL Discovery (concurrency: ${SERPER_CONCURRENCY}) ---`);
        let serperFound = 0;
        let serperMissed = 0;
        for (let i = 0; i < contacts.length; i += SERPER_CONCURRENCY) {
          const chunk = contacts.slice(i, i + SERPER_CONCURRENCY);
          const results = await Promise.all(
            chunk.map(c => discoverLinkedInUrl(serperKey, c.firstname, c.lastname, c.company))
          );
          for (let j = 0; j < chunk.length; j++) {
            const idx = i + j;
            if (results[j]) {
              chunk[j].linkedin_url = results[j];
              serperFound++;
              if (idx < 20 || idx % 200 === 0) console.log(`  ✓ ${chunk[j].firstname} ${chunk[j].lastname} (${chunk[j].company}) → ${results[j]}`);
            } else {
              serperMissed++;
              if (idx < 20) console.log(`  ✗ ${chunk[j].firstname} ${chunk[j].lastname} (${chunk[j].company}) — no LinkedIn found`);
            }
          }
          if (i % 200 === 0 && i > 0) console.log(`  ... ${i}/${contacts.length} processed (${serperFound} found)`);
        }
        console.log(`\nSerper results: ${serperFound} found, ${serperMissed} missed`);

        // Log all attempted HubSpot contact IDs to core.enrichment_log
        if (contacts.length > 0) {
          const rows = contacts.map(c => `('hubspot.contacts', '${c.hs_id}', 'enrich-hubspot-contacts', NOW(), '${c.linkedin_url ? 'found' : 'not_found'}')`);
          await pool.query(`
            INSERT INTO core.enrichment_log (source_table, source_id, script, attempted_at, result)
            VALUES ${rows.join(', ')}
            ON CONFLICT (source_table, source_id, script) DO NOTHING
          `);
          console.log(`Logged ${contacts.length} attempts to core.enrichment_log`);
        }

        // Filter to only contacts where Serper found a URL
        contacts = contacts.filter(c => c.linkedin_url != null);
        console.log(`Proceeding with ${contacts.length} contacts to BrightData`);

        // Dedup: remove contacts whose discovered URL already exists in PLI
        if (contacts.length > 0) {
          // Dedup: remove contacts whose discovered URL already exists in PLI
          const { rows: existing } = await pool.query(`
            SELECT LOWER(REGEXP_REPLACE(linkedinprofileurl, '.*linkedin\\.com/in/([^/?]+).*', '\\1')) as slug
            FROM public.pli
            WHERE linkedinprofileurl IS NOT NULL
          `);
          const existingSlugs = new Set(existing.map(r => r.slug));
          const before = contacts.length;
          contacts = contacts.filter(c => {
            const slug = normalizeLinkedInSlug(c.linkedin_url!);
            return slug && !existingSlugs.has(slug);
          });
          if (before !== contacts.length) {
            console.log(`Dedup: removed ${before - contacts.length} already in PLI, ${contacts.length} remaining`);
          }
        }
      }
    } else {
      // Tier 1: contacts with LinkedIn URLs
      const { rows } = await pool.query(`
        SELECT h.id as hs_id, h.properties_hs_linkedin_url as linkedin_url,
               h.properties_firstname as firstname, h.properties_lastname as lastname,
               h.properties_company as company
        FROM hubspot.contacts h
        WHERE h.properties_hs_linkedin_url IS NOT NULL
          AND h.properties_hs_linkedin_url != ''
          AND h.properties_hs_linkedin_url LIKE '%/in/%'
          AND NOT EXISTS (
            SELECT 1 FROM public.pli p
            WHERE p.linkedinprofileurl IS NOT NULL
              AND LOWER(REGEXP_REPLACE(p.linkedinprofileurl, '.*linkedin\\.com/in/([^/?]+).*', '\\1'))
                = LOWER(REGEXP_REPLACE(h.properties_hs_linkedin_url, '.*linkedin\\.com/in/([^/?]+).*', '\\1'))
          )
        ORDER BY h.id
        ${limitClause}
      `);
      contacts = rows;
      console.log(`[TIER 1] Found ${contacts.length} HubSpot contacts with LinkedIn URLs not yet in PLI`);
    }

    await run.start({ profile: opts.profile, mode: opts.mode, limit: opts.limit, contactCount: contacts.length });

    if (contacts.length === 0) {
      await run.complete({ recordsProcessed: 0, recordsSucceeded: 0, recordsFailed: 0 });
      return;
    }

    if (opts.dryRun) {
      console.log("\n[DRY RUN] Would scrape:");
      contacts.slice(0, 20).forEach(r =>
        console.log(`  ${r.firstname} ${r.lastname} (${r.company}) — ${r.linkedin_url || "(needs Serper)"}`)
      );
      if (contacts.length > 20) console.log(`  ... and ${contacts.length - 20} more`);
      console.log(`\nTotal batches: ${Math.ceil(contacts.length / BATCH_SIZE)}`);
      return;
    }

    let totalInserted = 0;
    let totalFailed = 0;
    const allBatches: typeof contacts[] = [];

    for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
      allBatches.push(contacts.slice(i, i + BATCH_SIZE));
    }

    const startBatch = opts.batchStart;
    const endBatch = opts.batchEnd ?? allBatches.length;
    const batchesToProcess = allBatches.slice(startBatch, endBatch);

    console.log(`Processing batches ${startBatch + 1} to ${startBatch + batchesToProcess.length} of ${allBatches.length}`);

    for (let bIdx = 0; bIdx < batchesToProcess.length; bIdx++) {
      const batch = batchesToProcess[bIdx];
      const batchNum = startBatch + bIdx + 1;
      console.log(`\nBatch ${batchNum}/${allBatches.length}: ${batch.length} contacts`);

      // Normalize URLs for BrightData
      const inputs = batch.map(c => {
        let url = c.linkedin_url!;
        if (!url.startsWith("http")) url = `https://${url}`;
        url = url.replace(/https?:\/\/(www\.)?linkedin\.com/, "https://www.linkedin.com");
        url = url.replace(/\/+$/, "");
        return { url };
      });

      try {
        const snapshotId = await triggerDataset(bdKey, BD_PERSON_DATASET, inputs);
        console.log(`  Snapshot: ${snapshotId}`);

        const results = await pollSnapshot(bdKey, snapshotId);
        console.log(`  Got ${results.length} results`);

        for (const result of results) {
          if (result.error) {
            totalFailed++;
            continue;
          }

          // Derive vmid same as DB callback
          const vmid = deriveVmid(result);
          if (!vmid) {
            totalFailed++;
            continue;
          }

          // Find matching HubSpot contact by slug
          const resultUrl = result.url || result.input_url || "";
          const resultSlug = normalizeLinkedInSlug(resultUrl);
          const contact = batch.find(c => c.linkedin_url && normalizeLinkedInSlug(c.linkedin_url) === resultSlug);
          if (!contact) {
            totalFailed++;
            continue;
          }

          // Parse name — same as callback
          const name = result.name || `${contact.firstname || ""} ${contact.lastname || ""}`.trim() || null;
          const firstName = result.first_name || (name ? name.split(" ")[0] : null);
          const lastName = result.last_name || (name && name.includes(" ") ? name.substring(name.indexOf(" ") + 1) : null);

          // Parse company_id — guard against NaN which breaks bigint insert
          let companyId: number | null = null;
          const rawCompanyId = result.current_company_company_id || result.current_company?.company_id;
          if (rawCompanyId) {
            const parsed = parseInt(String(rawCompanyId), 10);
            if (!isNaN(parsed)) companyId = parsed;
          }

          // Title = first line of about (matching callback convention)
          const title = result.about
            ? result.about.split("\n")[0].substring(0, 500)
            : null;

          const linkedinProfileUrl = resultUrl
            ? resultUrl.toLowerCase().replace(/[?#].*$/, "")
            : null;

          const companyName = result.current_company_name || result.current_company?.name || contact.company || null;
          const companyUrl = result.current_company?.link || null;
          const location = result.city || result.location || null;
          const rawConn = result.connections;
          const connections = rawConn ? (isNaN(parseInt(String(rawConn), 10)) ? null : parseInt(String(rawConn), 10)) : null;
          const avatar = result.avatar || null;

          try {
            // Upsert with COALESCE merge — same as callback 'upsert' mode
            await pool.query(`
              INSERT INTO public.pli (
                vmid, firstname, lastname, fullname, name,
                title, summary,
                companyname, companyurl, company_id,
                profileurl, linkedinprofileurl, profileimageurl,
                location, sharedconnectionscount,
                query, timestamp
              ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7,
                $8, $9, $10,
                $11, $12, $13,
                $14, $15,
                $16, NOW()
              )
              ON CONFLICT (vmid) DO UPDATE SET
                firstname              = COALESCE(EXCLUDED.firstname, pli.firstname),
                lastname               = COALESCE(EXCLUDED.lastname, pli.lastname),
                fullname               = COALESCE(EXCLUDED.fullname, pli.fullname),
                name                   = COALESCE(EXCLUDED.name, pli.name),
                title                  = COALESCE(EXCLUDED.title, pli.title),
                summary                = COALESCE(EXCLUDED.summary, pli.summary),
                companyname            = COALESCE(EXCLUDED.companyname, pli.companyname),
                companyurl             = COALESCE(EXCLUDED.companyurl, pli.companyurl),
                company_id             = COALESCE(EXCLUDED.company_id, pli.company_id),
                profileurl             = COALESCE(EXCLUDED.profileurl, pli.profileurl),
                linkedinprofileurl     = COALESCE(EXCLUDED.linkedinprofileurl, pli.linkedinprofileurl),
                profileimageurl        = COALESCE(EXCLUDED.profileimageurl, pli.profileimageurl),
                location               = COALESCE(EXCLUDED.location, pli.location),
                sharedconnectionscount = COALESCE(EXCLUDED.sharedconnectionscount, pli.sharedconnectionscount),
                timestamp              = EXCLUDED.timestamp
            `, [
              vmid,
              firstName,
              lastName,
              name,
              name,
              title,
              result.about || null,
              companyName,
              companyUrl,
              companyId,
              resultUrl || null,
              linkedinProfileUrl,
              avatar,
              location,
              connections,
              queryTag,
            ]);
            totalInserted++;
            console.log(`  ✓ ${name || vmid}`);
          } catch (err: any) {
            console.log(`  ✗ ${name || vmid}: ${err.message}`);
            totalFailed++;
          }
        }
      } catch (err: any) {
        console.error(`  Batch ${batchNum} failed: ${err.message}`);
        totalFailed += batch.length;
      }
    }

    // Step 2: Link hubspot_contact_id for all newly inserted records
    console.log("\n--- Linking HubSpot contact IDs ---");
    // Use DISTINCT ON to avoid duplicate hubspot_contact_id constraint violations
    const { rowCount: linked } = await pool.query(`
      UPDATE public.pli p
      SET hubspot_contact_id = sub.hs_id,
          updated_at = NOW()
      FROM (
        SELECT DISTINCT ON (h.id) h.id::bigint as hs_id, p2.vmid
        FROM hubspot.contacts h
        JOIN public.pli p2 ON p2.linkedinprofileurl IS NOT NULL
          AND LOWER(REGEXP_REPLACE(p2.linkedinprofileurl, '.*linkedin\\.com/in/([^/?]+).*', '\\1'))
            = LOWER(REGEXP_REPLACE(h.properties_hs_linkedin_url, '.*linkedin\\.com/in/([^/?]+).*', '\\1'))
        WHERE p2.hubspot_contact_id IS NULL
          AND h.properties_hs_linkedin_url IS NOT NULL
          AND h.properties_hs_linkedin_url != ''
          AND NOT EXISTS (SELECT 1 FROM public.pli ex WHERE ex.hubspot_contact_id = h.id::bigint)
        ORDER BY h.id, p2.updated_at DESC
      ) sub
      WHERE p.vmid = sub.vmid
    `);
    console.log(`Linked ${linked} PLI records to HubSpot contact IDs`);

    await run.complete({
      recordsProcessed: batchesToProcess.reduce((sum, b) => sum + b.length, 0),
      recordsSucceeded: totalInserted,
      recordsFailed: totalFailed,
    });

    console.log(`\n=== HUBSPOT ENRICHMENT SUMMARY ===`);
    console.log(`Scraped & inserted: ${totalInserted}`);
    console.log(`Failed: ${totalFailed}`);
    console.log(`HubSpot IDs linked: ${linked}`);

    const { rows: [linkCount] } = await pool.query(
      "SELECT COUNT(*) as count FROM public.pli WHERE hubspot_contact_id IS NOT NULL"
    );
    console.log(`\nTotal PLI with hubspot_contact_id: ${linkCount.count}`);

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
