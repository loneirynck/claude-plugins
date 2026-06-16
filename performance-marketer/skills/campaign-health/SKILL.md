---
name: campaign-health
description: Daily campaign health diagnostic with traffic-light scoring via Supabase MCP
---

# Campaign Health

Daily diagnostic that scores each active campaign with traffic-light status using Supabase MCP `execute_sql`.

## Execution

### Step 1: Fetch Campaign Metrics
```sql
SELECT campaign_name, objective_type, start_date,
  impressions, clicks, cost_usd, ctr, cpc, cpm, engagement_rate
FROM dbt.mart_campaign_performance
WHERE start_date >= current_date - interval '7 days'
ORDER BY start_date DESC, cost_usd DESC;
```

### Step 2: Fetch Spend Trends
```sql
SELECT start_date, total_spend, spend_7d_ma,
  case when lag(total_spend) over (order by start_date) > 0
    then round((total_spend - lag(total_spend) over (order by start_date)) / lag(total_spend) over (order by start_date) * 100, 1)
  end as spend_change_pct
FROM dbt.mart_daily_spend_summary
WHERE start_date >= current_date - interval '14 days'
ORDER BY start_date DESC;
```

### Step 3: Fetch Creative Fatigue Signals
```sql
SELECT campaign_name, start_date, impressions, ctr,
  ctr - lag(ctr) over (partition by campaign_name order by start_date) as ctr_delta
FROM dbt.mart_campaign_performance
WHERE start_date >= current_date - interval '7 days'
ORDER BY campaign_name, start_date;
```

## Traffic-Light Scoring

| Metric | RED | YELLOW | GREEN |
|--------|-----|--------|-------|
| CTR | < 0.5% | < 1.0% | >= 1.0% |
| CPC | > $10 | > $5 | <= $5 |
| Engagement Rate | < 0.1% | < 0.5% | >= 0.5% |
| WoW Spend Change | > +50% | > +25% | <= +25% |

Overall campaign status = worst individual metric score.

## Anomaly Flags
- **Creative fatigue**: Impressions stable/up but CTR declining 3+ consecutive days
- **Budget drain**: Single campaign consuming > 40% of total daily spend
- **Zombie campaigns**: Active but < 100 impressions/day for 3+ days
- **Delivery issues**: Zero impressions for an active campaign

## Presentation
Format as a dashboard table:
```
| Campaign | Status | CTR | CPC | Eng% | Spend | Action |
```

For non-green campaigns, include a specific recommended action (pause, adjust bid, refresh creative, narrow audience, etc.).

## CLI Fallback
For terminal access, query the same dbt marts via psql with `--profile {client_name}`.
