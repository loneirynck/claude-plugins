---
name: compare-options
description: Use when comparing alternatives, evaluating trade-offs, or deciding between options. Auto-triggers on "should I use X or Y", "pros and cons", "trade-offs". Also invoked from /problem-solution at the options stage. Available as /compare-options.
---

# Compare Options

## Purpose

Produce a structured pro/con analysis with a clear recommendation whenever the user is comparing alternatives. Ensures consistent, decision-ready output instead of vague hand-waving.

## When This Triggers

**Automatically (via CLAUDE.md behavioral rule):**
- User asks a question while comparing Option A vs Option B
- User phrases something as "should I use X or Y"
- User lists alternatives and asks for input
- User says "pros and cons" or "trade-offs"

**Explicitly:**
- User invokes `/compare-options`

## Relationship to Decision Funnel

This skill sits AFTER problem framing in the decision funnel:
1. `/problem-statement` — understand WHAT you're solving (problem framing)
2. `/compare-options` — decide WHICH option (option evaluation)

### Standalone vs Orchestrated

- **Standalone**: Invoked directly by user for quick decisions. No contract created. Just delivers recommendation and stops.
- **Orchestrated**: Invoked by `/problem-solution` as Wave 4. The selected option flows into Wave 5 (roadmap), then Wave 6 (intent contract), then Wave 7 (GitHub Project items). Do NOT create contracts or project items from within `/compare-options` — that's `/problem-solution`'s responsibility.

## Output Format

### For 2-3 options:

```
## The Options

### Option A: [Name]

**How it works:** [1-2 sentences]

**Pros:**
- [concrete advantage with reasoning]
- [concrete advantage with reasoning]

**Cons:**
- [concrete disadvantage with reasoning]
- [concrete disadvantage with reasoning]

### Option B: [Name]

[Same structure]

## Recommendation

**[Option X]** — [2-3 sentences explaining WHY, grounded in the user's specific context.]

[If context is insufficient: "I need more context to recommend confidently. Specifically: [list what's missing]"]
```

### For 4+ options:

Use a comparison table instead of repeating the full block:

```
## The Options

| Criteria | Option A | Option B | Option C | Option D |
|----------|----------|----------|----------|----------|
| [relevant dimension] | ... | ... | ... | ... |

[Then the same Recommendation section]
```

## Instructions

### STEP 1 — Identify the Options

Extract the options being compared from the conversation. If the user hasn't named them clearly, infer from context or ask.

If only one option is stated ("should I do X?"), reframe as "X vs not doing X" or ask what alternatives they're considering.

### STEP 2 — Determine Evaluation Criteria

From the user's context, identify what matters most. Pick the 3-5 most relevant:
- Implementation effort / complexity
- Maintenance burden
- Flexibility / extensibility
- Performance / reliability
- User experience / ergonomics
- Cost (time, money, cognitive load)
- Reversibility (can we change course later?)

### STEP 3 — Analyze Each Option

For each option:
- State how it works concretely (not abstractly)
- List pros grounded in the user's actual context
- List cons grounded in the user's actual context
- Avoid generic pros/cons that apply to everything

**Quality check:** If a pro or con could apply to any option regardless of context, it's too generic. Make it specific.

### STEP 4 — Recommend or Request Context

**If you have enough context:** Make a clear, assertive recommendation. State which option and why. Reference the specific pros that tip the balance.

**If you don't have enough context:** Say so explicitly. List the 1-3 specific questions that would unlock a recommendation. Don't hedge with "it depends" — name what it depends ON.

### STEP 5 — Note Reversibility

End with a brief note on how reversible the decision is:
- "Low stakes — easy to change later if needed."
- "Medium stakes — switching later is possible but involves [specific cost]."
- "High stakes — this locks in [specific constraint], so worth getting right."

## Anti-Patterns

- **Don't hedge.** "Both options have merit" is not a recommendation. Pick one.
- **Don't be generic.** "More flexible" means nothing without saying what flexibility is gained.
- **Don't overcount.** 3 strong pros beat 7 weak ones. Quality over quantity.
- **Don't ignore context.** The user's situation determines which trade-offs matter.
