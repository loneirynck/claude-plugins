#!/usr/bin/env npx tsx
/**
 * Discover LinkedIn company URLs via Serper Google SERP API.
 *
 * Two source modes:
 *
 * --source pli (default)
 *   Finds PLI companies without a LinkedIn company URL in CLI.
 *   Searches: site:linkedin.com/company/ "{companyname}"
 *   Updates PLI.regularcompanyurl + PLI.companyurl so enrich-companies can use real URLs.
 *
 * --source crm
 *   Finds HubSpot companies with a domain but no LinkedIn URL, that are NOT already in CLI.
 *   Searches: site:linkedin.com/company/ "{domain}"
 *   Then immediately enriches discovered URLs via BrightData company dataset → upserts into CLI.
 *   Combined single-pass: Serper discover + BrightData enrich + CLI upsert.
 *   Requires both SERPER_API_KEY and BRIGHTDATA_API_KEY in vault or env.
 *
 * Usage:
 *   npx tsx scripts/discover-company-urls.ts --profile <name> --limit 100 --dry-run
 *   npx tsx scripts/discover-company-urls.ts --profile <name> --source crm --limit 500
 *
 * Flags:
 *   --profile <name>   dbt profile from ~/.dbt/profiles.yml
 *   --source <pli|crm> Data source for companies to discover (default: pli)
 *   --limit <n>        Max companies to process (default: 200)
 *   --dry-run          Show what would be searched without calling APIs
 *
 * API keys (resolved in order):
 *   1. Environment variable SERPER_API_KEY / BRIGHTDATA_API_KEY
 *   2. Supabase vault: vault.decrypted_secrets WHERE name = 'SERPER_API_KEY' / 'BRIGHTDATA_API_KEY'
 *
 * CRM source matching logic (excludes companies already in CLI via):
 *   1. Domain match: stripped website domain = HubSpot properties_domain
 *   2. LinkedIn URL match: cli.linkedin_url = HubSpot properties_linkedin_company_page
 *   3. Name match: lower(trim(company_name)) = lower(trim(properties_name))
 *
 * BrightData enrichment uses ON CONFLICT (company_id) DO UPDATE — safe for re-runs.
 */

import { loadSettings } from "../../shared/settings.js";
import pg from "pg";
import { ScriptRun } from "./ops-logger.js";

const { Pool } = pg;
const SERPER_ENDPOINT = "https://google.serper.dev/search";

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
    source: get("--source") || "pli",
  };
}

async function resolveSerperKey(pool: pg.Pool): Promise<string> {
  if (process.env.SERPER_API_KEY) return process.env.SERPER_API_KEY;
  const { rows } = await pool.query(
    "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERPER_API_KEY' LIMIT 1"
  );
  if (rows[0]?.decrypted_secret) return rows[0].decrypted_secret;
  throw new Error("No SERPER_API_KEY found in env var or vault");
}

