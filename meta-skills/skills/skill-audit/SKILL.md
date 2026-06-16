---
name: skill-audit
description: Auto-triggers when an existing skill shows friction during use or when user requests a convention audit. Validates structure, description quality, and file completeness against workspace standards.
---

# Skill Audit

You are a conversational agent that audits existing skills against workspace conventions. Identify the target skill, run automated checks, perform manual deep analysis, and propose fixes. Each phase ends with a **HUMAN GATE**.

## When to Use

- An existing skill is used in a chat and shows friction or issues
- User says "audit this skill", "check skill conventions", "is this skill up to standard?"
- A skill's description doesn't trigger correctly in conversation
- After modifying a skill, to verify it still meets conventions
- Proactively when noticing a skill could be improved

## Prerequisites

- Node.js with `tsx` available (`npx tsx`) for validation script
- Read access to `.claude/skills/` directory

## Reference Files

All convention data lives in shared infrastructure — read BEFORE auditing:

- `shared/skill-conventions/conventions.yaml` — naming rules, description patterns, validation checklist
- `shared/skill-conventions/tier-structures.yaml` — folder structures per complexity tier
- `shared/skill-conventions/skill-template.yaml` — canonical SKILL.md sections per tier

## Directory Resolution

```bash
WORKSPACE_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SKILL_BASE="${WORKSPACE_ROOT}/.claude/skills"
CONVENTIONS="${SKILL_BASE}/shared/skill-conventions"
```

---

## Phase 0: Target Selection

**Purpose:** Identify which skill to audit.

**Steps:**

1. If triggered by friction in conversation: identify the skill from context (which skill was just used or discussed).
2. If explicit request: ask which skill to audit, or list available skills from `${SKILL_BASE}/*/SKILL.md`.
3. Verify the skill folder exists and has a SKILL.md.

**HUMAN GATE:** Present the target skill name and path. Ask:
- "Is this the skill you want to audit?"

---

## Phase 1: Convention Audit

**Purpose:** Run automated + manual checks against all conventions.

**Steps:**

1. **Automated checks** — run the validation script:
   ```bash
   npx tsx ${CONVENTIONS}/validate-skill.ts ${SKILL_BASE}/{skill-name}
   ```
   Present the pass/fail table.

2. **Manual deep analysis** — check aspects the script can't catch, using `shared/skill-conventions/conventions.yaml` as reference:
   - **Description quality**: Is it trigger-focused? Does it lead with trigger conditions? Would it auto-activate correctly in conversation?
   - **Token efficiency**: Is computation offloaded to scripts? Is structured data in YAML references? Is the SKILL.md lean or bloated?
   - **Architecture.md quality**: Does it have a mermaid diagram? Does the diagram show upstream/downstream dependencies?
   - **YAML reference usage**: Are expected outputs, taxonomies, or scoring rubrics defined in YAML for determinism?
   - **Tier alignment**: Does the current structure match the appropriate tier from `shared/skill-conventions/tier-structures.yaml`?

3. **Compile audit report** with:
   - Automated check results (pass/fail table)
   - Manual findings (issue, severity, recommendation)
   - Overall health score (checks passed / total applicable)

**HUMAN GATE:** Present the full audit report. Ask:
- "Do these findings match your experience with this skill?"
- "Any issues you've noticed that aren't captured here?"

---

## Phase 2: Fix Recommendations

**Purpose:** Propose and optionally apply fixes.

**Steps:**

1. For each failure/issue from Phase 1, propose a specific fix:
   - **Description**: draft a trigger-focused rewrite
   - **Missing architecture.md**: generate one with mermaid diagram
   - **Token bloat**: identify what to extract to scripts/ or references/
   - **Missing YAML references**: identify data that should be in YAML for determinism
2. Prioritize fixes by impact:
   - P0: Description quality (affects auto-activation)
   - P1: Token efficiency (affects cost per invocation)
   - P2: Architecture.md (affects maintainability)
   - P3: YAML references (affects output determinism)
3. Offer to apply fixes immediately or generate a checklist for later.

**HUMAN GATE:** Present prioritized fix list. Ask:
- "Which fixes should I apply now?"
- "Any fixes to skip or defer?"
