-- Meeting owner resolution — how many external-sales meetings have an owner assigned
SELECT
    'meeting_resolution' as metric_name,
    (SELECT count(*) FROM meetings.categorization
     WHERE category = 'external-sales' AND source_table = 'krisp.raw_transcripts'
    )::bigint as total,
    (SELECT count(DISTINCT a.source_meeting_id) FROM meetings.attribution a
     INNER JOIN meetings.categorization cat
         ON cat.source_meeting_id = a.source_meeting_id
         AND cat.source_table = 'krisp.raw_transcripts'
         AND cat.category = 'external-sales'
     WHERE a.source_table = 'krisp.raw_transcripts'
       AND a.owner_id IS NOT NULL
       AND a.owner_id NOT LIKE 'SELF:%'
    )::bigint as matched,
    round(100.0 * (SELECT count(DISTINCT a.source_meeting_id) FROM meetings.attribution a
     INNER JOIN meetings.categorization cat
         ON cat.source_meeting_id = a.source_meeting_id
         AND cat.source_table = 'krisp.raw_transcripts'
         AND cat.category = 'external-sales'
     WHERE a.source_table = 'krisp.raw_transcripts'
       AND a.owner_id IS NOT NULL
       AND a.owner_id NOT LIKE 'SELF:%'
    ) / NULLIF((SELECT count(*) FROM meetings.categorization
     WHERE category = 'external-sales' AND source_table = 'krisp.raw_transcripts'), 0), 1) as match_pct,
    jsonb_build_object(
        'total_meetings', (SELECT count(*) FROM krisp.raw_transcripts),
        'with_spiced_items', (SELECT count(DISTINCT source_meeting_id) FROM meetings.spiced_items WHERE source_table = 'krisp.raw_transcripts')
    ) as details;
