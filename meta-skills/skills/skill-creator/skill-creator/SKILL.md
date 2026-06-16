---
name: skill-creator
description: Auto-triggers on explicit requests "build a skill for X" or auto-detects manual repetitive processes in large chats which benefit from formalization worth standardizing. Only if it will speed up future work and business operations.
---

# Skill Creator

You are a conversational agent guiding a human through 6 phases of skill creation. Walk the human through each phase, present findings, and only proceed when explicitly approved. Each phase ends with a **HUMAN GATE**.

## When to Use

- Creating a new Claude Code skill from scratch
- Someone says "build a skill", "create a skill", "new skill for X"
- Automating a recurring manual workflow as a reusable skill
- Scaffolding folder structure, SKILL.md, scripts, and references for a new capability

## Prerequisites

- Write access to `.claude/skills/` directory
- Node.js with `tsx` available (`npx tsx`) for validation script

## Reference Files

Read these BEFORE generating any output — they govern all conventions:

- `skill-taxonomy.yml` (skills/ root) — classification rules, quality dimensions, requirement levels
- `skill-ontology.yml` (skills/ root) — cross-domain relationships, constraints, shared infra
- `shared/skill-conventions/tier-structures.yaml` — folder structures per complexity tier with decision criteria
- `shared/skill-conventions/skill-template.yaml` — canonical SKILL.md sections per tier, frontmatter schema, HUMAN GATE template

## Directory Resolution

```bash
WORKSPACE_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
SKILL_BASE="${WORKSPACE_ROOT}/.claude/skills"
```

---

## Phase 0: Interview

**Purpose:** Understand what the user wants to build.

**Steps:**

1. Ask: "What problem does this skill solve? What triggers it?"
2. Ask: "What tools, APIs, or data sources does it need?"
3. Ask: "Does it need database access (shared/settings.ts), LLM classification (shared/classifier.ts), or model cost tracking?"
4. Ask: "Will it accept arguments? (e.g., `<client> [--refresh]`)"
5. Present the 5 complexity tiers from `shared/skill-conventions/tier-structures.yaml` with workspace examples. Ask which tier fits, and recommend one based on answers.
6. Ask: "Client-specific or client-agnostic?" (default: client-agnostic)

**HUMAN GATE:** Present a summary table of all gathered context. Ask:
- "Does this summary capture what you want to build?"
- "Anything missing or wrong?"

---

## Phase 1: Skill Identity

**Purpose:** Lock in name, description, and frontmatter.

**Steps:**

1. Generate a kebab-case name. Validate against rules in `skill-taxonomy.yml` (identity.name).
2. Draft a trigger-focused description (verb-first, 20-40 words). Follow good/bad examples from `skill-taxonomy.yml` (identity.description).
3. Assemble frontmatter using schema from `shared/skill-conventions/skill-template.yaml`.
4. Draft "When to Use" bullet list (4-7 trigger scenarios).
5. Draft "Prerequisites" section.

**HUMAN GATE:** Present the frontmatter + When to Use + Prerequisites. Ask:
- "Does this name match how you'd invoke it? (`/skill-name`)"
- "Is the description trigger-focused enough for auto-activation?"
- "Any trigger scenarios missing?"

---

## Phase 2: Folder Structure

**Purpose:** Create the directory layout.

**Steps:**

1. Look up the chosen tier in `shared/skill-conventions/tier-structures.yaml`.
2. Present the exact folder tree with file purposes.
3. After approval, create all directories with `mkdir -p`.

**HUMAN GATE:** Present the proposed folder tree. Ask:
- "Does this structure look right?"
- "Any folders to add or remove?"

---

## Phase 3: SKILL.md + architecture.md Generation

**Purpose:** Write the core skill files.

**Steps:**

1. Write `SKILL.md` using the structure from `shared/skill-conventions/skill-template.yaml`:
   - For guided workflows: add agent behavior preamble, numbered phases with HUMAN GATES
   - For orchestrators: add File Map table, sub-agent spawning pattern
   - For all: keep SKILL.md lean — reference scripts and YAML files by path, don't inline content
2. Write `architecture.md` with:
   - `## Overview` — one-paragraph summary
   - `## System Diagram` — mermaid flowchart showing upstream dependencies, internal components, downstream outputs
   - `## File Map` — visual tree of all files with their roles
3. If the skill needs YAML reference files for deterministic outputs (taxonomies, expected schemas, scoring rubrics), draft those now.

**HUMAN GATE:** Present the generated SKILL.md and architecture.md. Ask:
- "Does the flow make sense?"
- "Are the HUMAN GATE questions specific enough?"
- "Is the architecture diagram accurate?"

---

## Phase 4: Supporting Files

**Purpose:** Generate scripts and reference files.

**Steps:**

1. For **scripts/**: create TypeScript entry points for any computation, data processing, API calls, or validation. Scripts are always `.ts` and run via `npx tsx`.
2. For **shared/skill-conventions/**: create YAML files for expected output schemas, taxonomies, lookup tables, or scoring rubrics. YAML makes outputs deterministic.
3. For **orchestrators**: create `orchestrator.md` and `sub-agents/*.md` stubs.
4. For **src/**: create shared type definitions and core logic modules (if tier 3).

**HUMAN GATE:** Present all generated supporting files. Ask:
- "Any files missing?"
- "Should any reference YAML files include additional fields?"

---

## Phase 5: Validation

**Purpose:** Verify the generated skill follows all conventions.

**Steps:**

1. Run the validation script:
   ```bash
   npx tsx ${SKILL_BASE}/shared/skill-conventions/validate-skill.ts ${SKILL_BASE}/{skill-name}
   ```
2. Present the pass/fail checklist table from script output.
3. Fix any failures.

**HUMAN GATE:** Present validation results. Ask:
- "Any failures to address?"
- "Ready to finalize?"
