---
name: problem-solution
description: Use after a confirmed problem statement to find structured solutions. Activates when user confirms problem via /problem-statement or explicitly agrees on the problem to solve. Runs wave-based analysis, then delegates to /compare-options.
---

# Problem Solution

Structured solution finding for a confirmed problem. Only activates AFTER the user has confirmed the problem statement.

## Prerequisites

The problem must be confirmed. If no confirmed problem exists in the conversation, ask: "What's the confirmed problem we're solving?" Do not proceed without clarity.

## Process — Wave-Based Execution

### Wave 1 (parallel)
Run these two phases simultaneously — they are independent:

**Phase 1 — Context Analysis**
Load `references/phase1-context-analysis.yaml`. Gather background, evidence, relevance, impact, and check assumptions. Grounds everything in facts.

**Phase 2 — Forward Projection**
Load `references/phase2-forward-projection.yaml`. Define the desired end state — what does "solved" look like concretely?

### Wave 2 (sequential — depends on Wave 1)

**Phase 3 — Dependency Mapping**
Load `references/phase3-dependency-mapping.yaml`. Now that you know both current context AND desired state, map upstream + downstream dependencies, identify blockers and critical path.

### Wave 3 (sequential — depends on Wave 2)

**Phase 4 — Reverse Engineering**
Load `references/phase4-reverse-engineering.yaml`. Now that you know the deps, work backwards from goal through the dependency chain to the current state. Produces the natural execution order.

### Wave 4 — Option Evaluation

Invoke `/compare-options` to produce structured pro/con analysis with recommendation. Do NOT duplicate option evaluation logic — delegate entirely to the compare-options skill/command.

Use AskUserQuestion after `/compare-options` delivers its recommendation to confirm which option the user wants.

### Wave 5 — Solution Roadmap (after user picks option)

**Phase 5 — Solution Roadmap**
Load `references/phase5-solution-roadmap.yaml`. Produce the execution plan based on the selected option + the reverse-engineered action chain from Phase 4.

Present the roadmap to the user and get explicit approval before proceeding to Wave 6.

### Wave 6 — Deliverable (after user approves roadmap)

Delegate to `/github-deliverable` to ensure a deliverable exists for this work:

1. **Detect client**: AskUserQuestion with options from `github-project-agent/references/board-config.yaml` keys (conveo, cuez, eagl, powernaut, cerrix, airlock, introw) + "internal" + "none (standalone)".
2. **Check existing deliverables**: `/github-deliverable list <client>`
3. If this work fits an existing deliverable → use it. If not → `/github-deliverable create <client> "<title>"` to create one.
4. The deliverable is the parent for the contract in Wave 7.

**IMPORTANT**: The client board shows **one row per deliverable**, not one row per task.
This matches the `/github-deliverable` convention: "One deliverable = one board item."
Do NOT create board items for individual execution_plan tasks.

If client is "none" → skip Wave 6.

### Wave 7 — Intent Contract (after deliverable confirmed)

Delegate to `/github-contract` to create and push the intent contract:

1. **Invoke `/github-contract`** with context from this session:
   - `created_by`: `problem-solution`
   - `deliverable`: the deliverable confirmed in Wave 6
   - `problem`: confirmed problem statement from `/problem-statement`
   - `approach`: selected option from `/compare-options` (Wave 4)
   - `done_when`: success criteria from roadmap (Wave 5)
   - `requirements`: execution steps from roadmap
   - `execution_plan`: roadmap waves with empty execution blocks
   - `client`: user selection from Wave 6
2. `/github-contract` handles: template population, naming, GitHub push, contract storage conventions.
3. Present contract summary + commit URL to user for confirmation.

If client is "none" → push to `nodewin-labs/nodewin/.nodewin/contracts/`.

## Output

Always produce a visual markdown overview. Use tables, dependency trees, and structured sections. The user should be able to scan the full assessment in under 2 minutes.

## Rules

- Wave 1 phases MUST run in parallel (two subagents or parallel analysis).
- Never skip Phase 3 (dependencies). Most failed solutions fail because of missed deps.
- Phase 4 reverse-engineering depends on Phase 3 — don't start it before deps are mapped.
- Wave 4 delegates to `/compare-options` — don't reinvent option evaluation.
- Wave 6 delegates to `/github-deliverable` — deliverable must exist before contract.
- Wave 7 delegates to `/github-contract` — contract links to deliverable from Wave 6.
- Do NOT create board items for individual tasks — board shows deliverables only.
- Be assertive in recommendations. "It depends" is not an answer.

## Decision Funnel

```
/problem-statement  →  /problem-solution         →  /compare-options (Wave 4)
  "WHAT is wrong?"      "HOW do we solve it?"         "WHICH option?"
                              ↓
                    Solution Roadmap (Wave 5)  →  user approves
                              ↓
                    /github-deliverable (Wave 6)  →  deliverable + board item
                              ↓
                    /github-contract (Wave 7)     →  contract linked to deliverable
```

## Integration Points

- **Wave 4**: `/compare-options` — option evaluation (delegated, not duplicated)
- **Wave 6**: `/github-deliverable` — deliverable management + board items (delegated)
- **Wave 7**: `/github-contract` — contract creation + GitHub push (delegated)
- **Board config**: `.claude/skills/github-project-agent/references/board-config.yaml`
- **Contract template**: `.claude/memory/templates/intent-contract.yml` (v3.0)
- **Contract storage**: `nodewin-labs/<client>/.nodewin/contracts/`
- **Deliverable storage**: `nodewin-labs/<client>/.nodewin/deliverables/`
