# BrightData Async Webhook Delivery

Prefers webhook over polling for bulk enrichment. Eliminates sequential polling latency and replaces it with fire-and-forget parallelism.

## Quick Reference

```
BrightData /trigger
   → endpoint=<bd-webhook-URL>
   → uncompressed_webhook=true
   → format=json
   → include_errors=true
   ↓ (async completion)
BrightData POSTs results → bd-webhook → core.handle_bd_<type>_result → DB table
```

## Endpoint URL Format

```
https://<project-ref>.supabase.co/functions/v1/bd-webhook/<dataset_type>
```

Dataset types: `company`, `person`, `jobs`, `posts`, `people_search`

## cURL Example (Company Enrichment)

```bash
curl -X POST "https://api.brightdata.com/datasets/v3/trigger?dataset_id=gd_l1vikfnt1wgvvqz95w&endpoint=https%3A%2F%2Filuehlgaqueyhcqlnejs.supabase.co%2Ffunctions%2Fv1%2Fbd-webhook%2Fcompany&uncompressed_webhook=true&include_errors=true&format=json" \
  -H "Authorization: Bearer $BRIGHTDATA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '[{"url":"https://www.linkedin.com/company/ID1"},{"url":"https://www.linkedin.com/company/ID2"}]'
```

## Prerequisites Per Client

1. `bd-webhook` Supabase edge function deployed with `--no-verify-jwt`
2. `core.handle_bd_company_result` (and other `handle_bd_*`) DB functions deployed (migration `003_brightdata_callbacks.sql`)
3. `BRIGHTDATA_API_KEY` in Supabase vault secrets

## Key Parameters

| Parameter | Value | Notes |
|-----------|-------|-------|
| `endpoint` | URL-encoded bd-webhook URL | BrightData POSTs results here on completion |
| `uncompressed_webhook` | `true` | Required for bd-webhook to parse the payload |
| `include_errors` | `true` | Includes error report with results |
| `format` | `json` | JSON array of result objects |
| `auth_header` | *omit* | bd-webhook uses `--no-verify-jwt`, no auth header needed |

## Why Webhook Over Polling

| Concern | Polling | Webhook |
|---------|---------|---------|
| Throughput | Sequential — one batch at a time (trigger → wait → upsert → next) | Parallel — fire all triggers, results stream in |
| 81 batches × 100 companies | ~27 hours | Minutes (parallel BrightData processing) |
| Resilience | Transient 502 kills batch with no recovery | Fire-and-forget; BrightData retries delivery |
| Token cost | Zero (script-only) | Zero (bd-webhook → SQL path) |
| Visibility | None until script completes | Hermes cron monitors enrichment progress |

## Rate Limits

Fact-checked against BrightData docs (`/datasets/v3/trigger` endpoint):
- **No documented rate limit** for async trigger endpoint
- Limited trial accounts: 100 req/min, enforced with HTTP 429 + error code `client_10110`
- 502 responses are transient server errors, NOT rate limiting

## Hermes Webhook Mismatch

Hermes webhooks expect HMAC-SHA256 signatures (`X-Hub-Signature-256`). BrightData sends an arbitrary `auth_header`. These auth mechanisms are incompatible. Do not attempt to use Hermes webhooks as the BrightData delivery endpoint.

**Correct architecture:**
- **Data plane**: BrightData → bd-webhook (no-verify-jwt) → DB functions → tables (fast, concurrent, zero-token)
- **Control plane**: Hermes cron monitors progress, triggers downstream tasks, reports to Telegram

## Deployment

```bash
# Deploy bd-webhook to client instance
cd kits/supabase
supabase link --project-ref <client-ref>
supabase functions deploy bd-webhook --no-verify-jwt
```

Verify: the bd-webhook `index.ts` at `kits/supabase/functions/bd-webhook/index.ts` routes `POST /bd-webhook/:dataset_type` → matching `core.handle_bd_<dataset_type>_result` DB function.
