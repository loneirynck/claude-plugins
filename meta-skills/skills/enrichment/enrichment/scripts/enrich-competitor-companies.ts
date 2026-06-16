#!/usr/bin/env npx tsx
/**
 * Enrich competitor companies into CLI via BrightData Company Profile dataset.
 * Reads linkedin_url from public.competitors, enriches via BrightData, upserts into CLI.
 *
 * Usage: npx tsx scripts/enrich-competitor-companies.ts --profile conveo [--limit 50] [--dry-run]
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
    profile: get("--profile") || "conveo",
    limit: Number(get("--limit") || "50"),
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

  const run = new ScriptRun(pool, "enrichment_enrich_competitor_companies");

  try {
    const bdKey = await resolveBrightDataKey(pool);

    // Get competitors with linkedin_url whose company_id is NOT yet in CLI
    const { rows: competitors } = await pool.query(`
      SELECT comp.name, comp.company_id, comp.linkedin_url
      FROM public.competitors comp
      LEFT JOIN public.cli cli ON comp.company_id = cli.company_id
      WHERE comp.linkedin_url IS NOT NULL
        AND comp.company_id IS NOT NULL
        AND cli.company_id IS NULL
      ORDER BY comp.name
      LIMIT $1
    `, [opts.limit]);

    console.log(`Found ${competitors.length} competitors needing enrichment into CLI`);
    await run.start({ profile: opts.profile, limit: opts.limit, competitorCount: competitors.length });

    if (competitors.length === 0) {
      console.log("All competitors already in CLI — nothing to do");
      await run.complete({ recordsProcessed: 0, recordsSucceeded: 0, recordsFailed: 0 });
      return;
    }

    if (opts.dryRun) {
      console.log("\n[DRY RUN] Would enrich:");
      competitors.forEach(r => console.log(`  ${r.name} (${r.company_id}) — ${r.linkedin_url}`));
      return;
    }

    let totalInserted = 0;

    for (let batchStart = 0; batchStart < competitors.length; batchStart += BATCH_SIZE) {
      const batch = competitors.slice(batchStart, batchStart + BATCH_SIZE);
      console.log(`\nBatch ${Math.floor(batchStart / BATCH_SIZE) + 1}: ${batch.length} competitors`);

      const inputs = batch.map(c => ({
        url: c.linkedin_url.split("?")[0],
      }));

      try {
        const snapshotId = await triggerDataset(bdKey, BD_COMPANY_DATASET, inputs);
        console.log(`  Snapshot: ${snapshotId}`);

        const results = await pollSnapshot(bdKey, snapshotId);
        console.log(`  Got ${results.length} results`);

        for (const co of results) {
          if (!co.name || co.error) {
            console.log(`  Skipped error result: ${co.error || 'no name'}`);
            continue;
          }

          // Match back to competitor by LinkedIn URL or name
          const matchedComp = batch.find(c =>
            c.linkedin_url.includes(co.id) || c.name.toLowerCase() === co.name?.toLowerCase()
          );
          const companyId = matchedComp?.company_id || co.company_id;
          if (!companyId) {
            console.log(`  Skipped ${co.name}: no company_id to use`);
            continue;
          }

          // Parse headquarters
          const hq = String(co.headquarters || "");
          const hqParts = hq.split(",").map((s: string) => s.trim());
          const hqCity = hqParts[0] || null;
          const hqCountry = hqParts.length > 1 ? hqParts[hqParts.length - 1] : null;

          // Parse employee count
          const sizeStr = String(co.company_size || "");
          const empMatch = sizeStr.match(/[\d,]+/);
          const empCount = empMatch ? parseInt(empMatch[0].replace(/,/g, "")) : (co.employees_in_linkedin || null);

          try {
            await pool.query(`
              INSERT INTO public.cli (
                company_id, company_name, website, industry, employee_count,
                employee_count_range, hq_city, hq_country, company_type,
                description, tagline, linkedin_url, followercount, universal_name,
                founded, "timestamp", created_at, updated_at
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW(), NOW(), NOW())
              ON CONFLICT (company_id) DO UPDATE SET
                website = COALESCE(EXCLUDED.website, cli.website),
                industry = COALESCE(EXCLUDED.industry, cli.industry),
                employee_count = COALESCE(EXCLUDED.employee_count, cli.employee_count),
                employee_count_range = COALESCE(EXCLUDED.employee_count_range, cli.employee_count_range),
                hq_city = COALESCE(EXCLUDED.hq_city, cli.hq_city),
                hq_country = COALESCE(EXCLUDED.hq_country, cli.hq_country),
                company_type = COALESCE(EXCLUDED.company_type, cli.company_type),
                description = COALESCE(EXCLUDED.description, cli.description),
                tagline = COALESCE(EXCLUDED.tagline, cli.tagline),
                linkedin_url = COALESCE(EXCLUDED.linkedin_url, cli.linkedin_url),
                followercount = COALESCE(EXCLUDED.followercount, cli.followercount),
                universal_name = COALESCE(EXCLUDED.universal_name, cli.universal_name),
                founded = COALESCE(EXCLUDED.founded, cli.founded),
                updated_at = NOW()
            `, [
              companyId, co.name, co.website || null, co.industries || null,
              empCount, sizeStr || null, hqCity, hqCountry,
              co.organization_type || null, co.about || null, co.tagline || null,
              co.url || null, co.followers || null, co.id || null,
              co.founded || null,
            ]);
            totalInserted++;
            console.log(`  ✓ ${co.name} (${companyId}) — ${co.website || 'no website'}`);
          } catch (err: any) {
            console.log(`  ✗ ${co.name}: ${err.message}`);
          }
        }
      } catch (err: any) {
        console.error(`  Batch failed: ${err.message}`);
      }
    }

    await run.complete({
      recordsProcessed: competitors.length,
      recordsSucceeded: totalInserted,
      recordsFailed: competitors.length - totalInserted,
    });

    console.log(`\n=== COMPETITOR COMPANY ENRICHMENT SUMMARY ===`);
    console.log(`Inserted/Updated: ${totalInserted}/${competitors.length}`);

    // Show CLI state for competitors
    const { rows: summary } = await pool.query(`
      SELECT comp.name, cli.website, cli.industry, cli.employee_count, cli.hq_country
      FROM public.competitors comp
      JOIN public.cli cli ON comp.company_id = cli.company_id
      ORDER BY comp.name
    `);
    console.log(`\nCompetitors now in CLI: ${summary.length}`);
    summary.forEach(r => console.log(`  ${r.name} — ${r.website || 'no website'} (${r.industry || 'no industry'}, ${r.employee_count || '?'} emp, ${r.hq_country || '?'})`));

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
