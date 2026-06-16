---
name: enrichment
description: Universal data enrichment — contacts, companies, posts, ads. Serper for URL discovery, BrightData for profile/company/post enrichment, OpenAI for ICP classification. Upstream dependency for linkedin-content, icp-development, graph-builder, onboarding, cold-email.
---

# Enrichment Skill

Universal enrichment pipeline for contacts, companies, LinkedIn posts, and LinkedIn ads. Client-agnostic — works with any `--profile` in `~/.dbt/profiles.yml`.

## When to Use

- Enriching PLI contacts with LinkedIn profile data (titles, seniority, industry)
- Discovering LinkedIn URLs for contacts that only have name + company
- Enriching CLI companies with industry, size, HQ location
- Classifying contacts into buyer personas (ICP classification)
- Scraping LinkedIn posts or ads data

## Cowork Setup

If you are a Cowork Claude starting in a client workspace:

1. **Install dependencies**: `cd .claude/skills/enrichment && npm install`
2. **Data access**: Use **Supabase MCP** (`execute_sql`) for read queries (checking PLI/CLI state, coverage counts). Scripts that write data or trigger enrichment require `--profile <client>` which connects via `~/.dbt/profiles.yml` (admin/dev path).
3. **Script invocation**: `npx tsx scripts/<name>.ts --profile <client> [--limit N] [--dry-run]`
4. **Dry-run first**: Always use `--dry-run` before committing to enrichment API calls (BrightData/Serper cost real credits).

## Script Reference

| Script | Purpose |
|--------|---------|
| `discover-urls.ts` | Find LinkedIn profile URLs via Serper |
| `discover-company-urls.ts` | Find LinkedIn company URLs via Serper | Polling; migrate to webhook for bulk |
`enrich-cli-companies-webhook.ts` | CLI company enrichment via async webhook | **Preferred** — fire-and-forget, see `references/brightdata-async-webhook.md` |
| `enrich-contacts.ts` | Enrich PLI with LinkedIn profile data (BrightData) |
| `enrich-companies.ts` | Enrich CLI with company data (BrightData) |
| `enrich-cli-companies.ts` | CLI company enrichment variant |
| `enrich-hubspot-contacts.ts` | HubSpot contact enrichment |
| `enrich-competitor-companies.ts` | Competitor company enrichment |
| `enrich-posts.ts` | Scrape LinkedIn posts |
| `discover_competitor_posts.ts` | Discover competitor employee + company posts (BrightData async webhook) |
| `enrich-ads.ts` | Scrape LinkedIn Ad Library |
| `enrich-all.ts` | Full pipeline: discover → contacts → companies → classify |
| `classify-contacts.ts` | Run ICP persona classification on PLI |
| `link-hubspot.ts` | Link PLI/CLI to HubSpot records |
| `ops-logger.ts` | Shared logging utility |
| `enrich-cli-companies.py` | Python fallback (no `dbt/profiles.yml` needed) |

See `references/brightdata-api-behavior.md` for BrightData API quirks and the 502 incident analysis.

## Prerequisites

- `public.pli` and `public.cli` tables exist (gtm-core module)
- `reference.persona_buckets` populated (for classification mode)
- `reference.prompt_library` has `persona_classification` prompt (for classification mode)
- Vault secrets: `BRIGHTDATA_API_KEY`, `SERPER_API_KEY` (for respective modes)
- `~/.dbt/profiles.yml` with target profile configured (admin/dev); or Supabase MCP for read-only queries

## Modes

### 1. Discover URLs (`discover-urls`)
Find LinkedIn profile URLs for contacts that only have name + company.

```bash
npx tsx scripts/discover-urls.ts --profile nodewin [--limit 50] [--dry-run]
```

**Flow**: PLI (pending vmid, no URL) → Serper Google SERP (`site:linkedin.com/in/ "name"`) → extract LinkedIn URL → update PLI vmid + linkedinprofileurl

### 2. Enrich Contacts (`enrich-contacts`)
Enrich PLI records with full LinkedIn profile data via BrightData.

```bash
npx tsx scripts/enrich-contacts.ts --profile nodewin [--limit 100] [--dry-run]
```

**Flow**: PLI (has LinkedIn URL, missing title/seniority) → BrightData person profile dataset → update PLI with title, summary, location, industry, seniority

### 3. Enrich Companies (`enrich-companies`)
Enrich CLI records with company data via BrightData. Three source modes:

