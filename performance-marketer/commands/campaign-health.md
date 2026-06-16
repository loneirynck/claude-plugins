---
name: campaign-health
description: Daily campaign health diagnostic with traffic-light scoring
---

Run daily campaign health check using Supabase MCP `execute_sql`.

## Steps

### 1. Fetch Active Campaigns
Run via `execute_sql`:
```sql
SELECT campaign_name, objective_type, start_date,
  impressions, clicks, cost_usd, ctr, cpc, cpm, engagement_rate
FROM dbt.mart_campaign_performance
WHERE start_date >= current_date - interval '7 days'
ORDER BY start_date DESC, cost_usd DESC;
```

### 2. Fetch Spend Trends
Run via `execute_sql`:
```sql
SELECT start_date, total_spend, spend_7d_ma,
  case when lag(total_spend) over (order by start_date) > 0
    then (total_spend - lag(total_spend) over (order by start_date)) / lag(total_spend) over (order by start_date) * 100
  end as spend_change_pct
FROM dbt.mart_daily_spend_summary
WHERE start_date >= current_date - interval '14 days'
ORDER BY start_date DESC;
```

### 3. Score Each Campaign
Apply traffic-light scoring:
- **RED**: CTR < 0.5% OR CPC > $10 OR engagement_rate < 0.1%
- **YELLOW**: CTR < 1% OR CPC > $5 OR engagement_rate < 0.5%
- **GREEN**: All metrics above yellow thresholds

### 4. Flag Anomalies
- Week-over-week spend increase > 50%
- Creative fatigue: impressions up but CTR declining over 3+ days
- Zero-impression campaigns (paused or delivery issues)

### 5. Present
Format as a traffic-light dashboard table with campaign name, status (emoji: red/yellow/green circle), key metrics, and recommended action for non-green campaigns.
