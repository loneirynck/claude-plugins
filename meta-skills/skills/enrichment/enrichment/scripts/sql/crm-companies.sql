WITH cli_domains AS (
    SELECT company_id,
        lower(trim(regexp_replace(regexp_replace(website, '^https?://(www\.)?', ''), '/.*$', ''))) as domain
    FROM public.cli
    WHERE website IS NOT NULL AND website != ''
),
via_domain AS (
    SELECT DISTINCT h.id
    FROM hubspot.companies h
    JOIN cli_domains cd ON lower(trim(h.properties_domain)) = cd.domain
    WHERE h.properties_domain IS NOT NULL AND h.properties_domain != ''
),
via_linkedin AS (
    SELECT DISTINCT h.id
    FROM hubspot.companies h
    JOIN public.cli c ON c.linkedin_url = h.properties_linkedin_company_page
    WHERE h.properties_linkedin_company_page IS NOT NULL
    AND h.id NOT IN (SELECT id FROM via_domain)
),
via_name AS (
    SELECT DISTINCT h.id
    FROM hubspot.companies h
    JOIN public.cli c ON lower(trim(c.company_name)) = lower(trim(h.properties_name))
    WHERE h.properties_name IS NOT NULL
    AND h.id NOT IN (SELECT id FROM via_domain)
    AND h.id NOT IN (SELECT id FROM via_linkedin)
),
all_matched AS (
    SELECT id FROM via_domain
    UNION SELECT id FROM via_linkedin
    UNION SELECT id FROM via_name
),
summary AS (
    SELECT
        (SELECT count(*) FROM hubspot.companies) as total_hs,
        (SELECT count(*) FROM all_matched) as matched,
        (SELECT count(*) FROM via_domain) as via_domain,
        (SELECT count(*) FROM via_linkedin) as via_linkedin,
        (SELECT count(*) FROM via_name) as via_name
)
SELECT
    'crm_company_resolution' as metric_name,
    s.total_hs::bigint as total,
    s.matched::bigint as matched,
    round(100.0 * s.matched / NULLIF(s.total_hs, 0), 1) as match_pct,
    jsonb_build_object(
        'matched_via_domain', s.via_domain,
        'matched_via_linkedin', s.via_linkedin,
        'matched_via_name', s.via_name,
        'with_domain', (SELECT count(*) FROM hubspot.companies WHERE properties_domain IS NOT NULL AND properties_domain != ''),
        'with_linkedin', (SELECT count(*) FROM hubspot.companies WHERE properties_linkedin_company_page IS NOT NULL AND properties_linkedin_company_page != ''),
        'with_industry', (SELECT count(*) FROM hubspot.companies WHERE properties_industry IS NOT NULL AND properties_industry != ''),
        'cli_total', (SELECT count(*) FROM public.cli)
    ) as details
FROM summary s;
