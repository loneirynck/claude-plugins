#!/usr/bin/env npx tsx
/**
 * ICP Classification for PLI records using prompt from reference.prompt_library.
 * Classifies unclassified contacts into buyer personas via OpenAI structured output.
 *
 * Usage: npx tsx scripts/classify-contacts.ts --profile nodewin [--limit 100] [--model gpt-4.1-mini]
 */

import { loadSettings, resolveOpenAIKey } from "../../shared/settings.js";
import pg from "pg";
import OpenAI from "openai";
import { ScriptRun } from "./ops-logger.js";

const { Pool } = pg;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  return {
    profile: get("--profile") || "nodewin",
    limit: Number(get("--limit") || "200"),
    model: get("--model"),
  };
}

async function main() {
  const opts = parseArgs();
  const settings = loadSettings(opts.profile);
  const openaiKey = await resolveOpenAIKey(settings);
  const pool = new Pool(settings.pg);
  const openai = new OpenAI({ apiKey: openaiKey });

  const run = new ScriptRun(pool, "enrichment_classify_contacts");

  try {
    // Load prompt from prompt_library
    const { rows: [prompt] } = await pool.query(`
      SELECT system_prompt, user_prompt, model, max_tokens, temperature, output_schema
      FROM reference.prompt_library
      WHERE prompt_key = 'persona_classification'
      ORDER BY version DESC LIMIT 1
    `);

    if (!prompt) throw new Error("No persona_classification prompt found in reference.prompt_library");

    const model = opts.model || prompt.model || "gpt-4.1-mini";
    console.log(`Using model: ${model}`);

    // Load unclassified PLI records with titles
    const { rows: unclassified } = await pool.query(`
      SELECT vmid, email, fullname, title, seniority, department,
             companyname, industry, location, summary
      FROM public.pli
      WHERE buyer_persona_type IS NULL
        AND title IS NOT NULL AND title != ''
      ORDER BY fullname
      LIMIT $1
    `, [opts.limit]);

    console.log(`Found ${unclassified.length} unclassified PLI records with titles`);
    await run.start({ profile: opts.profile, limit: opts.limit, model, unclassifiedCount: unclassified.length });
    if (unclassified.length === 0) {
      await run.complete({ recordsProcessed: 0, recordsSucceeded: 0, recordsFailed: 0 });
      const { rows: [counts] } = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE buyer_persona_type IS NULL AND (title IS NULL OR title = '')) as no_title,
          COUNT(*) FILTER (WHERE buyer_persona_type IS NOT NULL) as already_classified
        FROM public.pli
      `);
      console.log(`${counts.no_title} records without titles (need enrichment first), ${counts.already_classified} already classified`);
      return;
    }

    const rawSchema = JSON.parse(prompt.output_schema);
    const outputSchema = { ...rawSchema, additionalProperties: false };

    let classified = 0, errors = 0;
    const distribution: Record<string, number> = {};

    for (const record of unclassified) {
      const userPrompt = prompt.user_prompt
        .replace("{{title}}", record.title || "Unknown")
        .replace("{{seniority}}", record.seniority || "Unknown")
        .replace("{{department}}", record.department || "Unknown")
        .replace("{{company}}", record.companyname || "Unknown")
        .replace("{{industry}}", record.industry || "Unknown")
        .replace("{{location}}", record.location || "Unknown")
        .replace("{{summary}}", record.summary || "Not available");

      try {
        const response = await openai.chat.completions.create({
          model,
          messages: [
            { role: "system", content: prompt.system_prompt },
            { role: "user", content: userPrompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "persona_classification",
              schema: outputSchema,
              strict: true,
            },
          },
          max_tokens: Number(prompt.max_tokens) || 512,
          temperature: Number(prompt.temperature) || 0,
        });

        const result = JSON.parse(response.choices[0].message.content || "{}");

        await pool.query(`
          UPDATE public.pli SET
            buyer_persona_type = $1,
            buyer_persona_qualification = $2,
            buyer_persona_timestamp = NOW(),
            updated_at = NOW()
          WHERE vmid = $3
        `, [
          result.persona_key,
          JSON.stringify({ confidence: result.confidence, reasoning: result.reasoning }),
          record.vmid,
        ]);

        distribution[result.persona_key] = (distribution[result.persona_key] || 0) + 1;
        classified++;

        if (classified % 20 === 0) {
          console.log(`  Classified ${classified}/${unclassified.length}...`);
        }
      } catch (err: any) {
        console.error(`  Error classifying ${record.email || record.fullname}: ${err.message}`);
        errors++;
        if (err.status === 429) {
          console.log("  Rate limited, waiting 5s...");
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    }

    await run.complete({ recordsProcessed: classified + errors, recordsSucceeded: classified, recordsFailed: errors });

    console.log(`\n=== ICP CLASSIFICATION SUMMARY ===`);
    console.log(`Classified: ${classified}`);
    console.log(`Errors: ${errors}`);
    console.log(`Distribution:`);
    for (const [persona, count] of Object.entries(distribution).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${persona}: ${count}`);
    }

    const { rows: [final] } = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(buyer_persona_type) as classified,
        COUNT(*) FILTER (WHERE buyer_persona_type = 'no_match') as no_match
      FROM public.pli
    `);
    console.log(`\nPLI State: ${final.total} total, ${final.classified} classified, ${final.no_match} no_match`);

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
