SELECT
    'competitor_employee_posts' as metric_name,
    count(DISTINCT p.vmid)::bigint as total,
    count(DISTINCT CASE WHEN lp.user_id IS NOT NULL THEN p.vmid END)::bigint as matched,
    round(100.0 * count(DISTINCT CASE WHEN lp.user_id IS NOT NULL THEN p.vmid END) / NULLIF(count(DISTINCT p.vmid), 0), 1) as match_pct,
    jsonb_build_object(
        'total_posts', (SELECT count(*) FROM public.linkedin_posts WHERE user_id LIKE 'ACw%' OR user_id LIKE 'ACo%'),
        'unique_posters_with_vmid', count(DISTINCT CASE WHEN lp.user_id IS NOT NULL THEN p.vmid END),
        'competitors_covered', count(DISTINCT CASE WHEN lp.user_id IS NOT NULL THEN c.name END),
        'top_competitors', (
            SELECT jsonb_agg(jsonb_build_object('name', sub.name, 'employees', sub.cnt, 'posts', sub.posts))
            FROM (
                SELECT c2.name, count(DISTINCT p2.vmid) as cnt, count(lp2.id) as posts
                FROM public.competitors c2
                JOIN public.pli p2 ON p2.company_id = c2.company_id
                JOIN public.linkedin_posts lp2 ON lp2.user_id = p2.vmid
                WHERE c2.company_id IS NOT NULL
                GROUP BY c2.name ORDER BY posts DESC LIMIT 5
            ) sub
        )
    ) as details
FROM public.competitors c
JOIN public.pli p ON p.company_id = c.company_id
LEFT JOIN public.linkedin_posts lp ON lp.user_id = p.vmid
WHERE c.company_id IS NOT NULL
  AND p.defaultprofileurl IS NOT NULL;
