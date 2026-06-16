---
name: gtm-engine
description: Generate GTM engine funnel dashboards for any client. Extracts meeting data, interviews for nuances, renders templatized SVG with Supabase spine. Two modes: from-meeting (auto-search recording tool) or manual (interview-only).
argument-hint: "<client-key>"
---

# GTM Engine Dashboard

Generate a full marketing funnel dashboard with Supabase processing spine for any client. Renders as a wide dark-theme SVG following `/visualize` conventions.

## Trigger

- User asks for a GTM engine, marketing funnel, or go-to-market dashboard
- `/visualize:gtm-engine <client-key>` explicit invocation
- After a strategy meeting where funnel structure was discussed

## Prerequisites

- YAML template at `.claude/skills/visualize/agents/gtm-engine/references/gtm-engine-template.yml`
- `/visualize` skill available (SVG rendering + PNG export)
- `/interview` skill available (confidence-gated questioning)

## Two Modes

Detect mode automatically:
- **Mode A (from-meeting)**: Default. Searches meeting recording tools for the latest client meeting.
- **Mode B (manual)**: Falls back here if no recording tool is available, or if user explicitly requests manual mode.

---

## Mode A: from-meeting (default)

### Phase 1: Accept Client & Find Meeting

1. Accept client key as argument (e.g. `wintercircus`, `conveo`, `cuez`)
2. Auto-search meeting recording tools for the latest meeting with this client:
   - Try Fathom MCP (`search_meetings` with client name)
   - If no Fathom result, **AskUserQuestion**: "No Fathom recording found. Do you have Leexi, Granola, or another transcript source?"
   - If no recording tool available, fall back to **Mode B**
3. **AskUserQuestion** to confirm the right meeting:
   > "I found this meeting: {title} ({date}). Is this the GTM strategy meeting to use?"
4. Fetch meeting summary + transcript

### Phase 2: Pre-fill YAML from Meeting Data

1. Copy the blank template from `references/gtm-engine-template.yml`
2. Extract from the transcript and summary:
   - **Header**: client name, program name, ticket price, persona count
   - **Funnel layers**: which of the 5 layers were discussed, block names per layer
   - **Block details**: descriptions, tool mentions, cost references
   - **Team**: names and roles mentioned
   - **Tools & costs**: every tool mentioned with cost if stated
   - **Timeline**: any phasing or week-by-week plan discussed
   - **Supabase spine**: what Supabase does at each funnel stage
   - **Key decisions**: explicit decisions or open questions
   - **Feedback loops**: any mentioned loops (e.g. content feeds awareness, discovery feeds CRISP)
3. Write pre-filled YAML as working draft

### Phase 3: Interview for 95% Confidence

Continue to **Phase 3 (shared)** below.

---

## Mode B: manual

### Phase 1: Accept Client & Load Existing

1. Accept client key as argument
2. Check if `client_projects/{client}/.nodewin/gtm-engine.yaml` exists:
   - **If yes**: read and use as starting point for interview
   - **If no**: copy blank template from `references/gtm-engine-template.yml`

### Phase 2: Skip (no meeting data)

Proceed directly to **Phase 3 (shared)** below.

---

## Phase 3 (shared): Interview to 95% Confidence

Invoke `/interview` with the pre-filled (or blank) YAML as context. Reach **95% confidence** on each of these dimensions before proceeding:

1. **Funnel layer structure** — Are the 5 default layers correct for this client? Should any be renamed, merged, split, or removed?
2. **Block names and descriptions** — What specific blocks exist per layer? What does each block do?
3. **Team members and roles** — Who is involved? What does each person own?
4. **Tools and costs** — Which tools are in play? What does each cost? Which are deferred?
5. **Timeline phases** — How many phases? What happens in each? Who does what?
6. **Supabase spine descriptions** — What does Supabase handle at each funnel stage?
7. **Key decisions** — What has been decided? What is still open?
8. **Feedback loops** — Which blocks feed back into earlier stages?

When 95% confidence is reached on all dimensions, proceed.

## Phase 4: Write Finalized YAML

Write the finalized YAML to:

```
client_projects/{client}/.nodewin/gtm-engine.yaml
```

## Phase 5: Render SVG

Generate the SVG following the layout conventions below. Use `/visualize` design rules (dark theme, color palette, fonts).

### SVG Layout Structure

