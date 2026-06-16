-- Network map prospects resolved to PLI via prospect_vmid
SELECT
    'network_map_resolution' as metric_name,
    (SELECT count(*) FROM public.network_map)::bigint as total,
    (SELECT count(*) FROM public.network_map nm
     WHERE EXISTS (SELECT 1 FROM public.pli p WHERE p.vmid = nm.prospect_vmid)
    )::bigint as matched,
    round(100.0 * (SELECT count(*) FROM public.network_map nm
     WHERE EXISTS (SELECT 1 FROM public.pli p WHERE p.vmid = nm.prospect_vmid)
    ) / NULLIF((SELECT count(*) FROM public.network_map), 0), 1) as match_pct,
    jsonb_build_object(
        'unique_prospects', (SELECT count(DISTINCT prospect_vmid) FROM public.network_map),
        'unique_sources', (SELECT count(DISTINCT source_vmid) FROM public.network_map),
        'source_types', (SELECT jsonb_object_agg(source_type, cnt) FROM (
            SELECT source_type, count(*) as cnt FROM public.network_map GROUP BY source_type
        ) sub)
    ) as details;
