import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import { getContextSwitchingInsights } from "./contextSwitchingService";
import { getHandoffBreakdownInsights } from "./handoffService";
import { getWaitingTimeInsights } from "./waitingTimeService";
import { getProjectRiskInsights } from "./riskScoreService";
import {
  ContextSwitchingResult,
  DashboardSummary,
  HandoffResult,
  InsightsDashboardResult,
  RiskScoreResult,
  SeverityLevel,
  WaitingTimeResult,
} from "../types/database";

const INSIGHT_TYPE = "dashboard_summary";

const SEVERITY_HEALTH_PENALTY: Record<SeverityLevel, number> = {
  critical: 40,
  high: 25,
  medium: 10,
  low: 2,
};

const RISK_THRESHOLDS = { low: 80, medium: 60, high: 35 };
const MAX_RECOMMENDATIONS = 5;
const RECOMMENDATION_SEVERITY_FLOOR: SeverityLevel[] = ["high", "critical"];

function buildSummary(
  contextSwitching: ContextSwitchingResult[],
  handoffBreakdowns: HandoffResult[],
  hiddenWaiting: WaitingTimeResult[],
  riskScores: RiskScoreResult[]
): DashboardSummary {
  const severities: SeverityLevel[] = [
    ...contextSwitching.map((c) => c.severity),
    ...handoffBreakdowns.map((h) => h.severity),
    ...hiddenWaiting.map((w) => w.severity),
    ...riskScores.map((r) => r.riskLevel),
  ];

  const totalAnomalies =
  contextSwitching.filter((c) => c.isAnomaly).length +
  handoffBreakdowns.filter((h) => h.isAnomaly).length +
  hiddenWaiting.filter((w) => w.isAnomaly).length;

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
    hiddenWaitingAnomalies: hiddenWaiting.filter((w) => w.isAnomaly).length,
    highRiskTasks: riskScores.filter((r) => r.riskLevel === "high" || r.riskLevel === "critical")
      .length,
  };
}

function buildRecommendations(
  contextSwitching: ContextSwitchingResult[],
  handoffBreakdowns: HandoffResult[],
  hiddenWaiting: WaitingTimeResult[],
  riskScores: RiskScoreResult[]
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
    ...hiddenWaiting.map((w) => ({
      text: w.recommendation,
      score: Math.max(w.waitingTimeScore, w.anomalyScore),
      severity: w.severity,
    })),
    ...riskScores.map((r) => ({
      text: r.explanation,
      score: r.riskScore,
      severity: r.riskLevel,
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

export async function getInsightsDashboard(
  projectId: string,
  userId: string
): Promise<InsightsDashboardResult> {
  const [contextSwitching, handoffBreakdowns, hiddenWaiting] = await Promise.all([
    getContextSwitchingInsights(projectId, userId),
    getHandoffBreakdownInsights(projectId, userId),
    getWaitingTimeInsights(projectId, userId),
  ]);

  const riskScores = await getProjectRiskInsights(projectId, userId);

  const summary = buildSummary(contextSwitching, handoffBreakdowns, hiddenWaiting, riskScores);
  const recommendations = buildRecommendations(
    contextSwitching,
    handoffBreakdowns,
    hiddenWaiting,
    riskScores
  );
  const computedAt = new Date().toISOString();

  const dashboard: InsightsDashboardResult = {
    summary,
    contextSwitching,
    handoffBreakdowns,
    hiddenWaiting,
    riskScores,
    recommendations,
    computedAt,
  };

  await persistSummary(projectId, dashboard);

  return dashboard;
}

async function persistSummary(
  projectId: string,
  dashboard: InsightsDashboardResult
): Promise<void> {
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
      hiddenWaitingAnomalies: dashboard.summary.hiddenWaitingAnomalies,
      highRiskTasks: dashboard.summary.highRiskTasks,
    },
    narrative: `Project health score ${dashboard.summary.healthScore}/100 (${dashboard.summary.overallRisk} risk) with ${dashboard.summary.totalAnomalies} anomalies detected.`,
    computed_at: dashboard.computedAt,
  });

  if (insertError) throw new AppError(insertError.message, 500);
}