```
+-----------------------------------------------------------------------------------+
| {CLIENT}  GTM Engine                                    {date} . {program_name}    |
+-----------------------------------------------------------------------------------+
|                                                                                    |
|  MARKETING FUNNEL (left ~65%)            |  SUPABASE SPINE (right ~35%)            |
|                                          |                                         |
|  +- Demand Creation -----------------+   |  +- [spine title] --------------+      |
|  | [block] [block] [block]           |   |  | . bullet                     |      |
|  +-----------------------------------+   |  | . bullet                     |      |
|                                          |  +--------------------------------+      |
|  +- Demand Capture ------------------+   |  +- [spine title] --------------+      |
|  | [block] [block]                   |   |  | . bullet                     |      |
|  +-----------------------------------+   |  +--------------------------------+      |
|                                          |                                         |
|  +- Content Engine ------------------+   |  +- [spine title] --------------+      |
|  | [block] -> [block] -> [block]     |   |  | . bullet                     |      |
|  +-----------------------------------+   |  +--------------------------------+      |
|                                          |                                         |
|  +- Activation ----------------------+   |  +- [spine title] --------------+      |
|  | [block] [block]                   |   |  | . bullet                     |      |
|  +-----------------------------------+   |  +--------------------------------+      |
|                                          |                                         |
|  +- Conversion ----------------------+   |  +- [spine title] --------------+      |
|  | [block] [block]                   |   |  | . bullet                     |      |
|  +-----------------------------------+   |  +--------------------------------+      |
|                                          |                                         |
|                                          |  MCP Server -> Team Access              |
+-----------------------------------------------------------------------------------+
|                                                                                    |
|  EXECUTION TIMELINE                                                                |
|  +- Phase 1 ----+  +- Phase 2 ----+  +- Phase 3 ----+                            |
|  | items...      |  | items...      |  | items...      |                            |
|  +---------------+  +---------------+  +---------------+                            |
|                                                                                    |
+-----------------------------------------------------------------------------------+
|  TOOLS & COSTS                              |  TEAM                                |
|  [tool] [cost] [tool] [cost] ...            |  [name] [role] [name] [role]         |
|                                             |                                      |
|  Estimated: {range} {note}                  |                                      |
+-----------------------------------------------------------------------------------+
|  KEY DECISIONS                                                                     |
|  1. ...                                                                            |
|  2. ...                                                                            |
+-----------------------------------------------------------------------------------+
```

### SVG Design Rules

- **Background**: `#0f0f1a`
- **Fonts**: `system-ui, -apple-system, sans-serif`, sizes 7-13px
- **ViewBox width**: 1600px (wide format)
- **ViewBox height**: scales with content (~1200-1800px typical)
- **Color palette**: from `/visualize` SKILL.md (Supabase blue, Edge red, Neo4j green, etc.)
- **Layer label colors**: from YAML `label_color` per funnel layer
- **Block styles**: `solid` = active, `dashed` = dormant/deferred
- **Block color schemes**: `cyan`, `green`, `orange`, `purple`, `red`, `muted` — mapped to `/visualize` palette
- **Content Engine blocks**: rendered as horizontal flow with arrows between them
- **Feedback loops**: dashed arrows looping back (e.g. Content Output -> LinkedIn Awareness, Discovery -> CRISP)
- **Supabase spine**: right-aligned column with connecting lines to corresponding funnel layers
- **Title spacing**: 30px whitespace between subtitle and first content row

### Feedback Loop Arrows

Render each entry in `feedback_loops` as a curved or routed dashed arrow:
- **from** block -> **to** block with label text
- Style and color from the YAML `style` and `color` fields
- Route arrows through gutters — no overlapping boxes

## Phase 6: Export PNG

```bash
cd .claude/skills/visualize
node scripts/svg-to-png.mjs output/{client}-gtm-engine.svg 3
```

## Phase 7: Copy to Client Folders

1. Copy SVG to `client_projects/{client}/.nodewin/gtm-engine.svg`
2. Copy PNG to `client_projects/{client}/.nodewin/gtm-engine.png`

All client outputs go to `.nodewin/` — this is the canonical location for all Nodewin-generated artifacts.

## Output Locations

| File | Path |
|------|------|
| Working SVG | `.claude/skills/visualize/output/{client}-gtm-engine.svg` |
| Working PNG | `.claude/skills/visualize/output/{client}-gtm-engine.png` |
| **Client SVG** | `client_projects/{client}/.nodewin/gtm-engine.svg` |
| **Client PNG** | `client_projects/{client}/.nodewin/gtm-engine.png` |
| Client YAML | `client_projects/{client}/.nodewin/gtm-engine.yaml` |

## Files

```
.claude/skills/visualize/agents/gtm-engine/
├── SKILL.md                                    # this file
└── references/
    └── gtm-engine-template.yml                # blank YAML template
```
