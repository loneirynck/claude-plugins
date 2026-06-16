-- LinkedIn Ads: competitor + client ad scrape coverage
-- Checks how many registered scrape targets (linkedin_ads_scraper.config)
-- have been scraped AND have ad creatives in public.linkedin_ad_creatives.
-- Targets with scrape_count > 0 but 0 ads are counted as "scraped (no ads)" — acceptable.
SELECT
    'linkedin_ads_resolution' as metric_name,
    count(*)::bigint as total,
    count(*) FILTER (WHERE status != 'not_scraped')::bigint as matched,
    round(100.0 * count(*) FILTER (WHERE status != 'not_scraped') / NULLIF(count(*), 0), 1) as match_pct,
    jsonb_build_object(
        'total_targets', count(*),
        'scraped_with_ads', count(*) FILTER (WHERE status = 'has_ads'),
        'scraped_no_ads', count(*) FILTER (WHERE status = 'no_ads_found'),
        'not_scraped', count(*) FILTER (WHERE status = 'not_scraped'),
        'total_ad_creatives', (SELECT count(*) FROM public.linkedin_ad_creatives),
        'targets_detail', (
            SELECT jsonb_agg(jsonb_build_object(
                'name', sub.company_name,
                'source', sub.source,
                'ads', sub.ad_count,
                'status', sub.status
            ) ORDER BY sub.ad_count DESC)
            FROM (
                SELECT cfg.company_name, cfg.source, cfg.scrape_count,
                    count(lac.ad_id) as ad_count,
                    CASE
                        WHEN count(lac.ad_id) > 0 THEN 'has_ads'
                        WHEN cfg.scrape_count > 0 THEN 'no_ads_found'
                        ELSE 'not_scraped'
                    END as status
                FROM linkedin_ads_scraper.config cfg
                LEFT JOIN public.linkedin_ad_creatives lac
                    ON lac.company_id::text = cfg.company_id::text
                WHERE cfg.enabled = true
                GROUP BY cfg.company_name, cfg.source, cfg.scrape_count
            ) sub
        )
    ) as details
FROM (
    SELECT cfg.company_name, cfg.source, cfg.scrape_count,
        count(lac.ad_id) as ad_count,
        CASE
            WHEN count(lac.ad_id) > 0 THEN 'has_ads'
            WHEN cfg.scrape_count > 0 THEN 'no_ads_found'
            ELSE 'not_scraped'
        END as status
    FROM linkedin_ads_scraper.config cfg
    LEFT JOIN public.linkedin_ad_creatives lac
        ON lac.company_id::text = cfg.company_id::text
    WHERE cfg.enabled = true
    GROUP BY cfg.company_name, cfg.source, cfg.scrape_count
) sub;
