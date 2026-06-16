#!/usr/bin/env npx tsx
/**
 * Enrich CLI (Company LinkedIn Intelligence) via BrightData Company Profile dataset.
 *
 * Three source modes:
 *
 * --source pli (default)
 *   Finds PLI companies with LinkedIn URLs that don't exist in CLI yet.
 *   Sends LinkedIn company URLs to BrightData → upserts enriched data into CLI.
 *
 * --source crm
 *   Finds HubSpot companies with LinkedIn URLs that are NOT already matched in CLI.
 *   Uses 3-tier matching (domain → LinkedIn URL → name) to exclude already-resolved companies.
 *   Sends LinkedIn company URLs to BrightData → upserts enriched data into CLI.
 *
 * --source cli
 *   Finds CLI companies with a company_id but no linkedin_url.
 *   Constructs LinkedIn URLs from numeric company_ids (https://www.linkedin.com/company/{id}).
 *   Sends to BrightData → upserts enriched data back into CLI.
 *   This is the fastest path when CLI already has company_ids but is missing enrichment data.
 *
 * Usage:
 *   npx tsx scripts/enrich-companies.ts --profile <name> --limit 200 --dry-run
 *   npx tsx scripts/enrich-companies.ts --profile <name> --source crm --limit 1200
 *   npx tsx scripts/enrich-companies.ts --profile <name> --source cli --limit 10000
 *
 * Flags:
 *   --profile <name>   dbt profile from ~/.dbt/profiles.yml
 *   --source <pli|crm|cli> Data source for companies to enrich (default: pli)
 *   --limit <n>        Max companies to process (default: 200)
 *   --dry-run          Show what would be enriched without calling BrightData
 *
 * API key (resolved in order):
 *   1. Environment variable BRIGHTDATA_API_KEY
 *   2. Supabase vault: vault.decrypted_secrets WHERE name = 'BRIGHTDATA_API_KEY'
 *
 * Upsert uses ON CONFLICT (company_id) DO UPDATE — safe for re-runs, handles company renames.
 * Batch size: 100 companies per BrightData snapshot request.
 */

import { loadSettings } from "../../shared/settings.js";
import pg from "pg";
import { ScriptRun } from "./ops-logger.js";

