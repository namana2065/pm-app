import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import { getContextSwitchingInsights } from "./contextSwitchingService";
import { getHandoffBreakdownInsights } from "./handoffService";
import {
  ContextSwitchingResult,
  DashboardSummary,
  HandoffResult,
  InsightsDashboardResult,
  SeverityLevel,
} from "../types/database";

const INSIGHT_TYPE = "dashboard_summary";

// ── Configurable heuristics ─────────────────────────────────────────────
// These are intentionally simple, named constants so they're easy to find
// and retune without touching the aggregation logic below.

/**
 * Health-score penalty applied per insight, keyed by that insight's own
 * severity (as already computed by the Phase 2/3 services). Averaged across
 * every context-switching + handoff insight found in the project, then
 * subtracted from 100. E.g. a project where every insight is "critical"
 * bottoms out near 100 - 40 = 60, not 0 — a single critical insight
 * shouldn't tank the whole project's health score, only a *pattern* of them.
 */
const SEVERITY_HEALTH_PENALTY: Record<SeverityLevel, number> = {
  critical: 40,
  high: 25,
  medium: 10,
  low: 2,
};

/**
 * Boundaries translating the 0-100 healthScore into an overall risk label.
 * Deliberately mirrors the 35/60/80 boundaries Phases 2-3 use for per-entity
 * severity, just applied to the inverted (health, not risk) scale, so a
 * reader who already understands "severity >= 80 is critical" can reason
 * about healthScore the same way.
 */
const RISK_THRESHOLDS = { low: 80, medium: 60, high: 35 };

/** Cap on how many recommendation strings surface on the dashboard. */
const MAX_RECOMMENDATIONS = 5;

/** Only insights at this severity or above are surfaced as top recommendations. */
const RECOMMENDATION_SEVERITY_FLOOR: SeverityLevel[] = ["high", "critical"];

// ─────────────────────────────────────────────────────────────────────────

function buildSummary(
  contextSwitching: ContextSwitchingResult[],
  handoffBreakdowns: HandoffResult[]
): DashboardSummary {
  const severities: SeverityLevel[] = [
    ...contextSwitching.map((c) => c.severity),
    ...handoffBreakdowns.map((h) => h.severity),
  ];

  const totalAnomalies =
    contextSwitching.filter((c) => c.isAnomaly).length +
    handoffBreakdowns.filter((h) => h.isAnomaly).length;

  const avgPenalty =
    severities.length === 0
      ? 0
      : severities.reduce((sum, s) => sum + SEVERITY_HEALTH_PENALTY[s], 0) / severities.length;

  const healthScore = Math.max(0, Math.min(100, Math.round(100 - avgPenalty)));

  const overallRisk: SeverityLevel =
    healthScore >= RISK_THRESHOLDS.low
      ? "low"
      : healthScore >= RISK_THRESHOLDS.medium
        ? "medium"
        : healthScore >= RISK_THRESHOLDS.high
          ? "high"
          : "critical";

  return {
    overallRisk,
    healthScore,
    totalAnomalies,
    contextSwitchingAnomalies: contextSwitching.filter((c) => c.isAnomaly).length,
    handoffBreakdownAnomalies: handoffBreakdowns.filter((h) => h.isAnomaly).length,
  };
}

function buildRecommendations(
  contextSwitching: ContextSwitchingResult[],
  handoffBreakdowns: HandoffResult[]
): string[] {
  const ranked = [
    ...contextSwitching.map((c) => ({
      text: c.recommendation,
      score: Math.max(c.contextSwitchingScore, c.anomalyScore),
      severity: c.severity,
    })),
    ...handoffBreakdowns.map((h) => ({
      text: h.recommendation,
      score: Math.max(h.handoffBreakdownScore, h.anomalyScore),
      severity: h.severity,
    })),
  ]
    .filter((r) => RECOMMENDATION_SEVERITY_FLOOR.includes(r.severity))
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const r of ranked) {
    if (seen.has(r.text)) continue;
    seen.add(r.text);
    unique.push(r.text);
    if (unique.length >= MAX_RECOMMENDATIONS) break;
  }
  return unique;
}

/**
 * Aggregates every AI Workflow Engine insight for a project into one
 * dashboard payload. Reuses the Phase 2 (Context Switching) and Phase 3
 * (Handoff Breakdown) services directly rather than recomputing anything —
 * those services already enforce project access and persist their own
 * project_insights rows as a side effect of being called here.
 *
 * Hidden Waiting Time Detection is not implemented anywhere in this
 * project (no service or endpoint exists for it), so per the original
 * scope it is returned as an empty array with hiddenWaitingStatus set to
 * "not_implemented" rather than fabricated.
 */
export async function getInsightsDashboard(
  projectId: string,
  userId: string
): Promise<InsightsDashboardResult> {
  const [contextSwitching, handoffBreakdowns] = await Promise.all([
    getContextSwitchingInsights(projectId, userId),
    getHandoffBreakdownInsights(projectId, userId),
  ]);

  const summary = buildSummary(contextSwitching, handoffBreakdowns);
  const recommendations = buildRecommendations(contextSwitching, handoffBreakdowns);
  const computedAt = new Date().toISOString();

  const dashboard: InsightsDashboardResult = {
    summary,
    contextSwitching,
    handoffBreakdowns,
    hiddenWaiting: [],
    hiddenWaitingStatus: "not_implemented",
    recommendations,
    computedAt,
  };

  await persistSummary(projectId, dashboard);

  return dashboard;
}

/** Overwrites this project's stored dashboard summary with the freshly computed one. */
async function persistSummary(projectId: string, dashboard: InsightsDashboardResult): Promise<void> {
  const { error: deleteError } = await supabase
    .from("project_insights")
    .delete()
    .eq("project_id", projectId)
    .eq("insight_type", INSIGHT_TYPE);

  if (deleteError) throw new AppError(deleteError.message, 500);

  const { error: insertError } = await supabase.from("project_insights").insert({
    project_id: projectId,
    insight_type: INSIGHT_TYPE,
    entity_type: "project",
    entity_id: projectId,
    score: dashboard.summary.healthScore,
    metrics: {
      overallRisk: dashboard.summary.overallRisk,
      totalAnomalies: dashboard.summary.totalAnomalies,
      contextSwitchingAnomalies: dashboard.summary.contextSwitchingAnomalies,
      handoffBreakdownAnomalies: dashboard.summary.handoffBreakdownAnomalies,
      hiddenWaitingStatus: dashboard.hiddenWaitingStatus,
    },
    narrative: `Project health score ${dashboard.summary.healthScore}/100 (${dashboard.summary.overallRisk} risk) with ${dashboard.summary.totalAnomalies} anomalies detected.`,
    computed_at: dashboard.computedAt,
  });

  if (insertError) throw new AppError(insertError.message, 500);
}
