#!/usr/bin/env npx tsx
/**
 * Discover LinkedIn profile URLs via Serper Google SERP API.
 * Query per contact: site:linkedin.com/in/ "firstname lastname"
 *
 * Usage: npx tsx scripts/discover-urls.ts --profile nodewin [--limit 50] [--dry-run]
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
    limit: Number(get("--limit") || "100"),
    dryRun: args.includes("--dry-run"),
  };
}

function extractVmid(url: string): string | null {
  const match = url.match(/linkedin\.com\/in\/([a-zA-Z0-9\-]+)/);
  return match ? match[1] : null;
}

async function resolveSerperKey(pool: pg.Pool, settings: any): Promise<string> {
  // profiles.yml → env var → vault
  const fromProfile = (settings as any).__raw?.serper_api_key;
  if (fromProfile) return fromProfile;
  if (process.env.SERPER_API_KEY) return process.env.SERPER_API_KEY;

  const { rows } = await pool.query(
    "SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SERPER_API_KEY' LIMIT 1"
  );
  if (rows[0]?.decrypted_secret) return rows[0].decrypted_secret;
  throw new Error("No SERPER_API_KEY found in profiles.yml, env var, or vault");
}

async function serperSearch(apiKey: string, query: string): Promise<any> {
  const res = await fetch(SERPER_ENDPOINT, {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, num: 5 }),
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

  const run = new ScriptRun(pool, "enrichment_discover_urls");

  try {
    const serperKey = await resolveSerperKey(pool, settings);

    // Load contacts needing URL discovery OR title backfill
    const backfillTitles = process.argv.includes("--backfill-titles");
    const { rows: pending } = await pool.query(backfillTitles ? `
      SELECT vmid, email, fullname, name, companyname, linkedinprofileurl
      FROM public.pli
      WHERE linkedinprofileurl IS NOT NULL
        AND (title IS NULL OR title = '')
        AND COALESCE(fullname, name) NOT LIKE '%@%'
        AND COALESCE(fullname, name) IS NOT NULL
      ORDER BY fullname
      LIMIT $1
    ` : `
      SELECT vmid, email, fullname, name, companyname
      FROM public.pli
      WHERE vmid LIKE 'pending_%'
        AND linkedinprofileurl IS NULL
        AND COALESCE(fullname, name) NOT LIKE '%@%'
        AND COALESCE(fullname, name) IS NOT NULL
      ORDER BY fullname
      LIMIT $1
    `, [opts.limit]);

    console.log(`Found ${pending.length} PLI records needing LinkedIn URL discovery`);
    await run.start({ profile: opts.profile, limit: opts.limit, pendingCount: pending.length });
    if (pending.length === 0) {
      await run.complete({ recordsProcessed: 0, recordsSucceeded: 0, recordsFailed: 0 });
      return;
    }

    if (opts.dryRun) {
      console.log("\n[DRY RUN] Would search for:");
      pending.slice(0, 10).forEach(r => {
        const name = r.fullname || r.name;
        console.log(`  site:linkedin.com/in/ "${name}"`);
      });
      if (pending.length > 10) console.log(`  ... and ${pending.length - 10} more`);
      return;
    }

    let found = 0, notFound = 0, errors = 0;

    for (let i = 0; i < pending.length; i++) {
      const contact = pending[i];
      const fullName = contact.fullname || contact.name || "";
      const query = `site:linkedin.com/in/ "${fullName}"`;

      try {
        const result = await serperSearch(serperKey, query);
        const organic = result?.organic || [];

        let linkedinUrl: string | null = null;
        let parsedTitle: string | null = null;
        let parsedCompany: string | null = null;
        const nameParts = fullName.toLowerCase().split(" ");

        for (const r of organic) {
          const link = r.link || "";
          if (!link.match(/linkedin\.com\/in\/[a-zA-Z0-9\-]+/)) continue;

          // Verify name match in title
          const pageTitle = (r.title || "").toLowerCase();
          if (nameParts.some((part: string) => part.length > 2 && pageTitle.includes(part))) {
            linkedinUrl = link.split("?")[0];

            // Parse title from "Name - Title - Company | LinkedIn"
            const raw = (r.title || "").replace(/\s*\|\s*LinkedIn$/i, "").trim();
            const parts = raw.split(" - ").map((s: string) => s.trim());
            if (parts.length >= 3) {
              parsedTitle = parts[1];
              parsedCompany = parts[2];
            } else if (parts.length === 2) {
              parsedTitle = parts[1]; // "Name - Title"
            }
            break;
          }
        }

        if (linkedinUrl) {
          const realVmid = extractVmid(linkedinUrl);
          if (realVmid) {
            try {
              if (backfillTitles) {
                // Title backfill mode: contact already has URL, just update title
                await pool.query(`
                  UPDATE public.pli SET
                    title = COALESCE($1, title),
                    companyname = COALESCE($2, companyname),
                    updated_at = NOW()
                  WHERE vmid = $3
                `, [parsedTitle, parsedCompany, contact.vmid]);
              } else {
                // Discovery mode: update vmid, URL, and title
                await pool.query(`
                  UPDATE public.pli SET
                    vmid = $1,
                    linkedinprofileurl = $2,
                    profileurl = $2,
                    title = COALESCE($4, title),
                    companyname = COALESCE($5, companyname),
                    updated_at = NOW()
                  WHERE vmid = $3
                `, [realVmid, linkedinUrl, contact.vmid, parsedTitle, parsedCompany]);
              }
              found++;
            } catch {
              // vmid conflict — already exists
              notFound++;
            }
          }
        } else {
          notFound++;
        }

        if ((i + 1) % 20 === 0) {
          console.log(`  Progress: ${i + 1}/${pending.length} (found: ${found})`);
        }

        // Serper rate limit: ~50 req/s, but be conservative
        if (i < pending.length - 1) await new Promise(r => setTimeout(r, 200));

      } catch (err: any) {
        console.error(`  Error for "${fullName}": ${err.message}`);
        errors++;
        if (err.message.includes("credits") || err.message.includes("402")) {
          console.error("  API credits exhausted — stopping");
          break;
        }
      }
    }

    await run.complete({ recordsProcessed: found + notFound + errors, recordsSucceeded: found, recordsFailed: notFound + errors });

    console.log(`\n=== URL DISCOVERY SUMMARY ===`);
    console.log(`Found: ${found}`);
    console.log(`Not found: ${notFound}`);
    console.log(`Errors: ${errors}`);

    const { rows: [summary] } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE linkedinprofileurl IS NOT NULL) as with_url,
        COUNT(*) FILTER (WHERE vmid NOT LIKE 'pending_%') as with_real_vmid,
        COUNT(*) FILTER (WHERE buyer_persona_type IS NOT NULL) as classified
      FROM public.pli
    `);
    console.log(`\nPLI State: ${summary.total} total, ${summary.with_url} with URL, ${summary.with_real_vmid} real vmid, ${summary.classified} classified`);

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
