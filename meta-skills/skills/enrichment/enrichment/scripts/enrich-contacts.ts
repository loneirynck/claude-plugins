#!/usr/bin/env npx tsx
/**
 * Enrich PLI contacts via BrightData LinkedIn Person Profile dataset.
 * Requires contacts to have linkedinprofileurl set (run discover-urls first).
 *
 * Usage: npx tsx scripts/enrich-contacts.ts --profile nodewin [--limit 100] [--dry-run]
 */

import { loadSettings } from "../../shared/settings.js";
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
    profile: get("--profile") || "nodewin",
    limit: Number(get("--limit") || "200"),
    dryRun: args.includes("--dry-run"),
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

async function main() {
  const opts = parseArgs();
  const settings = loadSettings(opts.profile);
  const pool = new Pool(settings.pg);

  const run = new ScriptRun(pool, "enrichment_enrich_contacts");

  try {
    const bdKey = await resolveBrightDataKey(pool);

    // Load contacts with LinkedIn URL but missing profile data
    const { rows: contacts } = await pool.query(`
      SELECT vmid, linkedinprofileurl, fullname, email
      FROM public.pli
      WHERE linkedinprofileurl IS NOT NULL
        AND (title IS NULL OR title = '')
      ORDER BY fullname
      LIMIT $1
    `, [opts.limit]);

    console.log(`Found ${contacts.length} PLI records needing profile enrichment`);
    await run.start({ profile: opts.profile, limit: opts.limit, contactCount: contacts.length });
    if (contacts.length === 0) {
      await run.complete({ recordsProcessed: 0, recordsSucceeded: 0, recordsFailed: 0 });
      return;
    }

    if (opts.dryRun) {
      console.log("\n[DRY RUN] Would enrich:");
      contacts.slice(0, 10).forEach(r => console.log(`  ${r.fullname} — ${r.linkedinprofileurl}`));
      if (contacts.length > 10) console.log(`  ... and ${contacts.length - 10} more`);
      return;
    }

    let totalUpdated = 0;

    // Process in batches
    for (let batchStart = 0; batchStart < contacts.length; batchStart += BATCH_SIZE) {
      const batch = contacts.slice(batchStart, batchStart + BATCH_SIZE);
      console.log(`\nBatch ${Math.floor(batchStart / BATCH_SIZE) + 1}: ${batch.length} contacts`);

      const inputs = batch.map(c => ({ url: c.linkedinprofileurl }));

      try {
        const snapshotId = await triggerDataset(bdKey, BD_PERSON_DATASET, inputs);
        console.log(`  Snapshot: ${snapshotId}`);

        const results = await pollSnapshot(bdKey, snapshotId);
        console.log(`  Got ${results.length} results`);

        for (const result of results) {
          if (result.error) continue;
          const profileUrl = result.url || result.input_url || "";
          const vmidMatch = profileUrl.match(/\/in\/([^/?]+)/);
          if (!vmidMatch) continue;
          const vmid = vmidMatch[1];

          // Find matching contact
          const contact = batch.find(c => c.vmid === vmid || c.linkedinprofileurl?.includes(vmid));
          if (!contact) continue;

          // BrightData person profile field mapping:
          // - city: "Antwerp Metropolitan Area"
          // - country_code: "BE"
          // - about: bio text
          // - current_company_name: "Cuez"
          // - educations_details: "Vlerick Business School"
          // - followers: 5638
          // - No title/headline in basic profile! Extract from experience if available.
          const experience = Array.isArray(result.experience) ? result.experience : [];
          const currentJob = experience.find((e: any) => !e.end_year && !e.end_date) || experience[0];
          const jobTitle = currentJob?.title || result.headline || result.title || result.current_company_position || null;

          const location = result.city
            ? (result.country_code ? `${result.city}, ${result.country_code}` : result.city)
            : null;

          try {
            await pool.query(`
              UPDATE public.pli SET
                title = COALESCE($1, title),
                summary = COALESCE($2, summary),
                location = COALESCE($3, location),
                companyname = COALESCE($4, companyname),
                updated_at = NOW()
              WHERE vmid = $5
            `, [
              jobTitle,
              result.about || null,
              location,
              result.current_company_name || null,
              contact.vmid,
            ]);
            totalUpdated++;
          } catch (err: any) {
            console.log(`  Skipped ${contact.fullname}: ${err.message}`);
          }
        }
      } catch (err: any) {
        console.error(`  Batch failed: ${err.message}`);
      }
    }

    await run.complete({ recordsProcessed: contacts.length, recordsSucceeded: totalUpdated, recordsFailed: contacts.length - totalUpdated });

    console.log(`\n=== CONTACT ENRICHMENT SUMMARY ===`);
    console.log(`Updated: ${totalUpdated}/${contacts.length}`);

    const { rows: [summary] } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE title IS NOT NULL AND title != '') as with_title,
        COUNT(*) FILTER (WHERE industry IS NOT NULL) as with_industry,
        COUNT(*) FILTER (WHERE seniority IS NOT NULL) as with_seniority
      FROM public.pli
    `);
    console.log(`\nPLI State: ${summary.total} total, ${summary.with_title} with title, ${summary.with_industry} with industry, ${summary.with_seniority} with seniority`);

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
