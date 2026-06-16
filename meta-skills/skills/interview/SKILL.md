---
name: interview
description: "Interview me until 95% confidence about what I actually want — not what I think I should want. Use when starting new work, scoping a task, or when intent is ambiguous."
---

# Intent Interview

If /problem-solution was already invoked this session and created a contract (pushed to GitHub), skip this interview. Say: "Contract already created via /problem-solution. Ready to execute." and proceed.

## Phase 1: Interview

Load `references/interview-methodology.yaml` and apply the layered questioning approach.

Interview me until you have 95% confidence about what I actually want — not what I think I should want. This means:

1. **Don't accept the first framing.** Users present solutions, not problems. Dig to Layer 2 (motivation) before accepting anything.
2. **Challenge assumptions at Layer 4.** Push back. Say "I think you're solving the wrong problem" if that's what you believe. Use the flip/delete/10x tests.
3. **Track confidence explicitly.** Each Q&A has a confidence_delta. If you're gaining <5% per question, you're asking the wrong questions — go deeper, not wider.
4. **Don't ask what you can look up.** Never ask about file paths, existing code, or system state. Only interview about intent, constraints, and preferences.
5. **Probe out-of-scope proactively.** Before restating, suggest what should be OUT of scope. Users don't think about boundaries until you name them.

CLIENT DETECTION: Early in the interview, ask which client this work is for. Use AskUserQuestion with options: conveo, cuez, powernaut, cerrix, airlock, introw, internal, none (standalone). This determines where the contract is stored.

Only after 95% confidence: RESTATE using the Layer 5 format from the methodology, and wait for explicit approval.

## Phase 2: Route Decision

After the interview is approved, determine the nature of the work:

**Route A — Problem-shaped** (ambiguity, multiple possible approaches, architectural decisions, trade-offs):
- Invoke `/problem-solution` which handles its own contract creation at Wave 6
- The interview Q&A feeds into the problem-solution's context analysis

**Route B — Task-shaped** (clear scope, known approach, execution-ready):
- Proceed directly to Phase 3 (Contract Creation)

Use your judgement. If in doubt, ask: "This feels [problem-shaped / task-shaped] — should I run /problem-solution for structured analysis, or go straight to execution?"

## Phase 3: Contract Creation (Route B only)

Create and PUSH the intent contract to GitHub:

1. Read `/tmp/.claude-session-context` for session_id and transcript_path
2. Get git_user: `git config user.name`
3. Build filename: `{YYYYMMDD}-{git_user}-{client}-{slug}-intent.yml`
4. Use v3.0 template at `.claude/memory/templates/intent-contract.yml`
5. Set `identity.created_by: intent-interview`
6. Set `client.name`, `client.repo`, `client.project_number` from `.claude/skills/github-project-agent/references/board-config.yaml`
7. Push to: `nodewin-labs/<client>/.nodewin/contracts/<filename>` via `gh api`
   - For 'internal': push to `nodewin-labs/nodewin/.nodewin/contracts/`
   - For 'none': push to `nodewin-labs/nodewin/.nodewin/contracts/` (standalone)

## Phase 4: Board Integration

After contract is pushed (either from Route B here, or from /problem-solution Wave 6), invoke `/github-project` to create board items from the execution_plan.

## Execution Guidance

Once scoped and contracted:
- Execute by wave (parallel within wave, sequential across waves)
- Use `/github-project` update to change item statuses (dual-writes to board + contract)
- Log friction_events on errors, retries, corrections
- Check work against requirements. Flag out-of-scope per `.claude/hooks/intent-replan.md`
- Surface friction to user. Never act on friction silently.
