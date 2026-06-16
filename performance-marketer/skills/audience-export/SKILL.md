---
name: audience-export
description: Export CLI (company) and PLI (person) profiles to LinkedIn Matched Audience CSV. Use when asked to create audience lists, export contacts for LinkedIn targeting, build matched audiences, or prepare CSV uploads for LinkedIn Campaign Manager.
---

# Audience Export

Export company (CLI) or person (PLI) profiles from Supabase to LinkedIn Matched Audience CSV format.

## Execution

### Step 1: Determine Export Type

Ask the user: **Company audience** (ABM account targeting) or **Contact audience** (email/profile matching)?

### Step 2: Query Data

**Company audience** (CLI → LinkedIn Company Targeting):
```sql
SELECT
  company_name,
  website,
  industry,
  hq_country,
  employee_count_range,
  linkedin_url
FROM public.cli
WHERE company_name IS NOT NULL
ORDER BY company_name;
```

**Contact audience** (PLI → LinkedIn Contact Targeting):
```sql
SELECT
  fullname AS "firstName lastName",
  email,
  linkedin_url,
  job_title AS "title",
  company_name AS "companyName"
FROM public.pli
WHERE email IS NOT NULL
  AND email NOT LIKE '%catch-all%'
ORDER BY fullname;
```

### Step 3: Apply Filters (optional)

If the user wants to filter:
- By persona: `WHERE persona_category = '{persona}'`
- By ICP score: `WHERE icp_score >= {threshold}`
- By industry: `WHERE industry = '{industry}'`
- By country: `WHERE hq_country = '{country}'`
- By enrichment status: `WHERE enriched_at IS NOT NULL`

### Step 4: Format as CSV

**Company CSV** (LinkedIn Company Targeting format):
```
companyname,companywebsite,linkedincompanypage
"Acme Corp","acme.com","https://linkedin.com/company/acme"
```

**Contact CSV** (LinkedIn Contact Targeting format):
```
email,firstname,lastname,jobtitle,companyname
"john@acme.com","John","Doe","VP Sales","Acme Corp"
```

### Step 5: Output

Write the CSV to `audience-export-{type}-{date}.csv` and report:
- Total rows exported
- Any rows skipped (missing required fields)
- Ready for upload at: LinkedIn Campaign Manager → Plan → Audiences → Matched Audiences → Upload a list

## Guardrails

- Never export contacts without email (LinkedIn requires email for contact matching)
- Warn if export > 10,000 rows (LinkedIn has upload limits)
- Strip catch-all emails (low match rate, wastes budget)
- Always include a date in the filename for traceability
