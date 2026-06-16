---
name: ads-report
description: LinkedIn Ads performance report across campaign groups, campaigns, and creatives
---

Generate a 3-level LinkedIn Ads performance report using Supabase MCP.

## Steps

### 1. Campaign Group Level
Run via `execute_sql`:
```sql
SELECT campaign_group_name, start_date,
  sum(impressions) as impressions, sum(clicks) as clicks, sum(cost_usd) as spend,
  case when sum(impressions) > 0 then sum(clicks)::numeric / sum(impressions) end as ctr,
  case when sum(clicks) > 0 then sum(cost_usd) / sum(clicks) end as cpc
FROM dbt.mart_campaign_performance
WHERE start_date >= current_date - interval '30 days'
GROUP BY campaign_group_name, start_date
ORDER BY campaign_group_name, start_date;
```

### 2. Campaign Level
Run via `execute_sql`:
```sql
SELECT campaign_name, objective_type, start_date, impressions, clicks, cost_usd, ctr, cpc, cpm, engagement_rate
FROM dbt.mart_campaign_performance
WHERE start_date >= current_date - interval '30 days'
ORDER BY cost_usd DESC;
```

### 3. Creative Level
Run via `execute_sql`:
```sql
SELECT creative_id, creative_name, content_type, start_date, impressions, clicks, cost_usd, ctr, engagement_rate
FROM dbt.mart_creative_performance
WHERE start_date >= current_date - interval '30 days'
ORDER BY impressions DESC;
```

### 4. Present
Format as a drill-down report: group -> campaign -> creative. Highlight top/bottom performers. Flag anomalies (CTR < 0.5%, CPC > $10, week-over-week spend spikes > 50%).
