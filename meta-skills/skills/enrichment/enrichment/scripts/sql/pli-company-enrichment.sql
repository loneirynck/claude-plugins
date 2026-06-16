WITH pli_companies AS (
    SELECT DISTINCT company_id
    FROM public.pli
    WHERE company_id IS NOT NULL
),
matched AS (
    SELECT pc.company_id
    FROM pli_companies pc
    JOIN public.cli ON cli.company_id = pc.company_id
),
missing AS (
    SELECT pc.company_id
    FROM pli_companies pc
    WHERE NOT EXISTS (SELECT 1 FROM public.cli WHERE cli.company_id = pc.company_id)
),
missing_profile_count AS (
    SELECT count(*) as cnt
    FROM public.pli p
    WHERE p.company_id IN (SELECT company_id FROM missing)
)
SELECT
    'pli_company_enrichment' as metric_name,
    (SELECT count(*) FROM pli_companies)::bigint as total,
    (SELECT count(*) FROM matched)::bigint as matched,
    round(100.0 * (SELECT count(*) FROM matched) / NULLIF((SELECT count(*) FROM pli_companies), 0), 1) as match_pct,
    jsonb_build_object(
        'total_pli_profiles', (SELECT count(*) FROM public.pli),
        'pli_profiles_no_company_id', (SELECT count(*) FROM public.pli WHERE company_id IS NULL),
        'total_distinct_pli_companies', (SELECT count(*) FROM pli_companies),
        'matched_in_cli', (SELECT count(*) FROM matched),
        'missing_from_cli', (SELECT count(*) FROM missing),
        'pli_profiles_at_missing_companies', (SELECT cnt FROM missing_profile_count)
    ) as details;
