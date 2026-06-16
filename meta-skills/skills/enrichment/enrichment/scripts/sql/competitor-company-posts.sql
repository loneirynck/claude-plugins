SELECT
    'competitor_company_posts' as metric_name,
    count(DISTINCT c.name)::bigint as total,
    count(DISTINCT CASE WHEN lp.id IS NOT NULL THEN c.name END)::bigint as matched,
    round(100.0 * count(DISTINCT CASE WHEN lp.id IS NOT NULL THEN c.name END) / NULLIF(count(DISTINCT c.name), 0), 1) as match_pct,
    jsonb_build_object(
        'total_company_posts', count(lp.id),
        'competitors_with_posts', count(DISTINCT CASE WHEN lp.id IS NOT NULL THEN c.name END),
        'competitors_without_posts', count(DISTINCT c.name) - count(DISTINCT CASE WHEN lp.id IS NOT NULL THEN c.name END),
        'posts_per_competitor', (
            SELECT jsonb_agg(jsonb_build_object('name', sub.name, 'posts', sub.cnt))
            FROM (
                SELECT c2.name, count(lp2.id) as cnt
                FROM public.competitors c2
                JOIN public.linkedin_posts lp2 ON lp2.user_id = c2.company_id::text
                WHERE lp2.account_type = 'Organization'
                GROUP BY c2.name ORDER BY cnt DESC LIMIT 10
            ) sub
        )
    ) as details
FROM public.competitors c
LEFT JOIN public.linkedin_posts lp ON lp.user_id = c.company_id::text AND lp.account_type = 'Organization'
WHERE c.linkedin_url IS NOT NULL;