```bash
# PLI source (default): companies from PLI not yet in CLI
npx tsx scripts/enrich-companies.ts --profile nodewin [--limit 200] [--dry-run]

# CRM source: HubSpot companies not yet in CLI
npx tsx scripts/enrich-companies.ts --profile nodewin --source crm --limit 1200

# CLI source: enrich existing CLI companies that have company_id but no linkedin_url
# Constructs URLs from numeric company_ids: https://www.linkedin.com/company/{id}
npx tsx scripts/enrich-companies.ts --profile nodewin --source cli --limit 10000
```

**Flow (cli source)**: CLI (company_id, no linkedin_url) → construct LinkedIn URL from company_id → BrightData company profile dataset → upsert CLI with linkedin_url, website, hq_city, hq_country, description, etc.

**Python fallback**: When `~/.dbt/profiles.yml` doesn't exist for a client, use `scripts/enrich-cli-companies.py` which uses `supabase db query --linked` instead of direct PG connection. See `references/brightdata-cli-mapping.md` for column mapping details.

### 3b. Enrich Companies via Webhook (fire-and-forget)
For large-scale enrichment, use BrightData's async webhook delivery instead of polling. **Preferred** pattern for production runs.

See `devops/brightdata-webhook-pipeline` skill for full deployment playbook, prerequisites, patches, and fire-and-forget script. That skill covers ALL BrightData dataset types (companies, people, posts, jobs) — not just CLI enrichment.

**Quick summary:**
- Deploy `bd-webhook` edge function with `--no-verify-jwt --use-api`
- Set `BRIGHTDATA_API_KEY` and `SUPABASE_DB_URL` secrets
- Use direct PG connection (not PostgREST) for callbacks — PostgREST has PGRST002 on many instances
- Fire triggers with `notify=true&endpoint=bd-webhook/<type>` — no polling
- DB function must use `p_mode='upsert'` (not default `skip_existing`)

**Webhook mode (preferred)**: Instead of polling, trigger BrightData with `endpoint=bd-webhook/company&notify=true&uncompressed_webhook=true`. Results auto-ingest into CLI via `core.handle_bd_company_result(p_mode='upsert')`. See `references/edge-function-deployment.md` for deployment patterns and pitfalls.

**Pitfalls (Python fallback)**:
- No retry logic on transient API failures (502 Bad Gateway kills entire batch — see Wintercircus 2026-06-14: 800 succeeded, 7,271 failed)
- Polling is sequential and slow — prefer webhook mode (deploy `bd-webhook` + use `endpoint` param instead)
- Python stdout buffering in nohup mode hides progress for minutes
- Must hardcode `SUPABASE_BIN = \"/opt/homebrew/bin/supabase\"` for macOS nohup

### 4. Classify Contacts (`classify-contacts`)
Run ICP persona classification on enriched PLI records.

```bash
npx tsx scripts/classify-contacts.ts --profile nodewin [--limit 100] [--model gpt-4.1-mini]
```

**Flow**: PLI (has title, no buyer_persona_type) → load prompt from prompt_library → OpenAI structured output → update PLI buyer_persona_type + qualification

### 5. Enrich Posts (`enrich-posts`)
Scrape LinkedIn posts from person or company profiles via BrightData.

```bash
npx tsx scripts/enrich-posts.ts --profile nodewin --source pli [--limit 50] [--dry-run]
npx tsx scripts/enrich-posts.ts --profile nodewin --source cli [--limit 50]
npx tsx scripts/enrich-posts.ts --profile nodewin --urls "https://linkedin.com/in/johndoe"
npx tsx scripts/enrich-posts.ts --profile nodewin --source pli --use-engine
```

**Flow**: PLI/CLI LinkedIn URLs → BrightData LinkedIn Posts dataset (or deployed brightdata-engine with `--use-engine`) → upsert `public.linkedin_posts`

### 5b. Discover Competitor Posts (`discover-competitor-posts`)
Discover posts from competitor employees and company pages via BrightData `discover_by=profile_url` and `discover_by=company_url`. Async webhook pipeline — results auto-ingest via `bd-webhook` → `core.handle_bd_post_result`.

```bash
# Dry run — show what would be scraped
deno run --allow-net --allow-env --allow-read scripts/discover_competitor_posts.ts --dry-run

# Step 1: Employee posts (top 3 competitors by PLI count)
deno run --allow-net --allow-env --allow-read scripts/discover_competitor_posts.ts --step=employees --top=3

# Step 2: Company page posts (all competitors)
deno run --allow-net --allow-env --allow-read scripts/discover_competitor_posts.ts --step=companies

# Step 3+4: Backfill user_id (vmid from PLI) + company_id (from competitors)
deno run --allow-net --allow-env --allow-read scripts/discover_competitor_posts.ts --step=backfill

# Full pipeline (all 4 steps)
deno run --allow-net --allow-env --allow-read scripts/discover_competitor_posts.ts --step=all --top=5
```

