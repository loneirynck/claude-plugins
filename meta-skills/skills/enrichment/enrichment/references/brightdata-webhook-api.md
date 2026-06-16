# BrightData Webhook API Reference

## Trigger Endpoint

```
POST https://api.brightdata.com/datasets/v3/trigger
```

### Query Parameters

| Param | Required | Description |
|-------|----------|-------------|
| `dataset_id` | Yes | e.g. `gd_l1vikfnt1wgvvqz95w` (LinkedIn Company Profile) |
| `endpoint` | Yes (for webhook) | URL-encoded webhook delivery URL |
| `notify` | Yes (for webhook) | Must be `true` — without it, results are stored but webhook never fires |
| `uncompressed_webhook` | No | `true` to avoid gzip on webhook payload |
| `include_errors` | No | `true` to include error records in results |
| `format` | No | `json`, `ndjson`, `jsonl`, `csv` |
| `auth_header` | No | Additional auth header BrightData sends to webhook endpoint |

### Request Body

```json
{"input": [{"url": "https://www.linkedin.com/company/12345"}, ...]}
```

Or bare array: `[{"url": "..."}]`

## Rate Limits

- **No documented rate limit** on `/datasets/v3/trigger` (Datasets API)
- The 20/min, 60/hour figure from third-party sites applies to `/scrape` (Web Scraper API), NOT `/datasets/v3/trigger`
- BrightData uses HTTP 429 for rate limiting (with error codes `client_10110`, `policy_20220`, `policy_20222`)
- HTTP 502 Bad Gateway = transient server outage, NOT rate limiting
- Trial accounts: 100 req/min cap, enforced with 429

## Webhook Delivery

When `notify=true` and `endpoint` are set:
1. BrightData processes the batch
2. On completion, POSTs results to the endpoint URL
3. Payload format: `{"snapshot_id": "sd_..."}` (BrightData sends snapshot ID, receiver downloads full data)
4. Or inline data array depending on configuration

## Snapshot Polling (alternative to webhook)

```
GET https://api.brightdata.com/datasets/v3/snapshot/{snapshot_id}?format=json
```

- HTTP 202 = still processing
- HTTP 200 = ready, returns JSON array of results

## BrightData → CLI Column Mapping

| BrightData field | CLI column | Notes |
|-----------------|------------|-------|
| `company_id` | `company_id` | Numeric, used as PK |
| `name` | `company_name` | |
| `url` | `linkedin_url` | |
| `website` | `website` | |
| `industries` | `industry` | |
| `company_size` | `employee_count` (parsed) + `employee_count_range` (raw) | Regex `[\d,]+` for count |
| `country_code` | `hq_country` | More reliable than parsing `headquarters` |
| `locations[0]` | `hq_city`, `hq_line1`, `hq_postalcode` | Comma-split parsing |
| `about` | `description` | |
| `slogan` | `tagline` | NOT `tagline` field |
| `followers` | `followercount` | |
| `founded` | `founded` | Cast to string |
| `organization_type` | `company_type` | |
| `id` (slug) | `universal_name` | |

**DB function gaps** (core.handle_bd_company_result):
- Does NOT set `hq_country` from `country_code` — parses from `headquarters` string instead
- Does NOT set `enrichment_timestamp`
- Does NOT map `url` (linkedin_url) correctly — uses different field path

## bd-webhook Edge Function

Deployed at: `https://{project_ref}.supabase.co/functions/v1/bd-webhook/company`

Deploy command:
```bash
supabase functions deploy bd-webhook --no-verify-jwt --use-api
```

Required secrets:
```bash
supabase secrets set BRIGHTDATA_API_KEY="<key>"
```

### Patches Applied (2026-06-15)

1. **Secret loading**: `Deno.env.get()` primary, vault fallback (vault RPC `get_vault_secret` may not exist)
2. **Callback mode**: Passes `p_mode: 'upsert'` (default `skip_existing` does ON CONFLICT DO NOTHING)
3. **Error checking**: Checks `executeCallback` return, returns 500 on failure (was silently swallowing)
4. **Direct PG connection**: Uses `SUPABASE_DB_URL` + Deno `postgres` module instead of PostgREST (PGRST002 bypass)
5. **Schema routing**: Changed from `core` schema to `public` wrapper functions (PostgREST can't see `core`)

### PostgREST PGRST002 Bypass

If PostgREST returns `PGRST002: Could not query the database for the schema cache`:
1. Create `public` wrapper functions (SECURITY DEFINER) that call `core.*` functions
2. Rewrite callback.ts to use direct PG connection via `SUPABASE_DB_URL`
3. Use `https://deno.land/x/postgres@v0.19.3/mod.ts` for Deno PG client
