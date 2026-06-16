#!/usr/bin/env npx tsx
/**
 * Scrape LinkedIn posts via BrightData LinkedIn Posts dataset.
 * Input: LinkedIn profile URLs or company URLs → scrape their recent posts.
 * Output: upsert into public.linkedin_posts.
 *
 * Can use either:
 *   - Direct BrightData API (default, works everywhere)
 *   - Deployed brightdata-engine edge function (--use-engine flag)
 *
 * Usage: npx tsx scripts/enrich-posts.ts --profile nodewin --source pli [--limit 50] [--dry-run]
 *        npx tsx scripts/enrich-posts.ts --profile nodewin --source cli [--limit 50]
 *        npx tsx scripts/enrich-posts.ts --profile nodewin --urls "https://linkedin.com/in/johndoe"
 *        npx tsx scripts/enrich-posts.ts --profile nodewin --source pli --use-engine
 */

import { loadSettings } from "../../shared/settings.js";
import pg from "pg";

const { Pool } = pg;
const BD_POSTS_DATASET = "gd_lyy5im513j1wa2vn7h"; // BrightData LinkedIn Posts
const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 60;
const BATCH_SIZE = 50;

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };
  return {
    profile: get("--profile") || "nodewin",
    source: get("--source") || "pli",
    urls: get("--urls")?.split(",").map(u => u.trim()),
    limit: Number(get("--limit") || "50"),
    datasetId: get("--dataset-id") || BD_POSTS_DATASET,
    useEngine: args.includes("--use-engine"),
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

async function resolveEngineUrl(pool: pg.Pool): Promise<{ url: string; token: string }> {
  const { rows } = await pool.query(`
    SELECT name, decrypted_secret FROM vault.decrypted_secrets
    WHERE name IN ('SUPABASE_URL', 'SERVICE_BEARER_TOKEN')
  `);
  const secrets = Object.fromEntries(rows.map(r => [r.name, r.decrypted_secret]));
  if (!secrets.SUPABASE_URL || !secrets.SERVICE_BEARER_TOKEN) {
    throw new Error("Missing SUPABASE_URL or SERVICE_BEARER_TOKEN in vault for engine mode");
  }
  return { url: `${secrets.SUPABASE_URL}/functions/v1/brightdata-engine`, token: secrets.SERVICE_BEARER_TOKEN };
}

async function triggerDirect(apiKey: string, datasetId: string, inputs: Record<string, string>[]): Promise<string> {
  const res = await fetch(
    `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${datasetId}&include_errors=true`,
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

async function triggerViaEngine(engineUrl: string, token: string, urls: string[]): Promise<any[]> {
  const res = await fetch(`${engineUrl}/trigger/posts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!res.ok) throw new Error(`Engine trigger failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  // Engine returns snapshot_id — poll via engine
  if (data.snapshot_id) {
    console.log(`  Engine snapshot: ${data.snapshot_id}`);
    // Poll via engine's snapshot endpoint
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      const pollRes = await fetch(`${engineUrl}/snapshot/${data.snapshot_id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (pollRes.status === 200) return pollRes.json();
      if (pollRes.status === 202) {
        console.log(`  Polling engine... attempt ${i + 1}/${MAX_POLL_ATTEMPTS}`);
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      throw new Error(`Engine poll failed (${pollRes.status}): ${await pollRes.text()}`);
    }
    throw new Error("Engine polling timed out");
  }
  return data.results || [];
}

async function upsertPosts(pool: pg.Pool, posts: any[]): Promise<number> {
  let count = 0;
  for (const post of posts) {
    const postId = post.id || post.post_id || post.url?.split("/").pop();
    if (!postId) continue;

    try {
      await pool.query(`
        INSERT INTO public.linkedin_posts (
          id, title, headline, post_text, post_text_html,
          date_posted, hashtags, embedded_links, images, videos,
          post_type, account_type, num_likes, num_comments,
          top_visible_comments, user_id, user_url,
          user_followers, user_posts, user_articles,
          discovery_input, input_url, raw_json,
          "timestamp", created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
          $21, $22, $23, NOW(), NOW(), NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          num_likes = COALESCE(EXCLUDED.num_likes, linkedin_posts.num_likes),
          num_comments = COALESCE(EXCLUDED.num_comments, linkedin_posts.num_comments),
          top_visible_comments = COALESCE(EXCLUDED.top_visible_comments, linkedin_posts.top_visible_comments),
          updated_at = NOW()
      `, [
        postId,
        post.title || null,
        post.headline || null,
        post.post_text || post.text || null,
        post.post_text_html || null,
        post.date_posted || post.posted_at || null,
        post.hashtags || null,
        post.embedded_links || null,
        post.images || null,
        post.videos || null,
        post.post_type || post.type || null,
        post.account_type || null,
        post.num_likes || post.likes || null,
        post.num_comments || post.comments || null,
        post.top_visible_comments ? JSON.stringify(post.top_visible_comments) : null,
        post.user_id || post.author_id || null,
        post.user_url || post.author_url || null,
        post.user_followers || null,
        post.user_posts || null,
        post.user_articles || null,
        post.discovery_input || null,
        post.input_url || post.url || null,
        JSON.stringify(post),
      ]);
      count++;
    } catch { /* skip conflicts */ }
  }
  return count;
}

async function main() {
  const opts = parseArgs();
  const settings = loadSettings(opts.profile);
  const pool = new Pool(settings.pg);

  try {
    // Build input URLs based on source
    let inputUrls: string[] = [];

    if (opts.urls) {
      inputUrls = opts.urls;
    } else if (opts.source === "pli") {
      const { rows } = await pool.query(`
        SELECT DISTINCT linkedinprofileurl FROM public.pli
        WHERE linkedinprofileurl IS NOT NULL
        ORDER BY linkedinprofileurl LIMIT $1
      `, [opts.limit]);
      inputUrls = rows.map(r => r.linkedinprofileurl);
    } else if (opts.source === "cli") {
      const { rows } = await pool.query(`
        SELECT DISTINCT linkedin_url FROM public.cli
        WHERE linkedin_url IS NOT NULL
        ORDER BY linkedin_url LIMIT $1
      `, [opts.limit]);
      inputUrls = rows.map(r => r.linkedin_url);
    }

    console.log(`Found ${inputUrls.length} profiles/companies to scrape posts from`);
    if (inputUrls.length === 0) return;

    if (opts.dryRun) {
      console.log("\n[DRY RUN] Would scrape posts for:");
      inputUrls.slice(0, 10).forEach(u => console.log(`  ${u}`));
      if (inputUrls.length > 10) console.log(`  ... and ${inputUrls.length - 10} more`);
      return;
    }

    let totalInserted = 0;

    if (opts.useEngine) {
      // Route through deployed brightdata-engine
      const engine = await resolveEngineUrl(pool);
      for (let i = 0; i < inputUrls.length; i += BATCH_SIZE) {
        const batch = inputUrls.slice(i, i + BATCH_SIZE);
        console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} profiles (via engine)`);
        try {
          const results = await triggerViaEngine(engine.url, engine.token, batch);
          totalInserted += await upsertPosts(pool, results);
        } catch (err: any) {
          console.error(`  Batch failed: ${err.message}`);
        }
      }
    } else {
      // Direct BrightData API
      const bdKey = await resolveBrightDataKey(pool);
      for (let i = 0; i < inputUrls.length; i += BATCH_SIZE) {
        const batch = inputUrls.slice(i, i + BATCH_SIZE);
        console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} profiles (direct API)`);
        const inputs = batch.map(url => ({ url }));
        try {
          const snapshotId = await triggerDirect(bdKey, opts.datasetId, inputs);
          console.log(`  Snapshot: ${snapshotId}`);
          const results = await pollSnapshot(bdKey, snapshotId);
          console.log(`  Got ${results.length} posts`);
          totalInserted += await upsertPosts(pool, results);
        } catch (err: any) {
          console.error(`  Batch failed: ${err.message}`);
        }
      }
    }

    console.log(`\n=== POST ENRICHMENT SUMMARY ===`);
    console.log(`Inserted/Updated: ${totalInserted}`);

    const { rows: [summary] } = await pool.query(`
      SELECT COUNT(*) as total,
        COUNT(DISTINCT user_id) as unique_authors,
        COUNT(*) FILTER (WHERE num_likes > 0) as with_engagement
      FROM public.linkedin_posts
    `);
    console.log(`\nLinkedIn Posts: ${summary.total} total, ${summary.unique_authors} authors, ${summary.with_engagement} with engagement`);

  } finally {
    await pool.end();
  }
}

main().catch(console.error);
