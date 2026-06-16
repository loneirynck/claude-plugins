## Overview

Compare Options is a decision-support skill that produces structured pro/con analyses with clear recommendations when the user evaluates alternatives. It auto-triggers on comparison language ("should I use X or Y", "pros and cons", "trade-offs") or via explicit `/compare-options` invocation. Pure-prompt skill with no runtime code — the SKILL.md contains the full instruction set including output format templates, evaluation criteria selection, and anti-pattern guards.

## System Diagram

```mermaid
flowchart LR
    U[User Question] -->|"X vs Y?"| T{Trigger Detection}
    T -->|auto / explicit| S[Compare Options Skill]
    S --> S1[1. Identify Options]
    S1 --> S2[2. Determine Criteria]
    S2 --> S3[3. Analyze Each Option]
    S3 --> S4[4. Recommend or Request Context]
    S4 --> S5[5. Note Reversibility]
    S5 --> O[Structured Output]
    O -->|2-3 options| F1[Pro/Con Blocks + Recommendation]
    O -->|4+ options| F2[Comparison Table + Recommendation]
```

## File Map

```
compare-options/
├── SKILL.md              ← full skill: triggers, 5-step process, output templates, anti-patterns
└── architecture.md       ← this file
```