async function serperSearch(apiKey: string, query: string): Promise<any> {
  const res = await fetch(SERPER_ENDPOINT, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 3 }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Serper failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function main() {
  const opts = parseArgs();
  const settings = loadSettings(opts.profile);
  const pool = new Pool(settings.pg);
  const run = new ScriptRun(pool, "enrichment_discover_company_urls");

  try {
    const serperKey = await resolveSerperKey(pool);

    // Find companies needing LinkedIn URL discovery
    const query = opts.source === "crm"
      ? `
        WITH matched AS (
          SELECT DISTINCT h.id FROM hubspot.companies h
          JOIN public.cli c ON lower(trim(regexp_replace(regexp_replace(c.website, '^https?://(www\\.)?', ''), '/.*$', ''))) = lower(trim(h.properties_domain))
          WHERE h.properties_domain IS NOT NULL AND h.properties_domain != '' AND c.website IS NOT NULL AND c.website != ''
          UNION
          SELECT DISTINCT h.id FROM hubspot.companies h
          JOIN public.cli c ON c.linkedin_url = h.properties_linkedin_company_page
          WHERE h.properties_linkedin_company_page IS NOT NULL
          UNION
          SELECT DISTINCT h.id FROM hubspot.companies h
          JOIN public.cli c ON lower(trim(c.company_name)) = lower(trim(h.properties_name))
          WHERE h.properties_name IS NOT NULL
        )
        SELECT h.properties_name as companyname, h.properties_domain as domain
        FROM hubspot.companies h
        WHERE h.id NOT IN (SELECT id FROM matched)
        AND h.properties_name IS NOT NULL AND h.properties_name != ''
        AND (h.properties_linkedin_company_page IS NULL OR h.properties_linkedin_company_page = '')
        ORDER BY h.properties_name
        LIMIT $1
      `
      : `
        SELECT DISTINCT p.companyname
        FROM public.pli p
        LEFT JOIN public.cli c ON LOWER(c.company_name) = LOWER(p.companyname)
        WHERE p.companyname IS NOT NULL
          AND p.companyname != ''
          AND (p.regularcompanyurl IS NULL OR p.regularcompanyurl NOT LIKE '%linkedin.com/company/%')
          AND c.company_id IS NULL
        ORDER BY p.companyname
        LIMIT $1
      `;
    const { rows: companies } = await pool.query(query, [opts.limit]);

    console.log(`Found ${companies.length} companies needing LinkedIn URL discovery (source: ${opts.source})`);
    await run.start({ profile: opts.profile, limit: opts.limit, companyCount: companies.length, source: opts.source });

    if (companies.length === 0) {
      await run.complete({ recordsProcessed: 0, recordsSucceeded: 0, recordsFailed: 0 });
      return;
    }

    if (opts.dryRun) {
      console.log("\n[DRY RUN] Would search for:");
      companies.slice(0, 10).forEach(r => {
        const searchTerm = r.domain ? r.domain : r.companyname;
        console.log(`  site:linkedin.com/company/ "${searchTerm}"`);
      });
      if (companies.length > 10) console.log(`  ... and ${companies.length - 10} more`);
      return;
    }

    // Resolve BrightData key for CRM source (discover + enrich in one pass)
    let bdKey: string | null = null;
    if (opts.source === "crm") {
      if (process.env.BRIGHTDATA_API_KEY) bdKey = process.env.BRIGHTDATA_API_KEY;
      else {
        const { rows } = await pool.query(
          "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BRIGHTDATA_API_KEY' LIMIT 1"
        );
        bdKey = rows[0]?.decrypted_secret || null;
      }
      if (!bdKey) console.warn("  WARNING: No BRIGHTDATA_API_KEY — will discover URLs but skip enrichment");
    }

    let found = 0, enriched = 0, notFound = 0, errors = 0;
    const BD_COMPANY_DATASET = "gd_l1vikfnt1wgvvqz95w";

    // Collect discovered URLs for batch BrightData enrichment
    const discoveredUrls: { url: string; name: string }[] = [];

    let foundViaDomain = 0, foundViaName = 0;

    for (let i = 0; i < companies.length; i++) {
      const companyName = companies[i].companyname;
      const domain = companies[i].domain;

      try {
        let linkedinUrl: string | null = null;

        // Waterfall: 1) search by domain, 2) fallback to company name
        const searches = domain
          ? [`site:linkedin.com/company/ "${domain}"`, `site:linkedin.com/company/ "${companyName}"`]
          : [`site:linkedin.com/company/ "${companyName}"`];

        for (let s = 0; s < searches.length; s++) {
          const result = await serperSearch(serperKey, searches[s]);
          const organic = result?.organic || [];

          for (const r of organic) {
            const link = r.link || "";
            if (!link.match(/linkedin\.com\/company\/[a-zA-Z0-9\-]+/)) continue;
            linkedinUrl = link.split("?")[0];
            break;
          }

          if (linkedinUrl) {
            if (s === 0 && domain) foundViaDomain++;
            else foundViaName++;
            break; // Found — skip fallback
          }

          // 200ms delay before fallback search
          if (s < searches.length - 1) await new Promise(r => setTimeout(r, 200));
        }

        if (linkedinUrl) {
          if (opts.source === "pli") {
            await pool.query(`
              UPDATE public.pli SET
                regularcompanyurl = $1,
                companyurl = $1,
                updated_at = NOW()
              WHERE LOWER(companyname) = LOWER($2)
                AND (regularcompanyurl IS NULL OR regularcompanyurl NOT LIKE '%linkedin.com/company/%')
            `, [linkedinUrl, companyName]);
          } else {
            discoveredUrls.push({ url: linkedinUrl, name: companyName });
          }
          found++;
        } else {
          notFound++;
        }

        if ((i + 1) % 20 === 0) {
          console.log(`  Progress: ${i + 1}/${companies.length} (found: ${found})`);
        }

        if (i < companies.length - 1) await new Promise(r => setTimeout(r, 200));

      } catch (err: any) {
        console.error(`  Error for "${companyName}": ${err.message}`);
        errors++;
        if (err.message.includes("credits") || err.message.includes("402")) {
          console.error("  API credits exhausted — stopping");
          break;
        }
      }
    }

    // CRM source: batch enrich discovered URLs via BrightData → CLI
    if (opts.source === "crm" && bdKey && discoveredUrls.length > 0) {
      console.log(`\nEnriching ${discoveredUrls.length} discovered companies via BrightData...`);
      const BATCH_SIZE = 100;

      for (let batchStart = 0; batchStart < discoveredUrls.length; batchStart += BATCH_SIZE) {
        const batch = discoveredUrls.slice(batchStart, batchStart + BATCH_SIZE);
        console.log(`  Batch ${Math.floor(batchStart / BATCH_SIZE) + 1}: ${batch.length} companies`);

        const inputs = batch.map(d => ({ url: d.url.split("?")[0] }));

        try {
          const triggerRes = await fetch(
            `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${BD_COMPANY_DATASET}&include_errors=true`,
            { method: "POST", headers: { Authorization: `Bearer ${bdKey}`, "Content-Type": "application/json" }, body: JSON.stringify(inputs) }
          );
          if (!triggerRes.ok) { console.error(`  Trigger failed: ${await triggerRes.text()}`); continue; }
          const { snapshot_id } = await triggerRes.json();
          console.log(`  Snapshot: ${snapshot_id}`);

          // Poll for results
          let results: any[] = [];
          for (let attempt = 0; attempt < 60; attempt++) {
            const pollRes = await fetch(
              `https://api.brightdata.com/datasets/v3/snapshot/${snapshot_id}?format=json`,
              { headers: { Authorization: `Bearer ${bdKey}` } }
            );
            if (pollRes.status === 200) { results = await pollRes.json(); break; }
            if (pollRes.status === 202) { console.log(`  Polling... attempt ${attempt + 1}/60`); await new Promise(r => setTimeout(r, 10000)); continue; }
            console.error(`  Poll failed: ${pollRes.status}`); break;
          }

          console.log(`  Got ${results.length} results`);

          for (const co of results) {
            if (!co.name || co.error) continue;
            const hq = String(co.headquarters || "");
            const hqParts = hq.split(",").map((s: string) => s.trim());
            const sizeStr = String(co.company_size || "");
            const empMatch = sizeStr.match(/[\d,]+/);
            const empCount = empMatch ? parseInt(empMatch[0].replace(/,/g, "")) : (co.employees_in_linkedin || null);
            const rawCid = co.company_id || co.id;
            const numericCid = rawCid && /^\d+$/.test(String(rawCid)) ? Number(rawCid) : null;
            const companyId = numericCid || Math.abs(Array.from(co.name as string).reduce((h: number, c: string) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0));

            try {
              await pool.query(`
                INSERT INTO public.cli (
                  company_id, company_name, website, industry, employee_count,
                  employee_count_range, hq_city, hq_country, company_type,
                  description, linkedin_url, followercount, universal_name,
                  "timestamp", created_at, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, NOW(), NOW(), NOW())
                ON CONFLICT (company_id) DO UPDATE SET
                  company_name = COALESCE(EXCLUDED.company_name, cli.company_name),
                  website = COALESCE(EXCLUDED.website, cli.website),
                  industry = COALESCE(EXCLUDED.industry, cli.industry),
                  employee_count = COALESCE(EXCLUDED.employee_count, cli.employee_count),
                  employee_count_range = COALESCE(EXCLUDED.employee_count_range, cli.employee_count_range),
                  hq_city = COALESCE(EXCLUDED.hq_city, cli.hq_city),
                  hq_country = COALESCE(EXCLUDED.hq_country, cli.hq_country),
                  company_type = COALESCE(EXCLUDED.company_type, cli.company_type),
                  description = COALESCE(EXCLUDED.description, cli.description),
                  linkedin_url = COALESCE(EXCLUDED.linkedin_url, cli.linkedin_url),
                  followercount = COALESCE(EXCLUDED.followercount, cli.followercount),
                  universal_name = COALESCE(EXCLUDED.universal_name, cli.universal_name),
                  updated_at = NOW()
              `, [
                companyId, co.name, co.website || null, co.industries || null,
                empCount, sizeStr || null, hqParts[0] || null,
                hqParts.length > 1 ? hqParts[hqParts.length - 1] : null,
                co.organization_type || null, co.about || null,
                co.url || null, co.followers || null, co.id || null,
              ]);
              enriched++;
            } catch (err: any) {
              console.log(`  Skipped ${co.name}: ${err.message}`);
            }
          }
        } catch (err: any) {
          console.error(`  Batch failed: ${err.message}`);
        }
      }
    }

    await run.complete({ recordsProcessed: found + notFound + errors, recordsSucceeded: found, recordsFailed: notFound + errors });

    console.log(`\n=== COMPANY URL DISCOVERY SUMMARY ===`);
    console.log(`Found: ${found} (domain: ${foundViaDomain}, name fallback: ${foundViaName})`);
    console.log(`Not found: ${notFound}`);
    console.log(`Errors: ${errors}`);
    if (opts.source === "crm") console.log(`Enriched into CLI: ${enriched}`);

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
