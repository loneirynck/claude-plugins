# Client Platform Operations Status — Architecture

```mermaid
graph LR
    subgraph Input
        YAML["references/{client}.yaml<br/>Pipeline items + SQL queries"]
    end

    subgraph Skill Phases
        P1["Phase 1<br/>Select Client"]
        P2["Phase 2<br/>Query Live Data"]
        P3["Phase 3<br/>Merge Template + Data"]
        P4["Phase 4<br/>Render SVG"]
    end

    subgraph External
        MCP["Supabase MCP<br/>execute_sql"]
        VIS["/visualize skill<br/>SVG + PNG export"]
    end

    subgraph Output
        SVG["visualize/output/<br/>{client}-operations-status.svg"]
        PNG["visualize/output/<br/>{client}-operations-status.png"]
    end

    YAML --> P1
    P1 --> P2
    P2 -->|SQL queries| MCP
    MCP -->|live counts| P3
    P3 -->|merged data| P4
    P4 -->|render| VIS
    VIS --> SVG
    VIS --> PNG
```

## Data Flow

1. **YAML template** declares what pipelines, automation items, and summary stats exist for a client, along with SQL queries to fetch live counts
2. **Supabase MCP** executes each SQL query against the client's Supabase instance
3. **Merge** combines static structure (names, statuses, badges) with dynamic data (counts, breakdowns)
4. **Render** generates the SVG following the dark-theme operations dashboard layout, delegates to `/visualize` for PNG export

## Key Conventions

- Schema defined in `client_projects/client-status-convention.yml`
- Per-client YAML in `references/{client}.yaml` within this skill
- No TypeScript scripts — entirely LLM-driven via SKILL.md phases
- SVG layout matches the established `cuez-operations-status.svg` pattern
- Viewport height scales with pipeline item count (~60px per item)
