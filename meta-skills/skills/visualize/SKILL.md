---
name: visualize
description: Generate visual diagrams (architecture, workflows, ideas, pipelines, concept maps) as SVG with high-res PNG export. Use when user asks to draw, visualize, diagram, or map out anything.
---

# Visualize

Generate publication-ready visual diagrams as SVG, with Puppeteer-based PNG export for sharing.

## Trigger

- User asks to draw, visualize, diagram, or map out anything
- "show me a diagram of...", "can you visualize...", "draw the flow for..."
- `/visualize` explicit invocation

## Diagram Types

- Architecture overviews (platform, system, infrastructure)
- Data flow / pipeline diagrams
- Workflow charts
- Module dependency graphs
- Concept maps / idea visualization
- Client onboarding flows
- Any visual the user wants to communicate

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

### 3. Export PNG (optional)

For sharing via WhatsApp/Slack/docs, export via Puppeteer (pixel-perfect rendering):

```bash
cd .claude/skills/visualize
node scripts/svg-to-png.mjs output/<name>.svg [scale]
```

- Default scale: 3 (3x resolution)
- Uses headless Chromium — identical to browser rendering
- Background color matched to SVG automatically
- Output: `output/diagram.png`

**Do NOT use ImageMagick** — it renders fonts and gradients incorrectly.

### 4. Iterate

User reviews and requests changes → update SVG → re-preview → re-export if needed.

## Files

```
.claude/skills/visualize/
├── SKILL.md                    # this file
├── scripts/
│   └── svg-to-png.mjs         # Puppeteer-based SVG→PNG exporter
├── output/                     # generated diagrams (gitignored)
│   ├── diagram.svg
│   └── diagram.png
└── node_modules/               # puppeteer (gitignored)
```

## Dependencies

- **VS Code extension**: `jock.svg` (SVG preview)
- **Node**: puppeteer (install once: `cd .claude/skills/visualize && npm install`)

## Examples

- Nodewin full platform architecture (Sources → Engines → Supabase → Neo4j → Hermes → MCP → Vercel)
- Client onboarding flow
- Data pipeline diagrams
- Module dependency graphs
