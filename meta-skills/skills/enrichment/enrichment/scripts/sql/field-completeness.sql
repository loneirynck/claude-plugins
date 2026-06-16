SELECT
    'field_completeness' as metric_name,
    count(*)::bigint as total,
    count(*) FILTER (WHERE
        email IS NOT NULL AND email != ''
        AND title IS NOT NULL AND title != ''
        AND linkedinprofileurl IS NOT NULL
        AND company_id IS NOT NULL
    )::bigint as matched,
    round(100.0 * count(*) FILTER (WHERE
        email IS NOT NULL AND email != ''
        AND title IS NOT NULL AND title != ''
        AND linkedinprofileurl IS NOT NULL
        AND company_id IS NOT NULL
    ) / NULLIF(count(*), 0), 1) as match_pct,
    jsonb_build_object(
        'email', round(100.0 * count(*) FILTER (WHERE email IS NOT NULL AND email != '') / NULLIF(count(*), 0), 1),
        'title', round(100.0 * count(*) FILTER (WHERE title IS NOT NULL AND title != '') / NULLIF(count(*), 0), 1),
        'linkedin_url', round(100.0 * count(*) FILTER (WHERE linkedinprofileurl IS NOT NULL AND linkedinprofileurl != '') / NULLIF(count(*), 0), 1),
        'company_id', round(100.0 * count(*) FILTER (WHERE company_id IS NOT NULL) / NULLIF(count(*), 0), 1),
        'seniority', round(100.0 * count(*) FILTER (WHERE seniority IS NOT NULL AND seniority != '') / NULLIF(count(*), 0), 1),
        'hubspot_contact_id', round(100.0 * count(*) FILTER (WHERE hubspot_contact_id IS NOT NULL) / NULLIF(count(*), 0), 1),
        'buyer_persona_type', round(100.0 * count(*) FILTER (WHERE buyer_persona_type IS NOT NULL) / NULLIF(count(*), 0), 1)
    ) as details
FROM public.pli;
