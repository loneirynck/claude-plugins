#!/usr/bin/env npx tsx
/**
 * Scrape LinkedIn Ads via the deployed linkedin-ads-engine edge function.
 * The engine handles BrightData Web Unlocker, HTML parsing, and DB callbacks.
 *
 * Can use either:
 *   - Deployed linkedin-ads-engine (default — already deployed on personal Supabase)
 *   - Direct scraping via BrightData (--direct flag, for when engine isn't deployed)
 *
 * Usage: npx tsx scripts/enrich-ads.ts --profile nodewin [--dry-run]
 *        npx tsx scripts/enrich-ads.ts --profile nodewin --companies "Conveo,Cuez"
 *        npx tsx scripts/enrich-ads.ts --profile nodewin --direct --companies "Conveo"
 */

import { loadSettings } from "../../shared/settings.js";
import pg from "pg";

const { Pool } = pg;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  return {
    profile: get("--profile") || "nodewin",
    companies: get("--companies")?.split(",").map(c => c.trim()),
    direct: args.includes("--direct"),
    dryRun: args.includes("--dry-run"),
  };
}

async function resolveEngineConfig(pool: pg.Pool, settings: any): Promise<{ url: string; token: string }> {
  // Try supabase_url from settings first
  const supabaseUrl = settings.supabaseUrl;
  if (supabaseUrl) {
    const { rows } = await pool.query(
      "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERVICE_BEARER_TOKEN' LIMIT 1"
    );
    if (rows[0]?.decrypted_secret) {
      return { url: `${supabaseUrl}/functions/v1/linkedin-ads-engine`, token: rows[0].decrypted_secret };
    }
  }

  // Fallback: resolve both from vault
  const { rows } = await pool.query(`
    SELECT name, decrypted_secret FROM vault.decrypted_secrets
    WHERE name IN ('SUPABASE_URL', 'SERVICE_BEARER_TOKEN')
  `);
  const secrets = Object.fromEntries(rows.map(r => [r.name, r.decrypted_secret]));

  // Try constructing from project ref
  const { rows: refRows } = await pool.query(`
    SELECT current_database() as db
  `);
  const projectUrl = supabaseUrl || `https://${refRows[0]?.db || "unknown"}.supabase.co`;

  if (!secrets.SERVICE_BEARER_TOKEN) {
    throw new Error("Missing SERVICE_BEARER_TOKEN in vault — needed to call linkedin-ads-engine");
  }

  return { url: `${projectUrl}/functions/v1/linkedin-ads-engine`, token: secrets.SERVICE_BEARER_TOKEN };
}

async function main() {
  const opts = parseArgs();
  const settings = loadSettings(opts.profile);
  const pool = new Pool(settings.pg);

  try {
    // Load companies to scrape from config table or CLI args
    let targets: { company_id: number; company_name: string; advertiser_id?: string }[] = [];

    if (opts.companies) {
      // Manual company names — look up IDs from CLI
      for (const name of opts.companies) {
        const { rows } = await pool.query(
          "SELECT company_id, company_name FROM public.cli WHERE LOWER(company_name) = LOWER($1) LIMIT 1",
          [name]
        );
        if (rows[0]) {
          targets.push(rows[0]);
        } else {
          console.log(`  Warning: "${name}" not found in CLI — skipping`);
        }
      }
    } else {
      // Load from linkedin_ads_scraper.config (auto-targets)
      try {
        const { rows } = await pool.query(`
          SELECT company_id, company_name, advertiser_id
          FROM linkedin_ads_scraper.config
          WHERE is_active = true
          ORDER BY company_name
        `);
        targets = rows;
      } catch {
        console.log("No linkedin_ads_scraper.config table — specify --companies flag");
        return;
      }
    }

    console.log(`Found ${targets.length} companies to scrape ads for`);
    if (targets.length === 0) return;

    if (opts.dryRun) {
      console.log("\n[DRY RUN] Would scrape ads for:");
      targets.forEach(t => console.log(`  ${t.company_name} (company_id: ${t.company_id})`));
      return;
    }

    if (opts.direct) {
      // Direct BrightData scraping (same as engine does internally)
      const { rows: [keyRow] } = await pool.query(
        "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'BRIGHTDATA_API_KEY' LIMIT 1"
      );
      if (!keyRow?.decrypted_secret) throw new Error("No BRIGHTDATA_API_KEY in vault");
      const bdKey = keyRow.decrypted_secret;

      for (const target of targets) {
        const adLibUrl = `https://www.linkedin.com/ad-library/search?companyIds=${target.company_id}`;
        console.log(`\nScraping: ${target.company_name} → ${adLibUrl}`);

        try {
          const res = await fetch("https://api.brightdata.com/request", {
            method: "POST",
            headers: { Authorization: `Bearer ${bdKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ zone: "mcp_unlocker", url: adLibUrl, format: "raw" }),
          });
          if (!res.ok) {
            console.error(`  BrightData failed (${res.status}): ${await res.text()}`);
            continue;
          }
          const html = await res.text();
          console.log(`  Got ${html.length} chars of HTML — manual parsing needed (use --use-engine for full pipeline)`);
        } catch (err: any) {
          console.error(`  Error: ${err.message}`);
        }
      }
    } else {
      // Use deployed linkedin-ads-engine
      const engine = await resolveEngineConfig(pool, settings);
      console.log(`Using engine: ${engine.url}`);

      const res = await fetch(`${engine.url}/trigger`, {
        method: "POST",
        headers: { Authorization: `Bearer ${engine.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({}), // Engine reads targets from config table
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`Engine trigger failed (${res.status}): ${text}`);
        return;
      }

      const result = await res.json();
      console.log(`\nEngine response:`, JSON.stringify(result, null, 2));
    }

    // Show current ads state
    try {
      const { rows: [summary] } = await pool.query(`
        SELECT COUNT(*) as total,
          COUNT(DISTINCT advertiser_name) as unique_advertisers,
          COUNT(*) FILTER (WHERE ad_status = 'ACTIVE') as active
        FROM public.linkedin_ad_creatives
      `);
      console.log(`\nAds DB: ${summary.total} total, ${summary.unique_advertisers} advertisers, ${summary.active} active`);
    } catch {
      console.log("No ads data yet");
    }

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
