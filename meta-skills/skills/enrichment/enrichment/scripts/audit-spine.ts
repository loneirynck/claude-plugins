#!/usr/bin/env npx tsx
/**
 * Data Spine Audit — enrichment skill endpoint.
 * Audits the full identity resolution chain across all data sources.
 * Reports coverage gaps and recommends next enrichment steps.
 *
 * Usage:
 *   npx tsx scripts/audit-spine.ts --profile dbt_cuez
 *   npx tsx scripts/audit-spine.ts --profile conveo --json
 *   npx tsx scripts/audit-spine.ts --profile dbt_cuez --verbose
 */

import { loadSettings } from "../../shared/settings.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import YAML from "yaml";

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

interface AuditCheck {
  name: string;
  description: string;
  sql: string;
  source_table: string;
  alt_source_table?: string;
  thresholds: { warn: number; fail: number };
  recommendation?: string;
}

interface CheckResult {
  name: string;
  description: string;
  status: "PASS" | "WARN" | "FAIL" | "SKIP" | "ERROR";
  metric_name?: string;
  total?: number;
  matched?: number;
  match_pct?: number;
  details?: Record<string, any>;
  recommendation?: string;
  error?: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  return {
    profile: get("--profile"),
    json: args.includes("--json"),
    verbose: args.includes("--verbose"),
  };
}

async function getAvailableTables(pool: pg.Pool): Promise<Set<string>> {
  const { rows } = await pool.query(`
    SELECT table_schema || '.' || table_name as full_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
  `);
  return new Set(rows.map((r: any) => r.full_name));
}

function resolveSourceTable(
  check: AuditCheck,
  available: Set<string>
): string | null {
  if (available.has(check.source_table)) return check.source_table;
  if (check.alt_source_table && available.has(check.alt_source_table))
    return check.alt_source_table;
  return null;
}

async function runCheck(
  pool: pg.Pool,
  check: AuditCheck,
  available: Set<string>,
  verbose: boolean
): Promise<CheckResult> {
  const resolvedTable = resolveSourceTable(check, available);
  if (!resolvedTable) {
    return {
      name: check.name,
      description: check.description,
      status: "SKIP",
      recommendation: undefined,
    };
  }

  try {
    const sqlPath = join(__dirname, check.sql);
    let sql = readFileSync(sqlPath, "utf-8");

    // If alt_source_table was used, replace references in SQL
    if (resolvedTable !== check.source_table && check.alt_source_table) {
      // Replace krisp.raw_transcripts with fathom.raw_meetings etc.
      const primary = check.source_table.split(".");
      const alt = resolvedTable.split(".");
      sql = sql.replace(
        new RegExp(`${primary[0]}\\.${primary[1]}`, "g"),
        `${alt[0]}.${alt[1]}`
      );
    }

    if (verbose) console.log(`  Running: ${check.name} (${resolvedTable})`);

    const { rows } = await pool.query(sql);
    if (!rows[0]) {
      return {
        name: check.name,
        description: check.description,
        status: "ERROR",
        error: "Query returned no rows",
      };
    }

    const row = rows[0];
    const matchPct = Number(row.match_pct) || 0;
    let status: "PASS" | "WARN" | "FAIL";
    if (matchPct >= check.thresholds.warn) {
      status = "PASS";
    } else if (matchPct >= check.thresholds.fail) {
      status = "WARN";
    } else {
      status = "FAIL";
    }

    return {
      name: check.name,
      description: check.description,
      status,
      metric_name: row.metric_name,
      total: Number(row.total),
      matched: Number(row.matched),
      match_pct: matchPct,
      details: row.details,
      recommendation:
        status !== "PASS" ? check.recommendation : undefined,
    };
  } catch (err: any) {
    return {
      name: check.name,
      description: check.description,
      status: "ERROR",
      error: err.message,
    };
  }
}

function formatReport(results: CheckResult[], profile: string): string {
  const lines: string[] = [];
  const now = new Date().toISOString().split("T")[0];

  lines.push("");
  lines.push("=".repeat(70));
  lines.push(`  DATA SPINE AUDIT — ${profile}`);
  lines.push(`  ${now}`);
  lines.push("=".repeat(70));
  lines.push("");

  const maxNameLen = Math.max(...results.map((r) => r.description.length));

  for (const r of results) {
    const desc = r.description.padEnd(maxNameLen + 2);
    if (r.status === "SKIP") {
      lines.push(`  ${desc}SKIP    (source table not found)`);
    } else if (r.status === "ERROR") {
      lines.push(`  ${desc}ERROR   ${r.error}`);
    } else {
      const icon =
        r.status === "PASS" ? "PASS" : r.status === "WARN" ? "WARN" : "FAIL";
      const pct = `${r.match_pct}%`.padStart(6);
      const counts = `(${r.matched?.toLocaleString()} / ${r.total?.toLocaleString()})`;
      lines.push(`  ${desc}${icon}  ${pct}   ${counts}`);

      // Special handling for field_completeness — show per-field breakdown
      if (r.name === "field_completeness" && r.details) {
        for (const [field, pct] of Object.entries(r.details)) {
          const fieldPct = Number(pct);
          const marker = fieldPct < 30 ? " ← FAIL" : fieldPct < 70 ? " ← WARN" : "";
          lines.push(`    - ${field.padEnd(25)}${fieldPct}%${marker}`);
        }
      }
    }
  }

  // Recommendations section
  const recs = results.filter((r) => r.recommendation);
  if (recs.length > 0) {
    lines.push("");
    lines.push("  RECOMMENDED NEXT STEPS:");
    recs.forEach((r, i) => {
      lines.push(`  ${i + 1}. ${r.recommendation}`);
    });
  }

  lines.push("");
  lines.push("=".repeat(70));
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs();
  if (!opts.profile) {
    console.error("Usage: npx tsx scripts/audit-spine.ts --profile <name>");
    process.exit(1);
  }

  const settings = loadSettings(opts.profile);
  const pool = new Pool(settings.pg);

  try {
    // Load audit checks config
    const configPath = join(__dirname, "..", "references", "audit-checks.yml");
    const config = YAML.parse(readFileSync(configPath, "utf-8"));
    const checks: AuditCheck[] = config.checks;

    // Auto-detect available tables
    if (opts.verbose) console.log("Detecting available data sources...");
    const available = await getAvailableTables(pool);
    if (opts.verbose) {
      const schemas = new Set([...available].map((t) => t.split(".")[0]));
      console.log(`  Schemas found: ${[...schemas].sort().join(", ")}`);
    }

    // Run all checks
    const results: CheckResult[] = [];
    for (const check of checks) {
      const result = await runCheck(pool, check, available, opts.verbose);
      results.push(result);
    }

    // Output
    if (opts.json) {
      console.log(JSON.stringify({ profile: opts.profile, date: new Date().toISOString(), results }, null, 2));
    } else {
      console.log(formatReport(results, opts.profile));
    }

    // Exit code: 1 if any FAIL, 0 otherwise
    const hasFail = results.some((r) => r.status === "FAIL");
    process.exit(hasFail ? 1 : 0);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Audit failed:", err.message);
  process.exit(2);
});
