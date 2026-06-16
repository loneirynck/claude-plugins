#!/usr/bin/env npx tsx
/**
 * Enrich existing public.cli rows via BrightData Company Profile dataset.
 *
 * Unlike enrich-companies.ts (which discovers NEW companies from pli domains),
 * this script re-enriches cli rows that ALREADY have a linkedin_url — the
 * companies migrated from the legacy CoreSignal projects. It:
 *
 *   1. Reads cli rows WHERE linkedin_url IS NOT NULL that still need enriching
 *      (enrichment_timestamp NULL, or --all to force).
 *   2. Triggers BrightData with their LinkedIn URLs (numeric-ID or slug form
 *      both work — verified).
 *   3. Maps the FULL 31-field BrightData payload into every cli column.
 *   4. UPDATEs the matched cli row in place — COALESCE merge, never nulls
 *      existing data. company_id (the synthetic PK) is NOT touched. No deletes,
 *      no foreign-key changes — purely non-destructive. The real LinkedIn
 *      company_id from BrightData is recorded in the `universal_name`-adjacent
 *      note only via `linkedin_url`; a deliberate re-key is a separate task.
 *
 * Usage:
 *   npx tsx scripts/enrich-cli-companies.ts --profile intouch [--limit 500] [--dry-run] [--all]
 *
 * No daily cap — runs until the candidate set is drained. Triggers in batches
 * of BATCH_SIZE and polls each snapshot so the BrightData API keeps pace.
 */

import { loadSettings } from "../../shared/settings.js";
import pg from "pg";
import { ScriptRun } from "./ops-logger.js";

const { Pool } = pg;
const BD_COMPANY_DATASET = "gd_l1vikfnt1wgvvqz95w";
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 90;
const BATCH_SIZE = 100;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  return {
    profile: get("--profile") || "intouch",
    limit: get("--limit") ? Number(get("--limit")) : null, // null = no limit
    dryRun: args.includes("--dry-run"),
    all: args.includes("--all"), // re-enrich even already-stamped rows
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
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    throw new Error(`Poll failed (${res.status}): ${await res.text()}`);
  }
  throw new Error("Polling timed out");
}

// ── BrightData payload → cli columns ────────────────────────────────────────

function intOrNull(v: unknown): number | null {
  if (v == null) return null;
  const m = String(v).match(/[\d,]+/);
  return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
}

/**
 * Map the BrightData payload to cli data columns. company_id (the synthetic
 * PK) is deliberately NOT included — this script never re-keys. The real
 * LinkedIn id BrightData returns is preserved only via universal_name (slug)
 * and linkedin_url; a deliberate re-key is a separate, reviewed task.
 */
function mapCompany(co: any): Record<string, unknown> | null {
  if (!co.name) return null; // need at least a name to consider it enriched

  const hq = String(co.headquarters || "");
  const hqParts = hq.split(",").map((s: string) => s.trim()).filter(Boolean);
  const loc = Array.isArray(co.formatted_locations) ? String(co.formatted_locations[0] || "") : "";
  const zipMatch = loc.match(/\b(\d{4,6})\b/);

  return {
    company_name: co.name || null,
    website: co.website || co.website_simplified || null,
    universal_name: typeof co.id === "string" ? co.id : null,
    industry: co.industries || null,
    employee_count: intOrNull(co.company_size) ?? intOrNull(co.employees_in_linkedin),
    employee_count_range: co.company_size || null,
    hq_city: hqParts[0] || null,
    hq_country: co.country_code || (hqParts.length > 1 ? hqParts[hqParts.length - 1] : null),
    company_type: co.organization_type || null,
    description: co.about || null,
    hq_description: co.description || null,
    tagline: co.specialties || null,
    followercount: intOrNull(co.followers),
    founded: co.founded ? String(co.founded) : null,
    cover_image: co.image || null,
    logo_resolution: co.logo || null,
    hq_line1: loc || null,
    hq_postalcode: zipMatch ? zipMatch[1] : null,
    enrichment_timestamp: new Date().toISOString(),
  };
}

// ── Update (enrich-only, non-destructive) ───────────────────────────────────

