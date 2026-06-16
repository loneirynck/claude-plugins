WITH deal_companies AS (
    SELECT DISTINCT c.id, c.properties_name, c.properties_domain, c.properties_linkedin_company_page
    FROM hubspot.deals d
    JOIN hubspot.companies c ON d.properties_hs_primary_associated_company::text = c.id::text
),
cli_via_domain AS (
    SELECT DISTINCT cli.company_id
    FROM deal_companies dc
    JOIN public.cli ON lower(trim(regexp_replace(regexp_replace(cli.website, '^https?://(www\.)?', ''), '/.*$', ''))) = lower(trim(dc.properties_domain))
    WHERE dc.properties_domain IS NOT NULL AND dc.properties_domain != ''
    AND cli.website IS NOT NULL AND cli.website != ''
),
cli_via_linkedin AS (
    SELECT DISTINCT cli.company_id
    FROM deal_companies dc
    JOIN public.cli ON cli.linkedin_url = dc.properties_linkedin_company_page
    WHERE dc.properties_linkedin_company_page IS NOT NULL
    AND cli.company_id NOT IN (SELECT company_id FROM cli_via_domain)
),
cli_via_name AS (
    SELECT DISTINCT cli.company_id
    FROM deal_companies dc
    JOIN public.cli ON lower(trim(cli.company_name)) = lower(trim(dc.properties_name))
    WHERE dc.properties_name IS NOT NULL
    AND cli.company_id NOT IN (SELECT company_id FROM cli_via_domain)
    AND cli.company_id NOT IN (SELECT company_id FROM cli_via_linkedin)
),
matched_cli AS (
    SELECT company_id FROM cli_via_domain
    UNION
    SELECT company_id FROM cli_via_linkedin
    UNION
    SELECT company_id FROM cli_via_name
),
deal_pli_agg AS (
    SELECT
        p.buyer_persona_type,
        count(*) as cnt
    FROM public.pli p
    JOIN matched_cli mc ON p.company_id = mc.company_id
    WHERE p.buyer_persona_type IS NOT NULL
    GROUP BY p.buyer_persona_type
),
totals AS (
    SELECT
        coalesce(sum(cnt), 0) as total_classified,
        coalesce(sum(cnt) FILTER (WHERE buyer_persona_type != 'no_match'), 0) as icp_matches,
        coalesce(sum(cnt) FILTER (WHERE buyer_persona_type = 'no_match'), 0) as no_match
    FROM deal_pli_agg
)
SELECT
    'deal_persona_coverage' as metric_name,
    t.total_classified::bigint as total,
    t.icp_matches::bigint as matched,
    round(100.0 * t.icp_matches / NULLIF(t.total_classified, 0), 1) as match_pct,
    jsonb_build_object(
        'persona_distribution', (SELECT jsonb_object_agg(buyer_persona_type, cnt) FROM deal_pli_agg),
        'deal_companies_in_cli', (SELECT count(*) FROM matched_cli),
        'total_icp_matches', t.icp_matches,
        'total_no_match', t.no_match
    ) as details
FROM totals t;
