---
name: operations-status
description: Generate platform operations status dashboards for any client with a Supabase instance. Queries live data via Supabase MCP or renders from cached YAML. Use when reviewing platform health, preparing for client meetings, or running weekly ops reviews.
argument-hint: "<client-key>"
---

# Platform Operations Status

Generate a platform operations status dashboard for a client. The dashboard shows data pipelines status, automation status, skills status, summary stats, and architecture notes — rendered as a wide dark-theme SVG with 3 columns.

## Prerequisites

- Per-client YAML at `client_projects/{CLIENT}/.nodewin/platform-operations-status.yaml`
- Template schema at `visualize/agents/operations-status/references/operations-status-template.yml`
- For live mode: Supabase MCP profile configured for the client

## Phase 1: Select Client & Detect Mode

1. Accept client key as argument (e.g. `cuez`, `conveo`, `intouch`)
2. Read `client_projects/{CLIENT}/.nodewin/platform-operations-status.yaml`
3. If no argument provided, scan `client_projects/*/.nodewin/platform-operations-status.yaml` to list available clients
4. **Mode detection**:
   - If `supabase_mcp` field exists → try a `SELECT 1` query to test connection
   - If MCP connection succeeds → **live mode** (query Supabase for fresh data)
   - If MCP connection fails or `supabase_mcp` is null → **cached mode** (render from `*_value` fields in YAML)
   - Log which mode was selected
5. **Core Focus Gate**: If the YAML has no `core_focus` field, use **AskUserQuestion** to ask:
   > "What is the core focus for {CLIENT}'s platform operations dashboard? This is the strategic context shown in the header — not a table name."

   Save the answer as `core_focus` in the client YAML. This is mandatory — do NOT default to a table name.

## Phase 2: Query Live Data (live mode only)

Skip this phase entirely in cached mode — go straight to Phase 3.

For each section in the client YAML, execute the SQL queries via Supabase MCP `execute_sql`:

1. **Data Pipelines**: Execute `count_query`, `bar_query`, `breakdown_query`, `extra_count_query` for each pipeline item
2. **Skills**: Execute any `count_query` defined on skill items (most skills won't have queries)
3. **Summary Stats**: Execute each `query` in the summary_stats list
4. **Cron Jobs**: Query `SELECT jobname, schedule, active FROM cron.job ORDER BY jobname` for automation validation

Collect all results into a data object. Log any query failures but continue with remaining queries.

**After live queries**: write results back to the YAML `*_value` fields so the dashboard can be re-rendered in cached mode later without MCP access.

## Phase 3: Merge Template + Live Data

1. Combine YAML structure (names, tables, badges, statuses) with data (from live queries or cached `*_value` fields)
2. **Auto-derive status**: If a pipeline's count is 0 and YAML says `complete`, override to `not_built`
3. Compute summary stat values
4. Count items per status across all 3 columns for summary boxes
5. Add timestamp to header: `YYYY-MM-DD`

## Phase 4: Render SVG

Generate the SVG following the established dark-theme operations dashboard layout. Use `/visualize` conventions.

### Layout Structure (3 columns)

```
+-----------------------------------------------------------------------------------+
| {CLIENT}  Platform Operations Status         {date} • {core_focus}                 |
+-----------------------------------------------------------------------------------+
| DATA PIPELINES STATUS     | AUTOMATION STATUS       | SKILLS STATUS               |
|                           |                         |                             |
| [pipeline items with      | [flat list of all       | [flat list of all skills    |
|  status dots, counts,     |  automation items with   |  with status dots,          |
|  bars, breakdowns,        |  status dots + badges]   |  badges, dependencies]      |
|  badges]                  |                         |                             |
+-----------------------------------------------------------------------------------+
| [Summary Stat] [Summary Stat] [Summary Stat] [Summary Stat] [Summary...]          |
+-----------------------------------------------------------------------------------+
| LEGEND: ● Complete  ● Partial  ● Not Built  ● In Progress  ⏱ CRON  ⚡ TRIGGER ... |
+-----------------------------------------------------------------------------------+
| ARCHITECTURE NOTES                                                                 |
| • bullet points                                                                    |
+-----------------------------------------------------------------------------------+
```

### SVG Conventions

- **Background**: `#0f0f1a`
- **Header gradient**: `#1a5a9e` → `#9c27b0`
- **Status dots**: green `#4caf50` (complete) / orange `#ff9800` (partial) / red `#e94560` (not_built) / blue `#2196f3` (in_progress)
- **Fonts**: `system-ui, -apple-system, sans-serif`
- **ViewBox width**: 1600px fixed (wide format for 3 columns)
- **ViewBox height**: scales with item count (~60px per item row, base 500px for chrome)
- **Column width**: ~500px each with 20px gutters

### Output Locations

- Working SVG: `.claude/skills/visualize/output/{client}-operations-status.svg`
- Working PNG: `.claude/skills/visualize/output/{client}-operations-status.png`
- **Client SVG**: `client_projects/{CLIENT}/.nodewin/platform-operations-status.svg`
- **Client PNG**: `client_projects/{CLIENT}/.nodewin/platform-operations-status.png`

After PNG export, always copy both SVG and PNG to the client's `.nodewin/` folder.

### Badge Rendering

| Badge | Border | Icon | Label |
|-------|--------|------|-------|
| trigger | `#4caf50` | ⚡ | TRIGGER |
| cron | `#4caf50` | ⏱ | CRON |
| manual | `#ff9800` | ⚠ | MANUAL |
| not_built | `#e94560` | ✗ | NOT BUILT |

### Assignment Icons (optional)

| Assignment | Icon | Color |
|-----------|------|-------|
| Victor | V | `#64b5f6` |
| Sander | S | `#81c784` |
| Both | VS | `#ce93d8` |

### Legend

- Status dots: ● Complete ● Partial ● Not Built ● In Progress
- Badge icons: ⏱ CRON ⚡ TRIGGER ⚠ MANUAL ✗ NOT BUILT
- Assignment icons (if any items have assignments): V Victor S Sander VS Both
- Mode indicator: 🔴 LIVE or ⚪ CACHED (shown in header)

## Adding a New Client

1. Copy template from `visualize/agents/operations-status/references/operations-status-template.yml`
2. Place at `client_projects/{NEW_CLIENT}/.nodewin/platform-operations-status.yaml`
3. Fill in: `client`, `supabase_mcp`, `source_table`, `core_focus`
4. Adjust `data_pipelines`, `automation`, `skills`, `summary_stats`, `architecture_notes`
5. Run `/visualize:operations-status {new-client}` to verify
