-- Competitor followers resolved to PLI via linkedin URL slug match
-- Uses COALESCE(defaultprofileurl, linkedinprofileurl) because:
--   linkedinprofileurl = Sales Nav encoded (ACwAAA...) — rarely matches slugs
--   defaultprofileurl = human-readable slug — matches competitor_followers format
SELECT
    'competitor_follower_resolution' as metric_name,
    (SELECT count(*) FROM public.competitor_followers)::bigint as total,
    (SELECT count(*) FROM public.competitor_followers cf
     WHERE EXISTS (
         SELECT 1 FROM public.pli p
         WHERE LOWER(REGEXP_REPLACE(COALESCE(p.defaultprofileurl, p.linkedinprofileurl), '.*linkedin\.com/in/([^/?]+).*', '\1'))
             = LOWER(REGEXP_REPLACE(cf.linkedin_profile_url, '.*linkedin\.com/in/([^/?]+).*', '\1'))
         AND COALESCE(p.defaultprofileurl, p.linkedinprofileurl) IS NOT NULL
         AND cf.linkedin_profile_url IS NOT NULL
     )
    )::bigint as matched,
    round(100.0 * (SELECT count(*) FROM public.competitor_followers cf
     WHERE EXISTS (
         SELECT 1 FROM public.pli p
         WHERE LOWER(REGEXP_REPLACE(COALESCE(p.defaultprofileurl, p.linkedinprofileurl), '.*linkedin\.com/in/([^/?]+).*', '\1'))
             = LOWER(REGEXP_REPLACE(cf.linkedin_profile_url, '.*linkedin\.com/in/([^/?]+).*', '\1'))
         AND COALESCE(p.defaultprofileurl, p.linkedinprofileurl) IS NOT NULL
         AND cf.linkedin_profile_url IS NOT NULL
     )
    ) / NULLIF((SELECT count(*) FROM public.competitor_followers), 0), 1) as match_pct,
    jsonb_build_object(
        'unique_followers', (SELECT count(DISTINCT unique_identifier) FROM public.competitor_followers),
        'with_linkedin_url', (SELECT count(*) FROM public.competitor_followers WHERE linkedin_profile_url IS NOT NULL AND linkedin_profile_url != ''),
        'pli_with_defaultprofileurl', (SELECT count(*) FROM public.pli WHERE defaultprofileurl IS NOT NULL),
        'pli_total', (SELECT count(*) FROM public.pli)
    ) as details;
