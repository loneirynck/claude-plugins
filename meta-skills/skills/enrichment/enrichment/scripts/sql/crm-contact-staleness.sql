-- CRM Contact Staleness v2: domain-based comparison via CLI
-- Uses temp table approach for performance on free-tier Supabase

-- Step 1: Build comparison set in a single pass
-- For each CRM contact in PLI: get contact's CLI website + CRM company's CLI website
-- Then compare domains
WITH crm_base AS MATERIALIZED (
    SELECT
        p.hubspot_contact_id,
        p.company_id as pli_company_id,
        h.properties_associatedcompanyid,
        contact_cli.website as contact_website,
        crm_cli.website as crm_website
    FROM public.pli p
    JOIN hubspot.contacts h ON p.hubspot_contact_id::text = h.id::text
    -- Contact's current employer
    LEFT JOIN public.cli contact_cli ON contact_cli.company_id = p.company_id
    -- CRM company → CLI via crm_company_id FK (backfilled from domain/linkedin/name matching)
    LEFT JOIN public.cli crm_cli ON crm_cli.crm_company_id = h.properties_associatedcompanyid::bigint
    WHERE p.hubspot_contact_id IS NOT NULL
    AND p.company_id IS NOT NULL
),
comparison AS (
    SELECT
        hubspot_contact_id,
        CASE
          WHEN contact_website IS NULL OR contact_website = '' THEN 'contact_cli_no_domain'
          WHEN crm_website IS NULL OR crm_website = '' THEN 'crm_cli_no_domain'
          WHEN lower(trim(regexp_replace(regexp_replace(contact_website, '^https?://(www\.)?', ''), '/.*$', '')))
             = lower(trim(regexp_replace(regexp_replace(crm_website, '^https?://(www\.)?', ''), '/.*$', '')))
            THEN 'fresh'
          ELSE 'stale'
        END as status
    FROM crm_base
),
status_counts AS (
    SELECT
        count(*) FILTER (WHERE status = 'fresh') as fresh,
        count(*) FILTER (WHERE status = 'stale') as stale,
        count(*) FILTER (WHERE status IN ('fresh', 'stale')) as comparable,
        count(*) FILTER (WHERE status = 'contact_cli_no_domain') as contact_no_domain,
        count(*) FILTER (WHERE status = 'crm_cli_no_domain') as crm_no_domain
    FROM comparison
)
SELECT
    'crm_contact_staleness' as metric_name,
    sc.comparable::bigint as total,
    sc.fresh::bigint as matched,
    round(100.0 * sc.fresh / NULLIF(sc.comparable, 0), 1) as match_pct,
    jsonb_build_object(
        'total_crm_contacts', (SELECT count(*) FROM hubspot.contacts),
        'in_pli', (SELECT count(*) FROM crm_base),
        'pli_has_cli', (SELECT count(*) FROM crm_base WHERE contact_website IS NOT NULL),
        'crm_company_has_cli', (SELECT count(*) FROM crm_base WHERE crm_website IS NOT NULL),
        'comparable', sc.comparable,
        'fresh', sc.fresh,
        'stale', sc.stale,
        'contact_cli_no_domain', sc.contact_no_domain,
        'crm_cli_no_domain', sc.crm_no_domain,
        'stale_pct', round(100.0 * sc.stale / NULLIF(sc.comparable, 0), 1)
    ) as details
FROM status_counts sc;
