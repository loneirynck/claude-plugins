/**
 * Lightweight ops logger for enrichment scripts.
 * Logs to core.pipeline_runs so enrichment runs are queryable alongside edge function runs.
 *
 * Usage:
 *   const run = new ScriptRun(pool, 'enrichment_discover_urls')
 *   await run.start({ limit: 100, profile: 'nodewin' })
 *   // ... do work ...
 *   await run.complete({ recordsProcessed: 100, recordsSucceeded: 95, recordsFailed: 5 })
 */

import pg from "pg";

export class ScriptRun {
  private runId: number = -1;
  private startedAtMs: number = 0;

  constructor(
    private pool: pg.Pool,
    private pipeline: string,
    private functionName: string = "enrichment-skill",
  ) {}

  async start(metadata?: Record<string, unknown>): Promise<number> {
    this.startedAtMs = Date.now();
    try {
      const { rows } = await this.pool.query(`
        INSERT INTO core.pipeline_runs (pipeline, function_name, trigger_type, status, metadata, started_at)
        VALUES ($1, $2, 'manual', 'running', $3, NOW())
        RETURNING id
      `, [this.pipeline, this.functionName, JSON.stringify(metadata ?? {})]);
      this.runId = rows[0]?.id ?? -1;
      return this.runId;
    } catch (err) {
      console.error(`[ops] Failed to start pipeline run: ${err}`);
      return -1;
    }
  }

  async logStep(step: string, details?: Record<string, unknown>): Promise<void> {
    if (this.runId <= 0) return;
    try {
      await this.pool.query(`
        INSERT INTO core.api_calls (pipeline_run_id, provider, endpoint, method, latency_ms, request_context)
        VALUES ($1, 'enrichment-skill', $2, 'STEP', 0, $3)
      `, [this.runId, step, JSON.stringify(details ?? {})]);
    } catch {
      // never throw on logging
    }
  }

  async complete(stats: {
    recordsProcessed: number;
    recordsSucceeded: number;
    recordsFailed: number;
    errorSummary?: string;
  }): Promise<void> {
    if (this.runId <= 0) return;
    try {
      const status = stats.recordsFailed > 0
        ? (stats.recordsSucceeded > 0 ? "partial" : "failed")
        : "completed";

      await this.pool.query(`
        UPDATE core.pipeline_runs SET
          status = $1,
          completed_at = NOW(),
          duration_ms = $2,
          records_processed = $3,
          records_succeeded = $4,
          records_failed = $5,
          error_summary = $6
        WHERE id = $7
      `, [
        status,
        Date.now() - this.startedAtMs,
        stats.recordsProcessed,
        stats.recordsSucceeded,
        stats.recordsFailed,
        stats.errorSummary || null,
        this.runId,
      ]);
    } catch (err) {
      console.error(`[ops] Failed to complete pipeline run: ${err}`);
    }
  }

  async fail(error: string): Promise<void> {
    if (this.runId <= 0) return;
    try {
      await this.pool.query(`
        UPDATE core.pipeline_runs SET
          status = 'failed',
          completed_at = NOW(),
          duration_ms = $1,
          error_summary = $2
        WHERE id = $3
      `, [Date.now() - this.startedAtMs, error, this.runId]);
    } catch (err) {
      console.error(`[ops] Failed to mark pipeline as failed: ${err}`);
    }
  }

  getRunId(): number {
    return this.runId;
  }
}
