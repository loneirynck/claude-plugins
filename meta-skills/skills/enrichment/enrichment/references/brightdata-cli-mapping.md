# BrightData → CLI Column Mapping

Maps BrightData `linkedin_company_profile` pipeline output to `public.cli` columns.

## BrightData Output Fields

```json
{
  "id": "company-slug",
  "name": "Company Name",
  "company_id": "12345678",
  "url": "https://www.linkedin.com/company/...",
  "website": "https://example.com",
  "industries": "Software Development",
  "company_size": "51-200 employees",
  "employees_in_linkedin": 150,
  "locations": ["Street City, Region PostalCode, CC"],
  "country_code": "BE",
  "about": "Description text...",
  "slogan": "Tagline text",
  "organization_type": "Privately Held",
  "followers": 5000,
  "founded": 2020,
  "employees": [...]
}
```

## Column Mapping

| CLI Column | BrightData Field | Notes |
|---|---|---|
| `company_id` | `company_id` or `id` | Prefer numeric. Hash name if slug-only |
| `company_name` | `name` | |
| `website` | `website` | |
| `universal_name` | `id` | The slug, not numeric ID |
| `industry` | `industries` | |
| `employee_count` | `company_size` (parsed) | Regex `[\d,]+` from size string |
| `employee_count_range` | `company_size` (raw) | e.g. "51-200 employees" |
| `hq_city` | `locations[0]` first segment | Split on comma |
| `hq_country` | `country_code` | More reliable than parsing locations |
| `hq_line1` | `locations[0]` first segment | Full first segment |
| `hq_postalcode` | `locations[0]` second segment | Regex `\b(\d{4,6})\b` |
| `hq_geographicalarea` | `country_code` | |
| `company_type` | `organization_type` | |
| `description` | `about` | |
| `tagline` | `slogan` | NOT `tagline` |
| `linkedin_url` | `url` | |
| `followercount` | `followers` | |
| `founded` | `founded` | Cast to string |
| `url` | `website` | Same as website |
| `enrichment_timestamp` | — | Set to NOW() |

## Pitfalls

1. `locations` array, not `headquarters` string. Use `locations[0]`.
2. `slogan` not `tagline`.
3. `country_code` for country — more reliable than parsing locations.
4. Float company_ids: `int(float(x))` before URL construction.
5. Numeric URLs accepted: `/company/{numeric_id}` works.
6. No `created_at`/`updated_at` on some CLI tables — verify with `information_schema.columns`.
7. Batch size: 100 per snapshot, poll every 10s, max 120 attempts.
8. `employees` array not mapped to CLI — goes to PLI if needed.
9. **macOS nohup + SSL**: Python 3.12 (used by nohup on macOS) lacks system CA certs. Fix: `ssl.create_default_context()` + `check_hostname=False` + `verify_mode=ssl.CERT_NONE`, or install `certifi` for the specific Python version.
10. **macOS nohup + PATH**: `supabase` CLI not found under nohup. Fix: hardcode `SUPABASE_BIN = "/opt/homebrew/bin/supabase"` in scripts.
11. **CLI schema varies per client**: Always check `information_schema.columns` before writing upsert SQL. Some clients have `created_at`/`updated_at`, others have `timestamp`/`enrichment_timestamp`. Never assume.
12. **`--source cli` mode**: When CLI has `company_id` but no `linkedin_url`, construct URLs as `https://www.linkedin.com/company/{int(float(company_id))}`. The `int(float())` handles float-stored IDs from Supabase's numeric type.
13. **Python fallback**: When `~/.dbt/profiles.yml` doesn't exist for a client, use `enrich-cli-companies.py` which uses `supabase db query --linked` instead of direct PG. Located at `client_projects/<client>/scripts/enrich-cli-companies.py`.
