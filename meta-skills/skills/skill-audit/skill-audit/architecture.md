## Overview

The skill-audit is a guided conversational workflow that audits existing skills against the agentskills.io open standard and workspace conventions. It combines automated validation (25 checks via validate-skill.ts) with manual deep analysis of quality dimensions (token efficiency, signal-to-noise, specificity calibration, instruction patterns, script interfaces) and spec compliance (frontmatter portability, progressive disclosure). Rules are defined in `skill-taxonomy.yml` (classification) and `skill-ontology.yml` (relationships). Operational tooling lives in `shared/skill-conventions/`.

## System Diagram

```mermaid
flowchart TB
    subgraph Upstream
        U1[Existing Skill Folder] --> SA
        U2[skill-taxonomy.yml] --> SA
        U3[skill-ontology.yml] --> SA
        U4[shared/skill-conventions/validate-skill.ts] --> SA
    end

    subgraph skill-audit [Skill Audit Phases]
        SA[Phase 0: Target Selection] --> P1[Phase 1: Convention Audit]
        P1 --> P2[Phase 2: Quality Assessment]
        P2 --> P3[Phase 3: Spec Compliance]
        P3 --> P4[Phase 4: Fix Recommendations]
    end

    subgraph Outputs
        P1 --> O1[Automated Check Report — 25 checks]
        P2 --> O2[Quality Assessment — 8 dimensions]
        P3 --> O3[Spec Compliance Report — portability rating]
        P4 --> O4[Prioritized Fix List — P0 to P5]
        P4 --> O5[Applied Fixes]
    end

    U4 -.->|automated checks 1-25| P1
    U2 -.->|quality rules| P2
    U2 -.->|spec fields| P3
    U3 -.->|constraints| P2
```

## File Map

```
skill-audit/
├── SKILL.md                              ← orchestration: 5 phases with human gates
├── architecture.md                       ← this file

skills/ (root level)
├── skill-taxonomy.yml                   ← classification rules, quality dimensions
├── skill-ontology.yml                   ← cross-domain relationships, constraints
├── skill-topology.yml                   ← dependency wiring between skills
├── index.yml                             ← skill inventory (single source of truth)

shared/skill-conventions/                 ← operational tooling (shared with skill-creator)
├── tier-structures.yaml                  ← folder trees + decision criteria per tier
├── skill-template.yaml                   ← SKILL.md section schema per tier
├── list-profiles.ts                      ← extracts profile names from ~/.dbt/profiles.yml
└── validate-skill.ts                     ← automated 25-check validator
```
