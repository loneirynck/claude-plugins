SELECT
    'persona_coverage' as metric_name,
    count(*)::bigint as total,
    count(*) FILTER (WHERE buyer_persona_type IS NOT NULL)::bigint as matched,
    round(100.0 * count(*) FILTER (WHERE buyer_persona_type IS NOT NULL) / NULLIF(count(*), 0), 1) as match_pct,
    jsonb_build_object(
        'with_title', count(*) FILTER (WHERE title IS NOT NULL AND title != ''),
        'classifiable', count(*) FILTER (WHERE title IS NOT NULL AND title != '' AND buyer_persona_type IS NULL)
    ) as details
FROM public.pli;
