---
name: audience-export
description: Export CLI/PLI profiles to LinkedIn Matched Audience CSV
---

Invoke the MCP-first audience-export skill from `.claude/skills/audience-export/SKILL.md`.

Uses Supabase MCP `execute_sql` with SQL templates in `.claude/skills/audience-export/scripts/sql/` for data queries. Supports PLI (person) and CLI (company) exports with interview flow, preflight validation, and CSV output formatting.
