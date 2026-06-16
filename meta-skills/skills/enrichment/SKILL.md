---
description: Universal data enrichment — contacts, companies, posts, ads. Serper for URL discovery, BrightData for profile/company/post enrichment, OpenAI for ICP classification. Upstream dependency for linkedin-content, icp-development, graph-builder, onboarding, cold-email.
---

# Enrichment Skill

Universal enrichment pipeline for contacts, companies, LinkedIn posts, and LinkedIn ads. Client-agnostic — works with any `--profile` in `~/.dbt/profiles.yml`.

## When to Use

- Enriching PLI contacts with LinkedIn profile data (titles, seniority, industry)
- Discovering LinkedIn URLs for contacts that only have name + company
- Enriching CLI companies with industry, size, HQ location
- Classifying contacts into buyer personas (ICP classification)
- Scraping LinkedIn posts or ads data

## Prerequisites

- `public.pli` and `public.cli` tables exist (gtm-core module)
- `reference.persona_buckets` populated (for classification mode)
- `reference.prompt_library` has `persona_classification` prompt (for classification mode)
- Vault secrets: `BRIGHTDATA_API_KEY`, `SERPER_API_KEY` (for respective modes)
- `~/.dbt/profiles.yml` with target profile configured

## Modes

### 1. Discover URLs (`discover-urls`)
Find LinkedIn profile URLs for contacts that only have name + company.

```bash
npx tsx scripts/discover-urls.ts --profile nodewin [--limit 50] [--dry-run]
```

**Flow**: PLI (pending vmid, no URL) → Serper Google SERP (`site:linkedin.com/in/ "name"`) → extract LinkedIn URL → update PLI vmid + linkedinprofileurl

### 2. Enrich Contacts (`enrich-contacts`)
Enrich PLI records with full LinkedIn profile data via BrightData.

```bash
npx tsx scripts/enrich-contacts.ts --profile nodewin [--limit 100] [--dry-run]
```

**Flow**: PLI (has LinkedIn URL, missing title/seniority) → BrightData person profile dataset → update PLI with title, summary, location, industry, seniority

### 3. Enrich Companies (`enrich-companies`)
Enrich CLI records with company data via BrightData.

```bash
npx tsx scripts/enrich-companies.ts --profile nodewin [--limit 200] [--dry-run]
```

**Flow**: PLI unique company domains → BrightData company profile dataset → upsert CLI with industry, employee_count, hq_city, hq_country, description

### 4. Classify Contacts (`classify-contacts`)
Run ICP persona classification on enriched PLI records.

```bash
npx tsx scripts/classify-contacts.ts --profile nodewin [--limit 100] [--model gpt-4.1-mini]
```

**Flow**: PLI (has title, no buyer_persona_type) → load prompt from prompt_library → OpenAI structured output → update PLI buyer_persona_type + qualification

### 5. Enrich Posts (`enrich-posts`)
Scrape LinkedIn posts from person or company profiles via BrightData.

```bash
npx tsx scripts/enrich-posts.ts --profile nodewin --source pli [--limit 50] [--dry-run]
npx tsx scripts/enrich-posts.ts --profile nodewin --source cli [--limit 50]
npx tsx scripts/enrich-posts.ts --profile nodewin --urls "https://linkedin.com/in/johndoe"
npx tsx scripts/enrich-posts.ts --profile nodewin --source pli --use-engine
```

**Flow**: PLI/CLI LinkedIn URLs → BrightData LinkedIn Posts dataset (or deployed brightdata-engine with `--use-engine`) → upsert `public.linkedin_posts`

### 6. Enrich Ads (`enrich-ads`)
Scrape LinkedIn Ad Library for competitor/company ads via deployed linkedin-ads-engine.

```bash
npx tsx scripts/enrich-ads.ts --profile nodewin [--dry-run]
npx tsx scripts/enrich-ads.ts --profile nodewin --companies "Conveo,Cuez"
npx tsx scripts/enrich-ads.ts --profile nodewin --direct --companies "Conveo"
```

**Flow**: `linkedin_ads_scraper.config` targets (or `--companies` flag) → deployed linkedin-ads-engine (default) or direct BrightData Web Unlocker (`--direct`) → upsert `linkedin_ads_scraper.ads`

### 7. Full Pipeline (`enrich-all`)
Run all 4 steps in sequence: discover → enrich contacts → enrich companies → classify.

```bash
npx tsx scripts/enrich-all.ts --profile nodewin [--skip-discover] [--skip-classify]
```

## Agent Usage

When the agent invokes this skill, determine which mode is needed:

1. **Check PLI state first** — always run a diagnostic query before choosing a mode:
```sql
SELECT
  COUNT(*) as total,
  COUNT(*) FILTER (WHERE vmid LIKE 'pending_%') as pending_vmid,
  COUNT(*) FILTER (WHERE linkedinprofileurl IS NOT NULL) as with_url,
  COUNT(*) FILTER (WHERE title IS NOT NULL AND title != '') as with_title,
  COUNT(*) FILTER (WHERE buyer_persona_type IS NOT NULL) as classified
FROM public.pli;
```

2. **Route to the right mode**:
   - `pending_vmid > 0` AND `with_url` is low → run `discover-urls` first
   - `with_url > with_title` → contacts have URLs but no profile data → run `enrich-contacts`
   - Companies needed → run `enrich-companies`
   - `with_title > classified` → contacts enriched but not classified → run `classify-contacts`
   - Everything needed → run `enrich-all`

3. **Present results** after each step with counts of what changed.

## Downstream Consumers

- `linkedin-content` — needs enriched + classified PLI for persona-targeted content
- `icp-development` — needs enriched PLI for ground truth datasets
- `onboarding-agent` — client contact enrichment during onboarding
- `graph-builder-coach` — contact → company edges for knowledge graph
- `cold-email` — persona-targeted email sequences
