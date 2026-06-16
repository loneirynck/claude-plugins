# Supabase Edge Function Deployment & BrightData Webhook Integration

Deployment patterns, pitfalls, and the webhook-based enrichment architecture.

## Deploying to Remote Supabase (No Docker)

```bash
cd client_projects/<client>/supabase
supabase functions deploy <function-name> --no-verify-jwt --use-api
```

`--use-api` bundles server-side. Without it, the CLI tries Docker for local bundling and hangs indefinitely on machines without Docker running.

## Secret Management

`supabase secrets set KEY=value` populates **Deno.env**, NOT `vault.decrypted_secrets`.

Edge functions that call `getVaultSecrets()` (from `_shared/vault.ts`) read from `vault.decrypted_secrets` via an RPC call (`supabase.rpc('get_vault_secret')`). This RPC does not exist on all instances.

**Fix:** Read from `Deno.env.get()` as primary source, vault as fallback:
```typescript
const key = Deno.env.get('BRIGHTDATA_API_KEY') ?? null
if (!key) {
  // fallback to vault
}
```

## PostgREST Schema Visibility

Supabase JS client uses PostgREST under the hood. By default, only `public` and `graphql_public` schemas are exposed.

Calling `.schema('core').rpc('handle_bd_company_result')` from a Deno edge function fails with:
> "Could not query the database for the schema cache. Retrying."

**Fix options:**
1. Create `public` wrapper functions with `SECURITY DEFINER` that delegate to `core.*`
2. Skip `.schema()` for public-scope calls:
```typescript
const { data, error } = callback.schema === 'public'
  ? await supabase.rpc(callback.rpc, params)
  : await supabase.schema(callback.schema).rpc(callback.rpc, params)
```

## BrightData Webhook Delivery

### Trigger Parameters

The `endpoint` query parameter alone does NOT fire webhook delivery. You must also set `notify=true`:

```bash
curl -X POST "https://api.brightdata.com/datasets/v3/trigger?\
dataset_id=gd_l1vikfnt1wgvvqz95w&\
endpoint=<URL-encoded webhook URL>&\
notify=true&\
uncompressed_webhook=true&\
include_errors=true&\
format=json" \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"input":[{"url":"..."}]}'
```

### bd-webhook Edge Function

Deployed with `--no-verify-jwt` (BrightData can't send auth headers).

Routes: `POST /bd-webhook/:dataset_type`

Supported dataset types: `company`, `person`, `jobs`, `posts`, `people_search`

Each routes to a matching `core.handle_bd_*_result` DB callback function.

### Callback Modes

The DB callback functions accept `p_mode`:
- `skip_existing` (default): `ON CONFLICT DO NOTHING` — **wrong for enrichment**
- `upsert`: `ON CONFLICT DO UPDATE SET ... COALESCE(...)` — correct for enrichment
- `overwrite`: Force replace all fields including nulls

**Pitfall:** bd-webhook defaults to `skip_existing` if `p_mode` not passed. Existing companies silently dropped. Always pass `p_mode: 'upsert'` for enrichment workflows.

## Webhook Architecture: Supabase vs Hermes

| Concern | Supabase bd-webhook | Hermes webhooks |
|---|---|---|
| Auth | `--no-verify-jwt` (works) | HMAC-SHA256 (incompatible with BrightData's `auth_header`) |
| Concurrency | True parallel (each webhook = separate edge function invocation) | Sequential queue (one agent run at a time) |
| Token cost | $0 (SQL runs in Postgres) | ~$0.02-0.10 per batch (LLM agent run) |
| Intelligence | None (dumb pipe) | Full reasoning |

**Architecture:** Data plane = Supabase bd-webhook (fast, concurrent, zero-token). Control plane = Hermes agent (monitoring, orchestration, Telegram reporting).

## Wintercircus-Specific

- Project ref: `iluehlgaqueyhcqlnejs` ("Academy GTM")
- DB callbacks in `core` schema (need `public` wrappers)
- BD dataset: `gd_l1vikfnt1wgvvqz95w` (LinkedIn Company Profile)
- `bd-webhook` deployed with Deno.env secrets + public schema callbacks + p_mode upsert fix
