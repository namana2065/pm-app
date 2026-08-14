import { supabase } from "../lib/supabaseClient";
import { AppError, assertFound } from "../lib/errors";
import { requireProjectAccess } from "./accessService";
import { getProjectDeps } from "./dependencyService";
import { getBlockedTasks, getTransitiveDependents } from "../utils/graph";
import { getWaitingTimeInsights } from "./waitingTimeService";
import {
  PriorityLevel,
  RiskFeatures,
  RiskScoreResult,
  SeverityLevel,
  Task,
} from "../types/database";

const INSIGHT_TYPE = "risk_score";

const PRIORITY_BASE_SCORE: Record<PriorityLevel, number> = {
  critical: 30,
  high: 20,
  medium: 10,
  low: 5,
};

/** How much the AI/anomaly signal (Hidden Waiting Time) moves the final score. */
const AI_SIGNAL_WEIGHT = 0.25;

async function loadProjectTasks(projectId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from("task")
    .select("*")
    .eq("project_id", projectId)
    .eq("is_deleted", false);

  if (error) throw new AppError(error.message, 500);
  return (data ?? []) as Task[];
}

function daysUntilDue(task: Task): number | null {
  if (!task.due_date || task.status === "done") return null;
  const dueMs = new Date(task.due_date).getTime();
  return Math.round(((dueMs - Date.now()) / (1000 * 60 * 60 * 24)) * 100) / 100;
}

function bufferPressureScore(days: number | null): { score: number; reason: string | null } {
  if (days === null) return { score: 0, reason: null };
  if (days <= 0) return { score: 20, reason: `${Math.abs(Math.round(days))} day(s) overdue` };
  if (days <= 2) return { score: 15, reason: `Due in ${Math.round(days)} day(s) — little buffer left` };
  if (days <= 5) return { score: 8, reason: `Due in ${Math.round(days)} day(s)` };
  return { score: 0, reason: null };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function computeRuleScore(features: RiskFeatures): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = PRIORITY_BASE_SCORE[features.priority];

  if (features.priority === "critical" || features.priority === "high") {
    reasons.push(`${capitalize(features.priority)} priority`);
  }

  score += Math.min(25, features.totalDependents * 5);
  if (features.totalDependents > 0) {
    reasons.push(`${features.totalDependents} dependent task(s)`);
  }

  score += Math.min(25, features.blockedDependents * 10);
  if (features.blockedDependents > 0) {
    reasons.push(`${features.blockedDependents} dependent task(s) are blocked/waiting`);
  }

  const buffer = bufferPressureScore(features.daysUntilDue);
  score += buffer.score;
  if (buffer.reason) reasons.push(buffer.reason);

  return { score: Math.min(100, Math.max(0, Math.round(score))), reasons };
}

function computeRiskLevel(riskScore: number, waitingTimeAnomalyScore: number): SeverityLevel {
  const signal = Math.max(riskScore, waitingTimeAnomalyScore);
  if (signal >= 80) return "critical";
  if (signal >= 60) return "high";
  if (signal >= 30) return "medium";
  return "low";
}

function buildExplanation(
  taskTitle: string,
  riskLevel: SeverityLevel,
  reasons: string[],
  waitingTimeAnomalyScore: number
): string {
  const reasonText = reasons.length > 0 ? reasons.join("; ") : "no elevated risk factors";
  const aiNote =
    waitingTimeAnomalyScore >= 60
      ? ` Hidden Waiting Time Detection also flags this task as an idle-time outlier (${waitingTimeAnomalyScore}/100).`
      : "";
  return `"${taskTitle}" is ${riskLevel} risk: ${reasonText}.${aiNote}`;
}

/**
 * Delay Risk Prediction: rule score (priority, dependencies, buffer/deadline
 * pressure) blended with the AI/anomaly signal from Hidden Waiting Time
 * Detection for the same task.
 */
export async function getProjectRiskInsights(
  projectId: string,
  userId: string
): Promise<RiskScoreResult[]> {
  await requireProjectAccess(userId, projectId, "viewer");

  const tasks = await loadProjectTasks(projectId);
  if (tasks.length === 0) return [];

  const deps = await getProjectDeps(projectId);
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  const waitingInsights = await getWaitingTimeInsights(projectId, userId);
  const waitingByTask = new Map(waitingInsights.map((w) => [w.taskId, w]));

  const results: RiskScoreResult[] = tasks.map((task) => {
    const direct = getBlockedTasks(task.id, deps);
    const all = getTransitiveDependents(task.id, deps);

    let blockedDependents = 0;
    for (const id of all) {
      const dependent = taskMap.get(id);
      if (dependent && (dependent.status === "blocked" || dependent.status === "waiting")) {
        blockedDependents++;
      }
    }

    const features: RiskFeatures = {
      priority: task.priority,
      totalDependents: all.size,
      blockedDependents,
      daysUntilDue: daysUntilDue(task),
    };

    const { score: ruleScore, reasons } = computeRuleScore(features);
    const waiting = waitingByTask.get(task.id);
    const waitingTimeAnomalyScore = waiting?.anomalyScore ?? 0;

    const riskScore = Math.min(
      100,
      Math.round(ruleScore * (1 - AI_SIGNAL_WEIGHT) + waitingTimeAnomalyScore * AI_SIGNAL_WEIGHT)
    );
    const riskLevel = computeRiskLevel(riskScore, waitingTimeAnomalyScore);

    return {
      taskId: task.id,
      taskTitle: task.title,
      riskScore,
      riskLevel,
      ruleScore,
      waitingTimeAnomalyScore,
      isWaitingTimeAnomaly: waiting?.isAnomaly ?? false,
      features,
      reasons,
      explanation: buildExplanation(task.title, riskLevel, reasons, waitingTimeAnomalyScore),
    };
  });

  await persistInsights(projectId, results);

  return results.sort((a, b) => b.riskScore - a.riskScore);
}

/** Single-task lookup used by GET /dependencies/task/:taskId/risk. */
export async function getTaskRiskScore(taskId: string, userId: string): Promise<RiskScoreResult> {
  const { data: task, error } = await supabase
    .from("task")
    .select("id, project_id")
    .eq("id", taskId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  const found = assertFound(task, "Task");
  if (!found.project_id) throw new AppError("Task has no project", 400);

  const insights = await getProjectRiskInsights(found.project_id, userId);
  return assertFound(
    insights.find((r) => r.taskId === taskId),
    "Risk score"
  );
}

async function persistInsights(projectId: string, results: RiskScoreResult[]): Promise<void> {
  const { error: deleteError } = await supabase
    .from("project_insights")
    .delete()
    .eq("project_id", projectId)
    .eq("insight_type", INSIGHT_TYPE);

  if (deleteError) throw new AppError(deleteError.message, 500);
  if (results.length === 0) return;

  const rows = results.map((r) => ({
    project_id: projectId,
    insight_type: INSIGHT_TYPE,
    entity_type: "task",
    entity_id: r.taskId,
    score: r.riskScore,
    metrics: {
      riskLevel: r.riskLevel,
      ruleScore: r.ruleScore,
      waitingTimeAnomalyScore: r.waitingTimeAnomalyScore,
      isWaitingTimeAnomaly: r.isWaitingTimeAnomaly,
      features: r.features,
      reasons: r.reasons,
    },
    narrative: r.explanation,
    computed_at: new Date().toISOString(),
  }));

  const { error: insertError } = await supabase.from("project_insights").insert(rows);
  if (insertError) throw new AppError(insertError.message, 500);
}