---
name: skill-audit
description: Auto-triggers when an existing skill shows friction during use or when user requests a convention audit. Validates structure, description quality, and file completeness against workspace standards.
---

# Skill Audit

You are a conversational agent that audits existing skills against the agentskills.io spec and workspace conventions. Identify the target skill, run automated checks, assess quality dimensions, check spec compliance, and propose fixes. Each phase ends with a **HUMAN GATE**.

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

Read BEFORE auditing — these govern all rules:

- `skill-taxonomy.yml` (skills/ root) — classification rules, quality dimensions, requirement levels
- `skill-ontology.yml` (skills/ root) — cross-domain relationships, constraints
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

**Purpose:** Run automated checks against all conventions (25 checks).

**Steps:**

1. **Automated checks** — run the validation script:
   ```bash
   npx tsx ${CONVENTIONS}/validate-skill.ts ${SKILL_BASE}/{skill-name}
   ```
   Present the pass/fail/warn table.

2. **Categorize results** by severity:
   - **FAIL** — must fix (naming, structure, client-agnostic violations)
   - **WARN** — should fix (token budget, spec compliance, script quality, eval readiness)
   - **SKIP** — not applicable to this skill type

3. **Compile automated report** with pass rate and issue summary.

**HUMAN GATE:** Present the automated check results. Ask:
- "Do these findings match your experience with this skill?"
- "Any issues you've noticed that aren't captured here?"

---

## Phase 2: Quality Assessment

**Purpose:** Manual deep analysis of quality dimensions the script can't fully assess. Reference `skill-taxonomy.yml` quality section.

**Steps:**

1. **Description effectiveness** — Read the description. Would it trigger correctly in conversation? Does it cover the right keywords? Is it imperative ("Use when...") not declarative ("This skill does...")?

2. **Token efficiency** — Count SKILL.md body lines. Is computation offloaded to scripts? Is structured data in YAML references? Is the SKILL.md lean or bloated with content that should be in references/?

3. **Signal-to-noise** — Read through instructions. Is there content the agent already knows (explaining common concepts, general advice)? Would removing it change agent behavior?

4. **Specificity calibration** — Are fragile operations (DB writes, API calls) prescriptive? Are flexible parts (formatting, approach choice) given freedom? Does the skill pick defaults or present menus?

5. **Instruction patterns** — Check for presence of:
   - Gotchas section (environment-specific corrections)
   - Output templates (concrete format examples)
   - Validation loops (do → validate → fix → repeat)
   - Checklists for multi-step workflows

6. **Script interface quality** (if scripts/ exists):
   - Do scripts support `--help`?
   - Are error messages actionable (what went wrong + what to try)?
   - Is output structured (JSON/CSV to stdout, diagnostics to stderr)?
   - Are destructive operations idempotent with `--dry-run`?

7. **Architecture.md quality** — Does it have a mermaid diagram showing upstream/downstream? Is the file map current?

8. **Tier alignment** — Does the current structure match the appropriate tier from `shared/skill-conventions/tier-structures.yaml`?

**HUMAN GATE:** Present the quality assessment. Ask:
- "Do you agree with this assessment?"
- "Any quality dimensions I should weigh differently?"

---

## Phase 3: Spec Compliance Report

**Purpose:** Check alignment with agentskills.io open standard for cross-agent portability. Reference `skill-taxonomy.yml` identity section.

**Steps:**

1. **Frontmatter field check** — Identify non-standard fields:
   - Spec fields: `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`
   - Workspace extensions: `user-invocable`, `argument-hint`, `disable-model-invocation`, `sub_skills`
   - Non-standard (portability risk): `triggers`, `tools`, `args`, `client`, `version`, `author`, `tags`, `dependencies`

2. **Name compliance** — Verify: 1-64 chars, no consecutive hyphens, no leading/trailing hyphen.

3. **Description compliance** — Verify: ≤1024 chars, describes both WHAT and WHEN.

4. **Progressive disclosure** — Is SKILL.md body <500 lines / <5000 tokens? Is heavy content in references/?

5. **Portability recommendation** — Rate as:
   - **Portable** — all fields spec-compliant, could work in any agent
   - **Workspace-only** — uses workspace extensions (fine for our use)
   - **Non-portable** — uses non-standard fields that other agents would ignore

**HUMAN GATE:** Present the spec compliance report. Ask:
- "Does portability matter for this skill, or is workspace-only fine?"

---

## Phase 4: Fix Recommendations

**Purpose:** Propose and optionally apply fixes, prioritized by impact.

**Steps:**

1. For each failure/warning from Phases 1-3, propose a specific fix.
2. Prioritize fixes by impact:
   - **P0: Description quality** — affects auto-activation (trigger reliability)
   - **P1: Token efficiency** — affects cost per invocation and agent attention
   - **P2: Instruction quality** — affects output quality (gotchas, templates, validation loops)
   - **P3: Script interface** — affects agent-script interaction (--help, error messages, structured output)
   - **P4: Spec compliance** — affects cross-agent portability (non-standard frontmatter)
   - **P5: Eval readiness** — affects quality measurement (test cases, assertions)
3. Offer to apply fixes immediately or generate a checklist for later.

**HUMAN GATE:** Present prioritized fix list. Ask:
- "Which fixes should I apply now?"
- "Any fixes to skip or defer?"