/**
 * Enrich one cli row in place. Matches the existing row by the linkedin_url
 * we fed BrightData and UPDATEs the data columns with a COALESCE merge —
 * never overwrites a non-null value with null. company_id is never touched;
 * no rows are deleted; no foreign keys are repointed.
 */
async function enrichRow(
  pool: pg.Pool,
  m: Record<string, unknown>,
  inputUrl: string,
): Promise<"updated" | "nomatch"> {
  const cols = Object.keys(m);
  // SET col = COALESCE($n, cli.col)  — preserve existing non-null data.
  const setList = cols.map((c, i) => `${c} = COALESCE($${i + 1}, public.cli.${c})`).join(", ");
  const values = cols.map(c => m[c]);
  const cleanUrl = inputUrl.replace(/\/$/, "");

  // Note: public.cli has no updated_at column — enrichment_timestamp (mapped
  // above) is the freshness marker.
  const { rowCount } = await pool.query(
    `UPDATE public.cli SET ${setList}
       WHERE linkedin_url = $${cols.length + 1} OR linkedin_url = $${cols.length + 2}`,
    [...values, inputUrl, cleanUrl]
  );
  return (rowCount ?? 0) > 0 ? "updated" : "nomatch";
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const settings = loadSettings(opts.profile);
  const pool = new Pool(settings.pg);
  const run = new ScriptRun(pool, "enrichment_enrich_cli_companies");

  try {
    const bdKey = await resolveBrightDataKey(pool);

    const where = opts.all
      ? "linkedin_url IS NOT NULL"
      : "linkedin_url IS NOT NULL AND enrichment_timestamp IS NULL";
    const limitClause = opts.limit ? `LIMIT ${opts.limit}` : "";
    const { rows: candidates } = await pool.query(
      `SELECT company_id, company_name, linkedin_url
         FROM public.cli WHERE ${where}
        ORDER BY company_id ${limitClause}`
    );

    console.log(`Candidates to enrich: ${candidates.length}`);
    await run.start({ profile: opts.profile, candidateCount: candidates.length, all: opts.all });

    if (candidates.length === 0) {
      await run.complete({ recordsProcessed: 0, recordsSucceeded: 0, recordsFailed: 0 });
      return;
    }
    if (opts.dryRun) {
      console.log("[DRY RUN] first 10 candidates:");
      candidates.slice(0, 10).forEach(c => console.log(`  ${c.company_name} — ${c.linkedin_url}`));
      console.log(`  ... ${candidates.length} total`);
      return;
    }

    let ok = 0, failed = 0, nomatch = 0;

    for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
      const batch = candidates.slice(start, start + BATCH_SIZE);
      const batchNo = Math.floor(start / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(candidates.length / BATCH_SIZE);
      console.log(`\nBatch ${batchNo}/${totalBatches} — ${batch.length} companies`);

      const inputs = batch.map(c => ({ url: c.linkedin_url.split("?")[0] }));
      try {
        const snapId = await triggerDataset(bdKey, inputs);
        const results = await pollSnapshot(bdKey, snapId);
        console.log(`  snapshot ${snapId} → ${results.length} records`);

        for (const co of results) {
          if (co.error || co.error_code) { failed++; continue; }
          const m = mapCompany(co);
          if (!m) { failed++; continue; }
          const inputUrl = co.input?.url || co.url || "";
          try {
            const r = await enrichRow(pool, m, inputUrl);
            if (r === "updated") ok++; else nomatch++;
          } catch (e) {
            failed++;
            console.error(`  update failed for ${co.name}: ${e instanceof Error ? e.message : e}`);
          }
        }
        console.log(`  running totals — enriched:${ok} nomatch:${nomatch} failed:${failed}`);
      } catch (e) {
        console.error(`  batch ${batchNo} failed: ${e instanceof Error ? e.message : e}`);
        failed += batch.length;
      }
    }

    console.log(`\nDone. enriched:${ok}  nomatch:${nomatch}  failed:${failed}`);
    await run.complete({
      recordsProcessed: candidates.length,
      recordsSucceeded: ok,
      recordsFailed: failed + nomatch,
    });
  } catch (err) {
    await run.fail(err instanceof Error ? err.message : String(err));
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
