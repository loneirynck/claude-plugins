-- Deployment integrity: edge functions vs Postgres callback functions
-- Checks that every engine listed in the expected_engines CTE has
-- at least one matching handle_* callback function in Postgres.
-- Engines without callbacks = "hands without brain" = broken pipeline.
WITH expected_engines AS (
    -- Engine base names and the schema + function prefix their callbacks use.
    -- This list is derived from kits/supabase/functions/index.yml.
    -- Pure proxies (anthropic, openai, gemini) use dynamic callbacks — excluded.
    VALUES
        ('brightdata-engine',  'core',                 'handle_bd_'),
        ('coresignal-engine',  'core',                 'handle_cs_'),
        ('fathom-engine',      'core',                 'handle_fathom_'),
        ('firecrawl-engine',   'core',                 'handle_firecrawl_'),
        ('phantombuster-engine','core',                'handle_pb_'),
        ('serper-engine',      'core',                 'handle_serper_'),
        ('heyreach-engine',    'heyreach',             'handle_'),
        ('smartlead-engine',   'smartlead',            'handle_'),
        ('bounceban-engine',   'core',                 'handle_bb_'),
        ('zerobounce-engine',  'core',                 'handle_zb_'),
        ('krisp-webhook',      'core',                 'handle_krisp_'),
        ('rb2b-engine',        'core',                 'handle_rb2b_'),
        ('linkedin-ads-scraper-engine', 'linkedin_ads_scraper', 'handle_'),
        ('neo4j-sync-engine',  'graph',                'dispatch_to_graph'),
        ('bd-webhook',         'core',                 'handle_bd_')
),
engine_list AS (
    SELECT column1 as engine_name, column2 as callback_schema, column3 as callback_prefix
    FROM expected_engines
),
callback_check AS (
    SELECT
        e.engine_name,
        e.callback_schema,
        e.callback_prefix,
        count(r.routine_name) as callback_count,
        string_agg(r.routine_name, ', ' ORDER BY r.routine_name) as callbacks_found
    FROM engine_list e
    LEFT JOIN information_schema.routines r
        ON r.routine_schema = e.callback_schema
        AND r.routine_name LIKE e.callback_prefix || '%'
        AND r.routine_schema NOT IN ('pg_catalog', 'information_schema')
    GROUP BY e.engine_name, e.callback_schema, e.callback_prefix
)
SELECT
    'deployment_integrity' as metric_name,
    count(*)::bigint as total,
    count(*) FILTER (WHERE callback_count > 0)::bigint as matched,
    round(100.0 * count(*) FILTER (WHERE callback_count > 0) / NULLIF(count(*), 0), 1) as match_pct,
    jsonb_build_object(
        'engines_with_callbacks', count(*) FILTER (WHERE callback_count > 0),
        'engines_missing_callbacks', count(*) FILTER (WHERE callback_count = 0),
        'detail', jsonb_agg(
            jsonb_build_object(
                'engine', engine_name,
                'schema', callback_schema,
                'callbacks', callback_count,
                'status', CASE WHEN callback_count > 0 THEN 'ok' ELSE 'MISSING' END,
                'functions', callbacks_found
            ) ORDER BY CASE WHEN callback_count = 0 THEN 0 ELSE 1 END, engine_name
        )
    ) as details
FROM callback_check;
