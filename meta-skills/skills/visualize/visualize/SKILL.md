---
name: visualize
description: Generate visual diagrams (architecture, workflows, ideas, pipelines, concept maps) as SVG with high-res PNG export. Use when user asks to draw, visualize, diagram, or map out anything.
sub_skills:
  - gtm-engine
  - operations-status
---

# Visualize

Generate publication-ready visual diagrams as SVG, with Puppeteer-based PNG export for sharing.

## Sub-Agents (Structured Dashboards)

For structured, templatized dashboards, use a sub-agent:

- **`/visualize:gtm-engine <client>`** — GTM engine funnel dashboard. Extracts meeting data, interviews for nuances, renders from YAML template. See `agents/gtm-engine/SKILL.md`.
- **`/visualize:operations-status <client>`** — Platform operations status dashboard. Queries live Supabase data or renders from cached YAML. See `agents/operations-status/SKILL.md`.

When invoked with a sub-agent prefix (e.g., `/visualize:gtm-engine wintercircus`), read and follow the corresponding agent's SKILL.md at `agents/{agent-name}/SKILL.md`.

When invoked without a sub-agent prefix (e.g., `/visualize` or `/visualize <description>`), use the free-form workflow below.

## Trigger

- User asks to draw, visualize, diagram, or map out anything
- "show me a diagram of...", "can you visualize...", "draw the flow for..."
- `/visualize` explicit invocation (free-form)
- `/visualize:gtm-engine <client>` (structured GTM dashboard)
- `/visualize:operations-status <client>` (structured operations dashboard)

## Diagram Types (Free-Form)

- Architecture overviews (platform, system, infrastructure)
- Data flow / pipeline diagrams
- Workflow charts
- Module dependency graphs
- Concept maps / idea visualization
- Client onboarding flows
- Any visual the user wants to communicate

## Reference Patterns

When diagramming Supabase pipelines that follow the "Postgres is the brain" pattern (cron → edge functions → table functions → queue tables), read `references/postgres-first-event-driven-pipeline.yml` for the canonical 3-lane swim lane layout, arrow conventions, state machine rendering, and color palette. Always use this pattern for pipeline diagrams.

When creating UML sequence diagrams for edge functions, also read `references/uml-sequence-diagram-convention.yml` for output rules, versioning, required sections (routing, fallback, loops, rate limiting, tables used), and auto-copy to `kits/supabase/functions/{engine}/`.

## Workflow

### 1. Generate SVG

Write to `.claude/skills/visualize/output/<name>.svg`.

**Design rules:**
- Dark theme: background `#0f0f1a`, boxes with subtle borders
- Color-coded by system type (use consistent palette below)
- No arrows overlapping boxes — route through gutters between components
- Clean horizontal/vertical lines, no diagonal arrows
- system-ui font family, font sizes 7-13px
- Include legend + architecture decisions section
- ViewBox sized to content (typically 900x550)
- **Title spacing**: Leave at least 30px of whitespace between the subtitle and the first content row. Title at y≈35, subtitle at y≈52, content starts no higher than y≈95. Center content vertically in the remaining space below the subtitle.

**Color palette:**
| System | Stroke | Fill | Text |
|--------|--------|------|------|
| Supabase | `#1a5a9e` | `#0f3460` | `#a0c0e0` |
| Edge Engines | `#e94560` | `#2a1a3a` | `#c0a0b0` |
| Neo4j | `#4caf50` | `#1a2a1a` | `#8cbf8c` |
| Hermes | `#e94560` | `#3a1a1a` | `#c09090` |
| MCP Gateway | `#9c27b0` | `#2a1a2a` | `#b080c0` |
| Vercel | `#00bcd4` | `#1a1a3a` | `#80d0e0` |
| dbt | `#ff9800` | `#1a3a1a` | `#c0b080` |
| GitHub | `#f0f0f0` | `#12122a` | `#f0f0f0` |
| External | `#3a3a5c` | `#1e1e3a` | `#7eb8da` |

### 2. Preview

User opens SVG in VS Code via `Cmd+Shift+P` → "SVG: Preview" (requires `jock.svg` extension).

### 3. Export PNG (mandatory)

**Always** export PNG after SVG creation — every diagram needs a shareable format:

```bash
cd .claude/skills/visualize
node scripts/svg-to-png.mjs output/<name>.svg [scale]
```

- Default scale: 3 (3x resolution)
- Uses headless Chromium — identical to browser rendering
- Background color matched to SVG automatically
- Output: `output/diagram.png`

**Do NOT use ImageMagick** — it renders fonts and gradients incorrectly.

### 3b. Copy to Client EXPORTS (default after PNG export)

After PNG export, **always** copy to the client's EXPORTS folder when a client context is known:

```bash
cd .claude/skills/visualize
node scripts/copy-to-client.mjs output/<name>.png --client <client-key>
```

- Resolves client folder from `client_projects/client-index.yml`
- Creates `client_projects/{folder}/EXPORTS/` if it doesn't exist
- Copies with date stamp: `{name}-{YYYYMMDD}.png`
- Client key is the lowercase key from client-index.yml (e.g., `conveo`, `eagl`, `cuez`)
- **Client detection**: infer from conversation context (which Supabase project, which data). If ambiguous, ask.

### 4. Iterate

User reviews and requests changes → update SVG → re-preview → re-export if needed.

## Files

```
.claude/skills/visualize/
├── SKILL.md                    # this file (parent + free-form)
├── agents/
│   ├── gtm-engine/
│   │   ├── SKILL.md            # GTM engine agent workflow
│   │   └── references/
│   │       └── gtm-engine-template.yml  # blank YAML template
│   └── operations-status/
│       ├── SKILL.md            # Operations status agent workflow
│       ├── architecture.md     # Data flow diagram
│       └── references/
│           └── operations-status-template.yml  # blank YAML template
├── references/
│   └── postgres-first-event-driven-pipeline.yml  # reusable pattern for Supabase pipelines
├── scripts/
│   ├── svg-to-png.mjs         # Puppeteer-based SVG→PNG exporter
│   └── copy-to-client.mjs     # Copy PNG to client EXPORTS folder
├── output/                     # generated diagrams (gitignored)
│   ├── diagram.svg
│   └── diagram.png
└── node_modules/               # puppeteer (gitignored)
```

Per-client files live at `client_projects/{client}/.nodewin/`:
- `gtm-engine.yaml` + `gtm-engine.svg` + `gtm-engine.png`
- `platform-operations-status.yaml` + `platform-operations-status.svg` + `platform-operations-status.png`

## Dependencies

- **VS Code extension**: `jock.svg` (SVG preview)
- **Node**: puppeteer (install once: `cd .claude/skills/visualize && npm install`)

## Examples

- Nodewin full platform architecture (Sources → Engines → Supabase → Neo4j → Hermes → MCP → Vercel)
- Client onboarding flow
- Data pipeline diagrams
- Module dependency graphs
