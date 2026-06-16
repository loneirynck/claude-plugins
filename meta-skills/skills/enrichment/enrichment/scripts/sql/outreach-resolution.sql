-- HeyReach campaign leads resolved to PLI via linkedin slug
SELECT
    'outreach_resolution' as metric_name,
    (SELECT count(*) FROM heyreach.campaign_leads)::bigint as total,
    (SELECT count(*) FROM heyreach.campaign_leads l
     WHERE l.profile_url IS NOT NULL AND l.profile_url != ''
       AND EXISTS (
         SELECT 1 FROM public.pli p
         WHERE p.linkedinprofileurl IS NOT NULL
           AND LOWER(REGEXP_REPLACE(p.linkedinprofileurl, '.*linkedin\.com/in/([^/?]+).*', '\1'))
             = LOWER(REGEXP_REPLACE(l.profile_url, '.*linkedin\.com/in/([^/?]+).*', '\1'))
       )
    )::bigint as matched,
    round(100.0 * (SELECT count(*) FROM heyreach.campaign_leads l
     WHERE l.profile_url IS NOT NULL AND l.profile_url != ''
       AND EXISTS (
         SELECT 1 FROM public.pli p
         WHERE p.linkedinprofileurl IS NOT NULL
           AND LOWER(REGEXP_REPLACE(p.linkedinprofileurl, '.*linkedin\.com/in/([^/?]+).*', '\1'))
             = LOWER(REGEXP_REPLACE(l.profile_url, '.*linkedin\.com/in/([^/?]+).*', '\1'))
       )
    ) / NULLIF((SELECT count(*) FROM heyreach.campaign_leads), 0), 1) as match_pct,
    jsonb_build_object(
        'with_profile_url', (SELECT count(*) FROM heyreach.campaign_leads WHERE profile_url IS NOT NULL AND profile_url != ''),
        'with_email', (SELECT count(*) FROM heyreach.campaign_leads WHERE email_address IS NOT NULL AND email_address != ''),
        'total_campaigns', (SELECT count(DISTINCT campaign_id) FROM heyreach.campaign_leads)
    ) as details;
