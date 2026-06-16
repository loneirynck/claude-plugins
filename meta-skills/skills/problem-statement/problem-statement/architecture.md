## Overview

The problem-statement skill is a diagnostic conversational workflow that scans the current conversation for failed approaches, maps upstream and downstream dependencies, applies two parallel reframing techniques (Einstein reframing and Five Whys), and synthesizes a confirmed problem statement. It produces diagnosis only — no solutions — and hands off to `/problem-solution` once the user confirms the restatement.

## System Diagram

```mermaid
flowchart TB
    subgraph Upstream
        U1[Conversation History] --> S1
        U2[User's Stuck State] --> S1
    end

    subgraph problem-statement [Problem Statement Phases]
        S1[Step 1: Scan Conversation] --> S2[Step 2: Map Dependencies]
        S2 --> S3[Step 3: Five Ws Analysis]
        S3 --> S4[Step 4: Characteristics Check]
        S4 --> S5A[Step 5A: Einstein Reframing]
        S4 --> S5B[Step 5B: Five Whys]
        S5A --> S6[Step 6: Synthesize & Restate]
        S5B --> S6
        S6 --> S7[Step 7: Confirm with User]
    end

    subgraph Downstream
        S7 --> D1[Confirmed Problem Statement]
        D1 --> D2[/problem-solution handoff]
    end
```

## File Map

```
problem-statement/
├── SKILL.md                              ← orchestration: 8-step diagnostic process
├── architecture.md                       ← this file
└── references/                           ← reframing technique YAML files (empty — pending)
```