const { Pool } = pg;
const BD_COMPANY_DATASET = "gd_l1vikfnt1wgvvqz95w";
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
    source: get("--source") || "pli",
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

  const run = new ScriptRun(pool, "enrichment_enrich_companies");

  try {
    const bdKey = await resolveBrightDataKey(pool);

    // Get companies needing enrichment — from PLI, CRM, or CLI
    const query = opts.source === "cli"
      ? `
        SELECT company_id, company_name
        FROM public.cli
        WHERE linkedin_url IS NULL
          AND company_id IS NOT NULL
        ORDER BY company_name
        LIMIT $1
      `
      : opts.source === "crm"
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
        SELECT h.properties_linkedin_company_page as company_url, h.properties_name as companyname
        FROM hubspot.companies h
        WHERE h.id NOT IN (SELECT id FROM matched)
        AND h.properties_linkedin_company_page IS NOT NULL
        AND h.properties_linkedin_company_page != ''
        ORDER BY h.properties_name
        LIMIT $1
      `
      : `
        SELECT DISTINCT
          COALESCE(p.regularcompanyurl, p.companyurl) as company_url,
          p.companyname
        FROM public.pli p
        LEFT JOIN public.cli c ON LOWER(c.company_name) = LOWER(p.companyname)
        WHERE COALESCE(p.regularcompanyurl, p.companyurl) IS NOT NULL
          AND COALESCE(p.regularcompanyurl, p.companyurl) != ''
          AND c.company_id IS NULL
        ORDER BY p.companyname
        LIMIT $1
      `;
    const { rows: results } = await pool.query(query, [opts.limit]);

    console.log(`Found ${results.length} companies needing enrichment (source: ${opts.source})`);
    await run.start({ profile: opts.profile, limit: opts.limit, companyCount: results.length, source: opts.source });
    if (results.length === 0) {
      await run.complete({ recordsProcessed: 0, recordsSucceeded: 0, recordsFailed: 0 });
      return;
    }

    if (opts.dryRun) {
      console.log("\n[DRY RUN] Would enrich:");
      results.slice(0, 10).forEach(r => {
        if (opts.source === "cli") {
          console.log(`  ${r.company_name} — https://www.linkedin.com/company/${r.company_id}`);
        } else {
          console.log(`  ${r.companyname} — ${r.company_url}`);
        }
      });
      if (results.length > 10) console.log(`  ... and ${results.length - 10} more`);
      return;
    }

    let totalInserted = 0;

    for (let batchStart = 0; batchStart < results.length; batchStart += BATCH_SIZE) {
      const batch = results.slice(batchStart, batchStart + BATCH_SIZE);
      console.log(`\nBatch ${Math.floor(batchStart / BATCH_SIZE) + 1}: ${batch.length} companies`);

      // Build LinkedIn company URLs
      const inputs = batch.map(d => {
        if (opts.source === "cli") {
          // CLI source: construct from numeric company_id
          return { url: `https://www.linkedin.com/company/${d.company_id}` };
        }
        // PLI/CRM source: use existing URL or construct from domain
        const url = d.company_url.replace(/^https?:\/\//, "").replace(/\/$/, "");
        if (url.includes("linkedin.com/company/")) {
          return { url: d.company_url.split("?")[0] };
        }
        const slug = url.split(".")[0].toLowerCase();
        return { url: `https://www.linkedin.com/company/${slug}` };
      });

      try {
        const snapshotId = await triggerDataset(bdKey, BD_COMPANY_DATASET, inputs);
        console.log(`  Snapshot: ${snapshotId}`);

        const results = await pollSnapshot(bdKey, snapshotId);
        console.log(`  Got ${results.length} results`);

        for (const co of results) {
          if (!co.name || co.error) continue;

          // Parse headquarters "City, State" → city/country
          const hq = String(co.headquarters || "");
          const hqParts = hq.split(",").map((s: string) => s.trim());
          const hqCity = hqParts[0] || null;
          const hqCountry = hqParts.length > 1 ? hqParts[hqParts.length - 1] : null;

          // Parse employee count from "10,001+ employees"
          const sizeStr = String(co.company_size || "");
          const empMatch = sizeStr.match(/[\d,]+/);
          const empCount = empMatch ? parseInt(empMatch[0].replace(/,/g, "")) : (co.employees_in_linkedin || null);

          // company_id: use numeric BD company_id if available, otherwise hash the name
          const rawCid = co.company_id || co.id;
          const numericCid = rawCid && /^\d+$/.test(String(rawCid)) ? Number(rawCid) : null;
          const companyId = numericCid || Math.abs(Array.from(co.name as string).reduce((h: number, c: string) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0));

          try {
            // Upsert by company_id (primary key) — handles name changes, missing fields
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
              empCount, sizeStr || null, hqCity, hqCountry,
              co.organization_type || null, co.about || null,
              co.url || null, co.followers || null, co.id || null,
            ]);
            totalInserted++;
          } catch (err: any) {
            console.log(`  Skipped ${co.name}: ${err.message}`);
          }
        }
      } catch (err: any) {
        console.error(`  Batch failed: ${err.message}`);
      }
    }

    await run.complete({ recordsProcessed: results.length, recordsSucceeded: totalInserted, recordsFailed: results.length - totalInserted });

    console.log(`\n=== COMPANY ENRICHMENT SUMMARY ===`);
    console.log(`Inserted/Updated: ${totalInserted}/${results.length}`);

    const { rows: [summary] } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE industry IS NOT NULL) as with_industry,
        COUNT(*) FILTER (WHERE employee_count IS NOT NULL) as with_size,
        COUNT(*) FILTER (WHERE hq_country IS NOT NULL) as with_hq
      FROM public.cli
    `);
    console.log(`\nCLI State: ${summary.total} total, ${summary.with_industry} with industry, ${summary.with_size} with size, ${summary.with_hq} with HQ`);

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
