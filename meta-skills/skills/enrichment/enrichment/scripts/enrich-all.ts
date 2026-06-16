#!/usr/bin/env npx tsx
/**
 * Full enrichment pipeline: discover URLs → enrich contacts → enrich companies → classify.
 *
 * Usage: npx tsx scripts/enrich-all.ts --profile nodewin [--skip-discover] [--skip-classify] [--dry-run]
 */

import { execSync } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  return {
    profile: get("--profile") || "nodewin",
    skipDiscover: args.includes("--skip-discover"),
    skipClassify: args.includes("--skip-classify"),
    dryRun: args.includes("--dry-run"),
  };
}

function run(script: string, profile: string, extraArgs: string[] = []) {
  const scriptPath = join(__dirname, script);
  const args = ["--profile", profile, ...extraArgs].join(" ");
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Running: ${script} ${args}`);
  console.log("=".repeat(60));

  try {
    execSync(`npx tsx "${scriptPath}" ${args}`, {
      stdio: "inherit",
      cwd: join(__dirname, ".."),
    });
  } catch (err: any) {
    console.error(`\nScript ${script} failed with exit code ${err.status}`);
    if (err.status !== 0) throw err;
  }
}

async function main() {
  const opts = parseArgs();
  const dryRunArgs = opts.dryRun ? ["--dry-run"] : [];

  console.log("=== FULL ENRICHMENT PIPELINE ===");
  console.log(`Profile: ${opts.profile}`);
  console.log(`Skip discover: ${opts.skipDiscover}`);
  console.log(`Skip classify: ${opts.skipClassify}`);
  console.log(`Dry run: ${opts.dryRun}`);

  // Step 1: Discover LinkedIn URLs
  if (!opts.skipDiscover) {
    run("discover-urls.ts", opts.profile, dryRunArgs);
  } else {
    console.log("\n[SKIP] URL discovery");
  }

  // Step 2: Backfill titles from Serper for contacts with URLs but no title
  if (!opts.skipDiscover) {
    run("discover-urls.ts", opts.profile, [...dryRunArgs, "--backfill-titles"]);
  }

  // Step 3: Enrich contacts (BrightData profile data)
  run("enrich-contacts.ts", opts.profile, dryRunArgs);

  // Step 4: Discover company LinkedIn URLs via Serper
  run("discover-company-urls.ts", opts.profile, dryRunArgs);

  // Step 5: Enrich companies (BrightData company profiles)
  run("enrich-companies.ts", opts.profile, dryRunArgs);

  // Step 5: Classify contacts
  if (!opts.skipClassify) {
    run("classify-contacts.ts", opts.profile, dryRunArgs);
  } else {
    console.log("\n[SKIP] ICP classification");
  }

  console.log("\n=== PIPELINE COMPLETE ===");
}

main().catch(console.error);
