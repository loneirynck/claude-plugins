# BrightData API Behavior Reference

## Datasets API vs Web Scraper API — Different Rate Limits

| API | Endpoint | Rate Limit |
|-----|----------|------------|
| Datasets API | `POST /datasets/v3/trigger` | **No documented limit** (tested 8 rapid-fire calls, all 200) |
| Web Scraper API | `POST /datasets/v3/scrape` | 20 requests/min, 60 requests/hour |
| Scraper Studio | `POST /dca/trigger` | No documented limit |

The 20/min 60/hour figure from third-party skill sites applies to the **Web Scraper API** only — not the Datasets trigger endpoint used by `enrich-cli-companies.ts/.py`.

## 502 Bad Gateway = Transient Outage, Not Rate Limiting

### June 14-15, 2026 Incident
- Script: `enrich-cli-companies.py` (Wintercircus client)
- 8,071 CLI companies to enrich, batch size 100 (81 batches)
- Batches 1-8: 100% success (800 enriched)
- Batches 9-81: **Every batch returned `HTTP 502 Bad Gateway`**
- The script had **zero retry logic** — each batch was instantly marked failed
- Final: 800 upserted, 7,271 failed
- API tested healthy 12 hours later — all requests returned 200

### Root Cause
BrightData experienced a server-side outage on the trigger endpoint. The API was returning 502 for ~73 consecutive batches. This was NOT a credit issue, NOT rate limiting (no 429 returned), and NOT a permanent dataset problem (same dataset works now).

### Required Fix for Both Scripts
Both `enrich-cli-companies.ts` and `enrich-cli-companies.py` need retry with exponential backoff on 5xx errors:

```python
# Python: add retry wrapper around trigger_batch()
import time
MAX_RETRIES = 3
for attempt in range(MAX_RETRIES):
    try:
        snapshot_id = trigger_batch(api_key, inputs)
        break
    except urllib.error.HTTPError as e:
        if e.code >= 500 and attempt < MAX_RETRIES - 1:
            wait = 2 ** attempt * 10  # 10s, 20s, 40s
            print(f"  Retrying in {wait}s (attempt {attempt + 1}/{MAX_RETRIES})")
            time.sleep(wait)
        else:
            raise
```

```typescript
// TypeScript: add retry wrapper around triggerDataset()
async function triggerWithRetry(apiKey: string, inputs: Record<string, string>[], maxRetries = 3): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await triggerDataset(apiKey, inputs);
    } catch (e) {
      if (e instanceof Error && e.message.includes('502') && attempt < maxRetries - 1) {
        const wait = Math.pow(2, attempt) * 10_000;
        console.log(`  Retrying in ${wait / 1000}s (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(r => setTimeout(r, wait));
      } else {
        throw e;
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

## No Rate Limit Headers in Response

BrightData's API responses contain no `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`, or similar headers. You cannot probe current quota from response metadata — the only signal is the HTTP status code.

## Dataset ID Reference

| Dataset | ID | Purpose |
|---------|-----|---------|
| LinkedIn Company Profile | `gd_l1vikfnt1wgvvqz95w` | Company enrichment (name, size, industry, HQ, description, LinkedIn URL) |
