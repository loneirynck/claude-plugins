---
name: linkedin-ads-report
description: 3-level LinkedIn Ads performance report via Supabase MCP
---

# LinkedIn Ads Report

Generate a drill-down performance report across campaign groups, campaigns, and creatives using Supabase MCP `execute_sql`.

## Execution

### Level 1: Campaign Groups
```sql
SELECT campaign_group_name, start_date,
  sum(impressions) as impressions, sum(clicks) as clicks, sum(cost_usd) as spend,
  case when sum(impressions) > 0 then round(sum(clicks)::numeric / sum(impressions) * 100, 2) end as ctr_pct,
  case when sum(clicks) > 0 then round(sum(cost_usd) / sum(clicks), 2) end as cpc
FROM dbt.mart_campaign_performance
WHERE start_date >= current_date - interval '30 days'
GROUP BY campaign_group_name, start_date
ORDER BY campaign_group_name, start_date;
```

### Level 2: Campaigns
```sql
SELECT campaign_name, campaign_group_name, objective_type, start_date,
  impressions, clicks, cost_usd, ctr, cpc, cpm, engagement_rate
FROM dbt.mart_campaign_performance
WHERE start_date >= current_date - interval '30 days'
ORDER BY cost_usd DESC;
```

### Level 3: Creatives
```sql
SELECT creative_id, creative_name, content_type, campaign_name, start_date,
  impressions, clicks, cost_usd, ctr, engagement_rate
FROM dbt.mart_creative_performance
WHERE start_date >= current_date - interval '30 days'
ORDER BY impressions DESC;
```

### Audience Breakdown (optional)
```sql
SELECT dimension_type, dimension_value, total_impressions, total_clicks, total_cost_usd,
  case when total_impressions > 0 then round(total_clicks::numeric / total_impressions * 100, 2) end as ctr_pct
FROM dbt.mart_audience_insights
ORDER BY total_impressions DESC
LIMIT 30;
```

## Presentation
- Format as hierarchical drill-down: group -> campaign -> creative
- Highlight top 3 and bottom 3 performers at each level
- Flag anomalies: CTR < 0.5%, CPC > $10, week-over-week spend spikes > 50%
- Include period totals: total spend, total impressions, weighted avg CTR

## CLI Fallback
For terminal access, query the same dbt marts via psql with `--profile {client_name}`.