**Flow**: `competitors.company_id` → `pli.defaultprofileurl` (employees) + `competitors.linkedin_url` (company pages) → BrightData `discover_new` with `discover_by=profile_url`/`company_url` → `bd-webhook/posts` → `core.handle_bd_post_result` → `linkedin_posts`

**Post-ingestion backfill**:
- Employee posts: `user_id` set to PLI `vmid` via slug normalization (`/in/<slug>` matching)
- Company posts: `user_id` set to `competitors.company_id` for Organization-type posts

**Prerequisites**:
- `brightdata-engine` deployed with `/trigger/posts/discover` route
- `bd-webhook` deployed with `--no-verify-jwt` (BrightData can't send auth headers)
- `BRIGHTDATA_DATASET_POSTS_ID` in vault
- `competitors` table populated with `company_id` + `linkedin_url`
- `pli` table populated with `company_id` + `defaultprofileurl`

**Env**: `SUPABASE_URL`, `SERVICE_BEARER_TOKEN`, `BRIGHTDATA_API_KEY`

### 6. Enrich Ads (`enrich-ads`)
Scrape LinkedIn Ad Library for competitor/company ads via deployed linkedin-ads-engine.

```bash
npx tsx scripts/enrich-ads.ts --profile nodewin [--dry-run]
npx tsx scripts/enrich-ads.ts --profile nodewin --companies "Conveo,Cuez"
npx tsx scripts/enrich-ads.ts --profile nodewin --direct --companies "Conveo"
```

**Flow**: `linkedin_ads_scraper.config` targets (or `--companies` flag) → deployed linkedin-ads-engine (default) or direct BrightData Web Unlocker (`--direct`) → upsert `public.linkedin_ad_creatives`

### 7. Full Pipeline (`enrich-all`)
Run all 4 steps in sequence: discover → enrich contacts → enrich companies → classify.

```bash
npx tsx scripts/enrich-all.ts --profile nodewin [--skip-discover] [--skip-classify]
```

### 8. Enrich HubSpot Contacts (`enrich-hubspot-contacts`)
Discover LinkedIn URLs for HubSpot CRM contacts via Serper, enrich via BrightData, and insert into PLI.

```bash
npx tsx scripts/enrich-hubspot-contacts.ts --profile dbt_cuez --mode tier2 [--limit 500] [--dry-run]
npx tsx scripts/enrich-hubspot-contacts.ts --profile dbt_cuez --mode tier2b [--limit 1000]
```

**Flow**: HubSpot contacts (name + company via COALESCE with associated company) → Serper LinkedIn URL discovery → BrightData person profile → upsert PLI + link hubspot_contact_id. Uses `core.enrichment_log` for dedup across runs.

- **tier2**: Contacts with job title (higher quality)
- **tier2b**: All contacts with name + company (including those without job title)

### 9. Data Spine Audit (`audit-spine`)
Audit the full identity resolution chain across all data sources. Reports coverage gaps and recommends next enrichment steps.

```bash
npx tsx scripts/audit-spine.ts --profile dbt_cuez
npx tsx scripts/audit-spine.ts --profile conveo --json
npx tsx scripts/audit-spine.ts --profile dbt_cuez --verbose
```

**Checks** (auto-skips if source table doesn't exist):
1. CRM contacts → PLI match rate
2. CRM companies → CLI match rate
3. Meeting participant → owner resolution
4. Competitor followers → PLI resolution
5. Network map → PLI resolution
6. LinkedIn Ads contacts/companies → PLI/CLI resolution
7. HeyReach/outreach leads → PLI resolution
8. Buyer persona classification coverage
9. PLI field completeness (email, title, LinkedIn URL, company_id, seniority)
10. Competitor employee post coverage (linkedin_posts joined to PLI via vmid, grouped by competitor)
11. Competitor company post coverage (linkedin_posts with account_type='Organization' joined to competitors)

**Config**: `references/audit-checks.yml` declares checks, SQL file refs, source tables, and PASS/WARN/FAIL thresholds.

**Cowork Execution**: When running in Claude Cowork (no `--profile`), read `audit-checks.yml` for the check list, read each SQL file from `scripts/sql/`, execute via `mcp__supabase__execute_sql`, apply thresholds from the YAML, and format the same report.

## Pitfalls

### BrightData Datasets API: 502 ≠ Rate Limiting

The BrightData **Datasets API** (`/datasets/v3/trigger`) does **not** have the 20/min 60/hour rate limit documented for the **Web Scraper API** (`/scrape`). It can handle rapid-fire trigger calls (tested: 8 requests in ~4s, all 200).

When the trigger endpoint returns `HTTP 502 Bad Gateway`, it is a **transient server-side outage**, not rate limiting. Rate limiting typically manifests as `429`, not `502`.

**Fix**: Both `enrich-cli-companies.ts` and `enrich-cli-companies.py` currently have **zero retry logic**. If a batch hits a 502, the entire batch is marked failed and the script moves on — burning through all remaining batches against a dying endpoint. Add exponential backoff retry on 5xx errors before giving up on a batch.

### BrightData Does Not Expose Rate Limit Headers

The API response headers contain no `X-RateLimit-*`, `Retry-After`, or similar fields. You cannot check remaining quota from response headers — test by sending a request.

### Python Fallback Script Limitations

`client_projects/{client}/scripts/enrich-cli-companies.py` exists as a fallback when `~/.dbt/profiles.yml` is not configured. It uses `supabase db query --linked` (CLI startup overhead per row) instead of direct PG. It has no retry logic and should only be used when the TypeScript version cannot connect. See `references/brightdata-api-behavior.md` for the full incident analysis.

### Always Check Existing Skill Scripts First

Before writing an ad-hoc script for a task, **always check the relevant skill's `scripts/` directory**. The enrichment skill already has `enrich-cli-companies.ts` — the Python fallback should only be created if the TS version genuinely cannot run in the current environment (missing `~/.dbt/profiles.yml`, no Node, etc.).

## Async Webhook Delivery (Preferred for Bulk Enrichment)

For bulk enrichment (CLI companies, PLI contacts), prefer BrightData's async webhook delivery over polling. See `references/brightdata-async-webhook.md` for full details.

### Why

Polling is sequential (trigger → block 20 min → upsert → next batch). 81 batches = ~27 hours. Webhook mode fires all triggers in parallel and BrightData delivers results as they complete — minutes, not hours. No blocking. No 502 vulnerability.

### Architecture

```
Script fires all triggers (with endpoint=bd-webhook/company) → exit
   ↓
BrightData processes in parallel
   ↓ (per-batch completion)
bd-webhook → core.handle_bd_company_result → public.cli
   ↓
Hermes cron monitors progress → Telegram
```

**Data plane**: Supabase bd-webhook + DB functions (fast, concurrent, zero-token)
**Control plane**: Hermes agent (orchestration, monitoring, downstream triggering)

### Prerequisite: bd-webhook Deployment

The `bd-webhook` edge function (`kits/supabase/functions/bd-webhook/index.ts`) must be deployed with `--no-verify-jwt`. Check per-client — DB functions may be deployed from migrations but the edge function is separate.

```bash
cd kits/supabase
supabase link --project-ref <client-ref>
supabase functions deploy bd-webhook --no-verify-jwt
```

### Hermes Webhook Mismatch

Do NOT use Hermes webhooks as the BrightData delivery target. Hermes expects HMAC-SHA256 signatures; BrightData sends an `auth_header`. Auth is incompatible. Use bd-webhook (no-verify-jwt) for data ingestion, Hermes for orchestration.

## Agent Usage

When the agent invokes this skill, determine which mode is needed:

1. **Check PLI state first** — always run a diagnostic query before choosing a mode:
```sql
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE vmid LIKE 'pending_%') as pending_vmid,
  COUNT(*) FILTER (WHERE linkedinprofileurl IS NOT NULL) as with_url,
  COUNT(*) FILTER (WHERE title IS NOT NULL AND title != '') as with_title,
  COUNT(*) FILTER (WHERE buyer_persona_type IS NOT NULL) as classified
FROM public.pli;
```

2. **Route to the right mode**:
   - `pending_vmid > 0` AND `with_url` is low → run `discover-urls` first
   - `with_url > with_title` → contacts have URLs but no profile data → run `enrich-contacts`
   - Companies needed → run `enrich-companies`
   - `with_title > classified` → contacts enriched but not classified → run `classify-contacts`
   - Competitor posts needed (for voice-builder, linkedin-content) → run `discover_competitor_posts.ts`
   - Everything needed → run `enrich-all`

3. **Present results** after each step with counts of what changed.

## Downstream Consumers

- `linkedin-content` — needs enriched + classified PLI for persona-targeted content
- `icp-development` — needs enriched PLI for ground truth datasets
- `onboarding-agent` — client contact enrichment during onboarding
- `graph-builder-coach` — contact → company edges for knowledge graph
- `cold-email` — persona-targeted email sequences

## References

- `references/brightdata-cli-mapping.md` — BrightData field → CLI column mapping (CLI source mode)
- `references/brightdata-webhook-api.md` — BrightData webhook API, trigger params, bd-webhook patches, PostgREST bypass
