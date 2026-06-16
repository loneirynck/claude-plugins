#!/usr/bin/env npx tsx
/**
 * Cross-system identity resolution: Link PLI ↔ HubSpot contacts.
 * Runs a priority cascade to match LinkedIn profiles to HubSpot CRM contacts,
 * writing hubspot_contact_id back into PLI.
 *
 * Priority cascade (highest accuracy first):
 *   1. LinkedIn URL match (normalized, case-insensitive)
 *   2. Email exact match (case-insensitive)
 *   3. Firstname + Lastname + Company fuzzy match
 *
 * Also links CLI ↔ HubSpot companies via domain/name match (report only, no FK write).
 *
 * Usage:
 *   npx tsx scripts/link-hubspot.ts --profile nodewin
 *   npx tsx scripts/link-hubspot.ts --profile conveo --dry-run
 *   npx tsx scripts/link-hubspot.ts --profile dbt_cuez --limit 500
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
    limit: Number(get("--limit") || "0"),
    dryRun: args.includes("--dry-run"),
  };
}

function normalizeUrl(url: string | null): string | null {
  if (!url) return null;
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "")
    .split("?")[0];
}

interface LinkResult {
  method: string;
  matched: number;
  skipped: number;
}

async function main() {
  const opts = parseArgs();
  const settings = loadSettings(opts.profile);
  const pool = new Pool(settings.pg);

  console.log(`\n${"=".repeat(60)}`);
  console.log("  IDENTITY RESOLUTION — PLI ↔ HubSpot");
  console.log("=".repeat(60));
  console.log(`  Profile: ${opts.profile}${opts.dryRun ? " [DRY RUN]" : ""}`);

  try {
    // Set longer statement timeout for large cross-joins
    await pool.query("SET statement_timeout = '300s'");

    // 1. Check existing state
    const { rows: [pliState] } = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(hubspot_contact_id) as linked,
             COUNT(*) - COUNT(hubspot_contact_id) as unlinked
      FROM public.pli`);
    console.log(`\n  PLI: ${pliState.total} total, ${pliState.linked} already linked, ${pliState.unlinked} unlinked`);

    if (Number(pliState.unlinked) === 0) {
      console.log("  All PLI records already linked. Nothing to do.");
      return;
    }

    // 2. Detect available fields on HubSpot
    // Centralized schema detection — detect all HubSpot contact column names upfront
    const { rows: hsColumns } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'hubspot' AND table_name = 'contacts'
      ORDER BY column_name`);
    const allHsCols = new Set(hsColumns.map((r: any) => r.column_name));

    // Resolve column names (varies per client: 'email' vs 'properties_email', etc.)
    const KNOWN_COLS = {
      linkedinUrl: ["properties_hs_linkedin_url", "properties_hublead_linkedin_profile_url"].find(c => allHsCols.has(c)) || null,
      email: ["email", "properties_email"].find(c => allHsCols.has(c)) || null,
      firstname: ["firstname", "properties_firstname"].find(c => allHsCols.has(c)) || null,
      lastname: ["lastname", "properties_lastname"].find(c => allHsCols.has(c)) || null,
      company: ["company", "properties_company"].find(c => allHsCols.has(c)) || null,
    };

    console.log(`  HubSpot columns: email=${KNOWN_COLS.email || "NONE"}, linkedin_url=${KNOWN_COLS.linkedinUrl || "NONE"}, name=${KNOWN_COLS.firstname || "NONE"}+${KNOWN_COLS.lastname || "NONE"}, company=${KNOWN_COLS.company || "NONE"}`);

    const results: LinkResult[] = [];
    const limitClause = opts.limit > 0 ? `LIMIT ${opts.limit}` : "";

    // --- Priority 1: LinkedIn URL match ---
    if (KNOWN_COLS.linkedinUrl) {
      console.log("\n--- Priority 1: LinkedIn URL match ---");
      const liCol = KNOWN_COLS.linkedinUrl;
      // Build a lookup from HubSpot LinkedIn URLs → contact ID (smaller table, fits in memory)
      const { rows: hsUrls } = await pool.query(`
        SELECT id, "${liCol}" as url FROM hubspot.contacts
        WHERE "${liCol}" IS NOT NULL AND "${liCol}" != ''`);
      const hsUrlMap = new Map<string, string>();
      for (const r of hsUrls) {
        const norm = (r.url as string).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").split("?")[0];
        hsUrlMap.set(norm, r.id);
      }
      console.log(`  HubSpot contacts with LinkedIn URL: ${hsUrlMap.size}`);

      // Batch through unlinked PLI with LinkedIn URLs
      const BATCH = 5000;
      let totalUrlMatched = 0;
      let offset = 0;
      while (true) {
        const { rows: pliRows } = await pool.query(`
          SELECT vmid, linkedinprofileurl FROM public.pli
          WHERE hubspot_contact_id IS NULL AND linkedinprofileurl IS NOT NULL AND linkedinprofileurl != ''
          ORDER BY vmid LIMIT $1 OFFSET $2`, [BATCH, offset]);
        if (pliRows.length === 0) break;

        for (const p of pliRows) {
          const norm = (p.linkedinprofileurl as string).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "").split("?")[0];
          const hsId = hsUrlMap.get(norm);
          if (hsId) {
            if (!opts.dryRun) {
              await pool.query("UPDATE public.pli SET hubspot_contact_id = $1 WHERE vmid = $2 AND hubspot_contact_id IS NULL", [hsId, p.vmid]);
            }
            totalUrlMatched++;
          }
        }
        offset += BATCH;
        if (opts.limit > 0 && offset >= opts.limit) break;
        if (pliRows.length < BATCH) break;
        process.stdout.write(`  Processed ${offset} PLI rows, ${totalUrlMatched} matches so far...\r`);
      }
      console.log(`  Found ${totalUrlMatched} LinkedIn URL matches`);
      if (totalUrlMatched > 0 && !opts.dryRun) console.log(`  Wrote ${totalUrlMatched} hubspot_contact_id values`);
      results.push({ method: "LinkedIn URL", matched: totalUrlMatched, skipped: 0 });
    } else {
      console.log("\n--- Priority 1: LinkedIn URL match — SKIPPED (no LinkedIn URL column in HubSpot) ---");
      results.push({ method: "LinkedIn URL", matched: 0, skipped: 1 });
    }

    // --- Priority 2: Email exact match ---
    console.log("\n--- Priority 2: Email exact match ---");
    let totalEmailMatched = 0;
    if (KNOWN_COLS.email) {
      const eCol = KNOWN_COLS.email;
      // Build email lookup from HubSpot
      const { rows: hsEmails } = await pool.query(`
        SELECT id, "${eCol}" as email FROM hubspot.contacts
        WHERE "${eCol}" IS NOT NULL AND "${eCol}" != ''`);
      const hsEmailMap = new Map<string, string>();
      for (const r of hsEmails) hsEmailMap.set((r.email as string).toLowerCase().trim(), r.id);
      console.log(`  HubSpot contacts with email: ${hsEmailMap.size}`);

      const BATCH = 5000;
      let offset = 0;
      while (true) {
        const { rows: pliRows } = await pool.query(`
          SELECT vmid, email FROM public.pli
          WHERE hubspot_contact_id IS NULL AND email IS NOT NULL AND email != ''
          ORDER BY vmid LIMIT $1 OFFSET $2`, [BATCH, offset]);
        if (pliRows.length === 0) break;
        for (const p of pliRows) {
          const hsId = hsEmailMap.get((p.email as string).toLowerCase().trim());
          if (hsId) {
            if (!opts.dryRun) {
              await pool.query("UPDATE public.pli SET hubspot_contact_id = $1 WHERE vmid = $2 AND hubspot_contact_id IS NULL", [hsId, p.vmid]);
            }
            totalEmailMatched++;
          }
        }
        offset += BATCH;
        if (opts.limit > 0 && offset >= opts.limit) break;
        if (pliRows.length < BATCH) break;
        process.stdout.write(`  Processed ${offset} PLI rows, ${totalEmailMatched} email matches so far...\r`);
      }
    } else {
      console.log("  No email column found in HubSpot contacts — skipping");
    }

    console.log(`  Found ${totalEmailMatched} email matches`);
    if (totalEmailMatched > 0 && !opts.dryRun) console.log(`  Wrote ${totalEmailMatched} hubspot_contact_id values`);
    results.push({ method: "Email", matched: totalEmailMatched, skipped: 0 });

    // --- Priority 3: Name + Company match ---
    console.log("\n--- Priority 3: Firstname + Lastname + Company match ---");
    let totalNameMatched = 0;
    let nameSkipped = 0;
    if (KNOWN_COLS.firstname && KNOWN_COLS.lastname && KNOWN_COLS.company) {
      const fnCol = KNOWN_COLS.firstname;
      const lnCol = KNOWN_COLS.lastname;
      const coCol = KNOWN_COLS.company;
      const { rows: nameMatches } = await pool.query(`
        SELECT DISTINCT ON (p.vmid) p.vmid, h.id as hs_id, p.fullname, p.companyname
        FROM public.pli p
        JOIN hubspot.contacts h ON LOWER(TRIM(p.firstname)) = LOWER(TRIM(h."${fnCol}"))
          AND LOWER(TRIM(p.lastname)) = LOWER(TRIM(h."${lnCol}"))
          AND LOWER(TRIM(p.companyname)) = LOWER(TRIM(h."${coCol}"))
        WHERE p.hubspot_contact_id IS NULL
          AND p.firstname IS NOT NULL AND p.firstname != ''
          AND p.lastname IS NOT NULL AND p.lastname != ''
          AND p.companyname IS NOT NULL AND p.companyname != ''
          AND h."${fnCol}" IS NOT NULL AND h."${fnCol}" != ''
          AND h."${lnCol}" IS NOT NULL AND h."${lnCol}" != ''
          AND h."${coCol}" IS NOT NULL AND h."${coCol}" != ''
        ${limitClause}`);

      console.log(`  Found ${nameMatches.length} name+company matches`);
      if (nameMatches.length > 0 && !opts.dryRun) {
        for (const m of nameMatches) {
          try {
            await pool.query(
              "UPDATE public.pli SET hubspot_contact_id = $1 WHERE vmid = $2 AND hubspot_contact_id IS NULL",
              [m.hs_id, m.vmid]
            );
            totalNameMatched++;
          } catch (err: any) {
            if (err.code === '23505') { nameSkipped++; continue; } // duplicate — skip
            throw err;
          }
        }
        console.log(`  Wrote ${totalNameMatched} hubspot_contact_id values (${nameSkipped} skipped as duplicates)`);
      } else {
        totalNameMatched = nameMatches.length;
      }
    } else {
      console.log("  Missing firstname/lastname/company columns in HubSpot — skipping");
    }
    results.push({ method: "Name+Company", matched: totalNameMatched, skipped: nameSkipped });

    // --- Company linking (report only) ---
    console.log("\n--- Company linking (CLI ↔ HubSpot Companies) ---");
    const { rows: [companyState] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM public.cli) as cli_total,
        (SELECT COUNT(*) FROM hubspot.companies) as hs_total`);

    // Detect company name column
    const { rows: hsCompCols } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='hubspot' AND table_name='companies'
      AND column_name IN ('name', 'properties_name')`);
    const hsCompNameCol = hsCompCols.find((r: any) => r.column_name === 'name')?.column_name
      || hsCompCols.find((r: any) => r.column_name === 'properties_name')?.column_name
      || null;

    let companyNameMatches = [{ matches: 0 }];
    if (hsCompNameCol) {
      const { rows } = await pool.query(`
        SELECT COUNT(*) as matches
        FROM public.cli c
        JOIN hubspot.companies h ON LOWER(TRIM(c.company_name)) = LOWER(TRIM(h."${hsCompNameCol}"))
        WHERE c.company_name IS NOT NULL AND h."${hsCompNameCol}" IS NOT NULL`);
      companyNameMatches = rows;
    } else {
      console.log("  No name column found in HubSpot companies — skipping");
    }

    console.log(`  CLI: ${companyState.cli_total}, HubSpot Companies: ${companyState.hs_total}`);
    console.log(`  Name matches: ${companyNameMatches[0].matches}`);

    // --- Final state ---
    const { rows: [finalState] } = await pool.query(`
      SELECT COUNT(*) as total,
             COUNT(hubspot_contact_id) as linked,
             COUNT(*) - COUNT(hubspot_contact_id) as unlinked
      FROM public.pli`);

    console.log(`\n${"=".repeat(60)}`);
    console.log("  RESULTS");
    console.log("=".repeat(60));
    console.log(`\n  Person Linking (PLI → HubSpot):`);
    for (const r of results) {
      const status = r.skipped ? "SKIPPED" : `${r.matched} linked`;
      console.log(`    ${r.method.padEnd(20)} ${status}`);
    }
    const totalNewLinks = results.reduce((s, r) => s + r.matched, 0);
    console.log(`    ${"─".repeat(35)}`);
    console.log(`    Total new links:   ${totalNewLinks}`);
    console.log(`\n  PLI State: ${finalState.total} total, ${finalState.linked} linked (${((Number(finalState.linked) / Number(finalState.total)) * 100).toFixed(0)}%), ${finalState.unlinked} unlinked`);
    console.log(`\n  Company Linking: ${companyNameMatches[0].matches} name matches (report only — no FK column)\n`);

  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error("Fatal:", e); process.exit(2); });
