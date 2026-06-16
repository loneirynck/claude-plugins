---
name: problem-statement
description: Use when the user is stuck, confused, or going in circles. Auto-triggers when multiple failed approaches are visible in the conversation. Also available as /problem-statement. Diagnoses the problem — does NOT propose solutions.
---

# Problem Statement

Diagnostic problem framer. Scans the conversation, identifies what's been tried, maps dependencies, applies two parallel reframing techniques, and asks the user to confirm the restated problem. NO solutions — that's `/problem-solution`.

## Process

### Step 1 — Scan the conversation

Review everything discussed so far:
- What was the user trying to achieve?
- What approaches were attempted and what were the outcomes?
- What errors, blockers, or unexpected behaviors occurred?
- What assumptions were made (stated or implied)?

### Step 2 — Map dependencies (upstream + downstream)

**Upstream** — what feeds into this problem:
- Which systems, files, APIs, or data sources are involved?
- What preconditions must be true?

**Downstream** — what depends on solving this:
- What is blocked by this problem?
- What breaks if it stays unsolved?

### Step 3 — Context Analysis (Five Ws)

- **WHO**: Who is affected?
- **WHAT**: What exactly is happening vs. what should happen?
- **WHERE**: Where does this occur (system, file, environment)?
- **WHEN**: When did it start / when does it trigger?
- **WHY**: Why does solving this matter?

### Step 4 — Problem Characteristics Check

Verify the emerging problem statement:
- Provides focus and frames the issue clearly
- Is specific and discrete (not overly broad)
- Captures the gap between current and desired state
- Is grounded in facts, not assumptions

### Step 5 — Parallel Reframing

Run TWO reframing processes IN PARALLEL on the identified problem:

**Process A:** Load `references/einstein-reframing.yaml` and apply Einstein-inspired reframing techniques.

**Process B:** Load `references/five-whys.yaml` and drill through 5 layers of "why" to reach the root cause.

Both processes take the same input (the raw problem from Steps 1-4) and return their reframed/deepened version independently.

### Step 6 — Synthesize and Restate

Combine insights from both reframing processes into a single restated problem statement:

```
## Problem Statement

**Problem:** [One clear sentence — the root cause, not the symptom]

**Current state:** [What exists now]
**Desired state:** [What should exist]
**Gap:** [What specifically prevents current from becoming desired]

**What was tried:**
- [approach 1] — [outcome]
- [approach 2] — [outcome]

**Dependencies:**
- Upstream: [what feeds into this]
- Downstream: [what this blocks]

**Root cause (5 Whys):** [deepest why from Process B]
**Reframed as question:** [from Process A — the most illuminating rephrasing]
```

### Step 7 — Confirm

Use AskUserQuestion:

> "Is this the right problem? If not, what am I missing?"

### Step 8 — Handoff

On confirmation: "Problem confirmed. Invoke `/problem-solution` to find structured solutions."

## Rules

- Do NOT propose solutions. That's for `/problem-solution`.
- Do NOT compare options. That's for `/compare-options`.
- Focus entirely on understanding and restating the problem accurately.
- If the conversation has no prior context (cold invocation), ask what the user is struggling with before attempting to frame.
- Be concise — the problem statement should fit in one screen.
