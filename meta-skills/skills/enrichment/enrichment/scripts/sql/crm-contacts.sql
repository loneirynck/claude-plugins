SELECT
    'crm_contact_resolution' as metric_name,
    (SELECT count(*) FROM hubspot.contacts)::bigint as total,
    (SELECT count(DISTINCT hubspot_contact_id) FROM public.pli WHERE hubspot_contact_id IS NOT NULL)::bigint as matched,
    round(100.0 * (SELECT count(DISTINCT hubspot_contact_id) FROM public.pli WHERE hubspot_contact_id IS NOT NULL)
        / NULLIF((SELECT count(*) FROM hubspot.contacts), 0), 1) as match_pct,
    jsonb_build_object(
        'with_email', (SELECT count(*) FROM hubspot.contacts WHERE properties_email IS NOT NULL),
        'with_linkedin_url', (SELECT count(*) FROM hubspot.contacts WHERE properties_hs_linkedin_url IS NOT NULL AND properties_hs_linkedin_url != ''),
        'with_company', (SELECT count(*) FROM hubspot.contacts WHERE properties_company IS NOT NULL AND properties_company != ''),
        'with_jobtitle', (SELECT count(*) FROM hubspot.contacts WHERE properties_jobtitle IS NOT NULL AND properties_jobtitle != ''),
        'pli_total', (SELECT count(*) FROM public.pli)
    ) as details;
