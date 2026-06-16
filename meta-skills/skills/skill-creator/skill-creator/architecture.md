## Overview

The skill-creator is a guided conversational workflow that scaffolds new Claude Code skills. It interviews the user, generates a folder structure based on one of five complexity tiers, writes SKILL.md and architecture.md, creates supporting scripts and YAML reference files, then validates the result against workspace conventions. Convention data and validation logic live in `shared/skill-conventions/` (shared with skill-audit).

## System Diagram

```mermaid
flowchart TB
    subgraph Upstream
        U1[User Interview] --> SC
        U2[skill-taxonomy.yml + skill-ontology.yml] --> SC
        U3[shared/skill-conventions/tier-structures.yaml] --> SC
        U4[shared/skill-conventions/skill-template.yaml] --> SC
    end

    subgraph skill-creator [Skill Creator Phases]
        SC[Phase 0: Interview] --> P1[Phase 1: Identity]
        P1 --> P2[Phase 2: Folder Structure]
        P2 --> P3[Phase 3: SKILL.md + architecture.md]
        P3 --> P4[Phase 4: Supporting Files]
        P4 --> P5[Phase 5: Validation]
    end

    subgraph Downstream [Generated Skill]
        P3 --> O1[SKILL.md]
        P3 --> O2[architecture.md]
        P4 --> O3[scripts/*.ts]
        P4 --> O4[references/*.yaml]
        P4 --> O5[sub-agents/*.md]
        P5 --> V[shared/skill-conventions/validate-skill.ts]
    end

    V -.->|validates| O1
    V -.->|validates| O2
```

## File Map

```
skill-creator/
├── SKILL.md                              ← orchestration: 6 phases with human gates
├── architecture.md                       ← this file

shared/skill-conventions/                 ← shared with skill-audit
├── (conventions.yaml removed — merged into skill-taxonomy.yml + skill-ontology.yml)
├── tier-structures.yaml                  ← folder trees + decision criteria per tier
├── skill-template.yaml                   ← SKILL.md section schema per tier
├── list-profiles.ts                      ← extracts profile names from ~/.dbt/profiles.yml
└── validate-skill.ts                     ← automated 11-check convention validator
```
