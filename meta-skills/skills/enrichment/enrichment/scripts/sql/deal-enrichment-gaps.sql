WITH deal_companies AS (
    SELECT DISTINCT c.id, c.properties_name, c.properties_domain, c.properties_linkedin_company_page
    FROM hubspot.deals d
    JOIN hubspot.companies c ON d.properties_hs_primary_associated_company::text = c.id::text
),
cli_domain AS (
    SELECT DISTINCT dc.id, cli.company_id
    FROM deal_companies dc
    JOIN public.cli ON lower(trim(regexp_replace(regexp_replace(cli.website, '^https?://(www\.)?', ''), '/.*$', ''))) = lower(trim(dc.properties_domain))
    WHERE dc.properties_domain IS NOT NULL AND dc.properties_domain != ''
    AND cli.website IS NOT NULL AND cli.website != ''
),
cli_linkedin AS (
    SELECT DISTINCT dc.id, cli.company_id
    FROM deal_companies dc
    JOIN public.cli ON cli.linkedin_url = dc.properties_linkedin_company_page
    WHERE dc.properties_linkedin_company_page IS NOT NULL
    AND dc.id NOT IN (SELECT id FROM cli_domain)
),
cli_name_only AS (
    SELECT DISTINCT dc.id, cli.company_id
    FROM deal_companies dc
    JOIN public.cli ON lower(trim(cli.company_name)) = lower(trim(dc.properties_name))
    WHERE dc.id NOT IN (SELECT id FROM cli_domain)
    AND dc.id NOT IN (SELECT id FROM cli_linkedin)
    AND dc.properties_name IS NOT NULL
),
all_matched AS (
    SELECT id, company_id FROM cli_domain
    UNION
    SELECT id, company_id FROM cli_linkedin
    UNION
    SELECT id, company_id FROM cli_name_only
),
pli_counts AS (
    SELECT count(*) as cnt FROM public.pli
    WHERE company_id IN (SELECT company_id FROM all_matched)
),
summary AS (
    SELECT
        (SELECT count(*) FROM deal_companies) as total_dc,
        (SELECT count(DISTINCT id) FROM all_matched) as matched_dc,
        (SELECT count(*) FROM deal_companies WHERE properties_linkedin_company_page IS NOT NULL) as with_linkedin,
        (SELECT count(DISTINCT id) FROM cli_linkedin) as via_linkedin,
        (SELECT count(DISTINCT id) FROM cli_name_only) as via_name,
        (SELECT count(DISTINCT am.id) FROM all_matched am WHERE EXISTS (SELECT 1 FROM public.pli WHERE pli.company_id = am.company_id)) as with_pli,
        (SELECT cnt FROM pli_counts) as pli_at_deals
)
SELECT
    'deal_enrichment_gaps' as metric_name,
    s.total_dc::bigint as total,
    s.matched_dc::bigint as matched,
    round(100.0 * s.matched_dc / NULLIF(s.total_dc, 0), 1) as match_pct,
    jsonb_build_object(
        'deal_companies_with_linkedin', s.with_linkedin,
        'matched_via_domain', (SELECT count(DISTINCT id) FROM cli_domain),
        'matched_via_linkedin', s.via_linkedin,
        'matched_via_name', s.via_name,
        'with_pli_profiles', s.with_pli,
        'pli_total_at_deal_companies', s.pli_at_deals,
        'cli_total', (SELECT count(*) FROM public.cli)
    ) as details
FROM summary s;
