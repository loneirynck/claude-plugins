#!/usr/bin/env npx tsx
/**
 * Test: Enrich 3 target account companies via BrightData to get real LinkedIn company_id.
 * Reads from CLI where company_id < 0 (placeholder), enriches, replaces with real ID.
 *
 * Usage: npx tsx TESTS/enrich-target-accounts-test.ts --profile conveo [--dry-run]
 */

import { loadSettings } from "../../shared/settings.js";
import pg from "pg";

const { Pool } = pg;
const BD_COMPANY_DATASET = "gd_l1vikfnt1wgvvqz95w";
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 60;
const TEST_LIMIT = 500;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  return {
    profile: get("--profile") || "conveo",
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

async function triggerDataset(apiKey: string, inputs: Record<string, string>[]): Promise<string> {
  const res = await fetch(
    `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${BD_COMPANY_DATASET}&include_errors=true`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(inputs),
    }
  );
  if (!res.ok) throw new Error(`BrightData trigger failed (${res.status}): ${await res.text()}`);
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
    throw new Error(`Poll failed (${res.status}): ${await res.text()}`);
  }
  throw new Error("Polling timed out");
}

async function main() {
  const opts = parseArgs();
  const settings = loadSettings(opts.profile);
  const pool = new Pool(settings.pg);

  try {
    const bdKey = await resolveBrightDataKey(pool);

    // Get 3 target accounts with placeholder IDs
    const { rows: targets } = await pool.query(`
      SELECT company_id, company_name, linkedin_url
      FROM public.cli
      WHERE company_id < 0 AND target_account = true AND linkedin_url IS NOT NULL
      ORDER BY company_id DESC
      LIMIT $1
    `, [TEST_LIMIT]);

    console.log(`\nFound ${targets.length} target accounts to enrich:`);
    targets.forEach(t => console.log(`  [${t.company_id}] ${t.company_name} — ${t.linkedin_url}`));

    if (opts.dryRun) {
      console.log("\n[DRY RUN] Would send these URLs to BrightData. Exiting.");
      return;
    }

    // Process in batches of 100
    const BATCH_SIZE = 100;
    let totalSuccess = 0;
    let totalErrors = 0;

    for (let batchStart = 0; batchStart < targets.length; batchStart += BATCH_SIZE) {
      const batch = targets.slice(batchStart, batchStart + BATCH_SIZE);
      const batchNum = Math.floor(batchStart / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(targets.length / BATCH_SIZE);
      console.log(`\n=== Batch ${batchNum}/${totalBatches}: ${batch.length} companies ===`);

      const inputs = batch.map(t => ({ url: t.linkedin_url.split("?")[0] }));

      try {
        const snapshotId = await triggerDataset(bdKey, inputs);
        console.log(`Snapshot: ${snapshotId}`);

        const results = await pollSnapshot(bdKey, snapshotId);
        console.log(`Got ${results.length} results\n`);

        for (const co of results) {
          if (!co.name || co.error) {
            console.log(`  ERROR for ${co.url || 'unknown'}: ${co.error || 'no name'}`);
            totalErrors++;
            continue;
          }

          const rawCid = co.company_id || co.id;
          const numericCid = rawCid && /^\d+$/.test(String(rawCid)) ? Number(rawCid) : null;

          if (!numericCid) {
            console.log(`  SKIP ${co.name}: no numeric company_id from BrightData (got: ${rawCid})`);
            totalErrors++;
            continue;
          }

          // Find the matching placeholder row by LinkedIn URL
          const inputUrl = (co.url || co.input?.url || "").replace(/\/$/, "");
          const match = batch.find(t =>
            t.linkedin_url.replace(/\/$/, "").toLowerCase() === inputUrl.toLowerCase()
          );

          if (!match) {
            console.log(`  SKIP ${co.name}: couldn't match back to placeholder (url: ${inputUrl})`);
            totalErrors++;
            continue;
          }

          // Parse HQ
          const hq = String(co.headquarters || "");
          const hqParts = hq.split(",").map((s: string) => s.trim());
          const hqCity = hqParts[0] || null;
          const hqCountry = hqParts.length > 1 ? hqParts[hqParts.length - 1] : null;

          // Parse employee count
          const sizeStr = String(co.company_size || "");
          const empMatch = sizeStr.match(/[\d,]+/);
          const empCount = empMatch ? parseInt(empMatch[0].replace(/,/g, "")) : null;

          console.log(`  ✓ ${co.name}: placeholder ${match.company_id} → real ID ${numericCid}`);

          // Delete placeholder row, insert with real company_id
          await pool.query("DELETE FROM public.cli WHERE company_id = $1", [match.company_id]);
          await pool.query(`
        INSERT INTO public.cli (
          company_id, company_name, website, universal_name, industry,
          employee_count, employee_count_range, hq_city, hq_country,
          company_type, description, tagline, linkedin_url, followercount,
          founded, domain_valid, enrichment_timestamp, target_account,
          created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),true,NOW(),NOW())
        ON CONFLICT (company_id) DO UPDATE SET
          target_account = true,
          enrichment_timestamp = NOW(),
          updated_at = NOW()
      `, [
        numericCid, co.name, co.website || null, co.id || null,
        co.industries || null, empCount, sizeStr || null,
        hqCity, hqCountry, co.organization_type || null,
        co.about || null, co.slogan || null, co.url || null,
        co.followers || null, co.founded || null, true,
      ]);
          totalSuccess++;
        }
      } catch (err: any) {
        console.error(`  Batch ${batchNum} failed: ${err.message}`);
        totalErrors += batch.length;
      }
    }

    console.log(`\n=== ENRICHMENT COMPLETE ===`);
    console.log(`Success: ${totalSuccess}, Errors: ${totalErrors}`);

    // Verify
    const { rows: [counts] } = await pool.query(`
      SELECT
        count(*) FILTER (WHERE company_id > 0 AND target_account = true) AS enriched_targets,
        count(*) FILTER (WHERE company_id < 0 AND target_account = true) AS placeholder_targets
      FROM public.cli
    `);
    console.log(`\n=== RESULT ===`);
    console.log(`Enriched target accounts (real ID): ${counts.enriched_targets}`);
    console.log(`Remaining placeholders: ${counts.placeholder_targets}`);

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
