import { supabase } from "../lib/supabaseClient";
import { AppError, assertFound } from "../lib/errors";
import { requireProjectAccess } from "./accessService";
import { getTaskStatusDuration, getProjectStatusDuration } from "./historyService";
import { detectAnomalies } from "../utils/anomalyDetection";
import {
  SeverityLevel,
  StatusTimeline,
  WaitingTimeFeatures,
  WaitingTimeResult,
} from "../types/database";

const INSIGHT_TYPE = "hidden_waiting_time";
const IDLE_STATUSES = new Set(["waiting", "blocked"]);
const HIGH_WAITING_HOURS_THRESHOLD = 24;

async function loadProjectTasks(
  projectId: string
): Promise<Map<string, { title: string; createdAt: string }>> {
  const { data, error } = await supabase
    .from("task")
    .select("id, title, created_at")
    .eq("project_id", projectId)
    .eq("is_deleted", false);

  if (error) throw new AppError(error.message, 500);

  const map = new Map<string, { title: string; createdAt: string }>();
  for (const task of data ?? []) {
    map.set(task.id, { title: task.title, createdAt: task.created_at });
  }
  return map;
}

/** Feature engineering: idle hours, waiting frequency, current idle duration. */
function buildFeatures(segments: StatusTimeline[], createdAt: string): WaitingTimeFeatures {
  const idleSegments = segments.filter((s) => IDLE_STATUSES.has(s.status));
  const idleHours = idleSegments.reduce((sum, s) => sum + (s.durationHours ?? 0), 0);

  const ageDays = Math.max(
    1,
    (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  const waitingFrequency = Math.round((idleSegments.length / ageDays) * 100) / 100;

  const last = segments[segments.length - 1];
  const currentIdleHours =
    last && IDLE_STATUSES.has(last.status) && last.exitedAt === null
      ? last.durationHours ?? 0
      : 0;

  return {
    idleHours: Math.round(idleHours * 100) / 100,
    waitingFrequency,
    currentIdleHours: Math.round(currentIdleHours * 100) / 100,
  };
}

function computeWaitingTimeScore(features: WaitingTimeFeatures): number {
  const idlePenalty = Math.min(55, features.idleHours * 1.25);
  const frequencyPenalty = Math.min(25, features.waitingFrequency * 40);
  const currentPenalty = Math.min(20, features.currentIdleHours * 1.5);
  return Math.min(100, Math.round(idlePenalty + frequencyPenalty + currentPenalty));
}

function computeSeverity(waitingTimeScore: number, anomalyScore: number): SeverityLevel {
  const signal = Math.max(waitingTimeScore, anomalyScore);
  if (signal >= 80) return "critical";
  if (signal >= 60) return "high";
  if (signal >= 35) return "medium";
  return "low";
}

function buildExplanation(taskTitle: string, features: WaitingTimeFeatures): string {
  return (
    `"${taskTitle}" has accumulated ${features.idleHours}h waiting/blocked, entering an idle ` +
    `state roughly ${features.waitingFrequency}x/day since it was created, and is currently ` +
    `idle for ${features.currentIdleHours}h.`
  );
}

function buildRecommendation(severity: SeverityLevel, features: WaitingTimeFeatures): string {
  if (severity === "critical") {
    return "This task's idle pattern is a statistical outlier for this project. Check what it's blocked on and escalate to its owner today.";
  }
  if (severity === "high") {
    return "This task is accumulating unusual waiting time — confirm it isn't silently stuck before it affects downstream work.";
  }
  if (severity === "medium") {
    return "Keep an eye on this task's idle time; a quick status check could prevent it from stalling further.";
  }
  return "No action needed — this task's waiting time looks normal.";
}

/**
 * Hidden Waiting Time Detection: feature engineering (idle hours, waiting
 * frequency, current idle duration) -> hybrid anomaly detection (IQR for
 * small datasets, Isolation Forest for larger ones, via detectAnomalies())
 * -> flag statistical outliers as bottlenecks.
 */
export async function getWaitingTimeInsights(
  projectId: string,
  userId: string
): Promise<WaitingTimeResult[]> {
  await requireProjectAccess(userId, projectId, "viewer");

  const taskInfo = await loadProjectTasks(projectId);
  const taskIds = Array.from(taskInfo.keys());
  if (taskIds.length === 0) return [];

  const timeline = await getProjectStatusDuration(projectId);
  const timelineByTask = new Map<string, StatusTimeline[]>();
  for (const segment of timeline) {
    const existing = timelineByTask.get(segment.taskId) ?? [];
    existing.push(segment);
    timelineByTask.set(segment.taskId, existing);
  }

  const idleTaskIds = taskIds.filter((id) =>
    (timelineByTask.get(id) ?? []).some((s) => IDLE_STATUSES.has(s.status))
  );
  if (idleTaskIds.length === 0) return [];

  const perTaskFeatures = idleTaskIds.map((id) =>
    buildFeatures(timelineByTask.get(id) ?? [], taskInfo.get(id)!.createdAt)
  );

  const featureVectors = perTaskFeatures.map((f) => [
    f.idleHours,
    f.waitingFrequency,
    f.currentIdleHours,
  ]);

  const anomalyResults = detectAnomalies(featureVectors);

  const results: WaitingTimeResult[] = idleTaskIds.map((id, index) => {
    const features = perTaskFeatures[index];
    const anomaly = anomalyResults[index];
    const taskTitle = taskInfo.get(id)!.title;

    const waitingTimeScore = computeWaitingTimeScore(features);
    const severity = computeSeverity(waitingTimeScore, anomaly.anomalyScore);

    return {
      taskId: id,
      taskTitle,
      waitingTimeScore,
      anomalyScore: anomaly.anomalyScore,
      isAnomaly: anomaly.isAnomaly,
      isHighWaitingTime:
        features.idleHours >= HIGH_WAITING_HOURS_THRESHOLD ||
        severity === "high" ||
        severity === "critical",
      severity,
      method: anomaly.method,
      features,
      explanation: buildExplanation(taskTitle, features),
      recommendation: buildRecommendation(severity, features),
    };
  });

  await persistInsights(projectId, results);

  return results.sort((a, b) => b.anomalyScore - a.anomalyScore);
}

/** Single-task lookup used by GET /history/tasks/:taskId/waiting-time. */
export async function getHiddenWaitingTime(
  taskId: string,
  userId: string
): Promise<WaitingTimeResult> {
  const { data: task, error } = await supabase
    .from("task")
    .select("id, project_id, title, created_at")
    .eq("id", taskId)
    .eq("is_deleted", false)
    .maybeSingle();

  if (error) throw new AppError(error.message, 500);
  const found = assertFound(task, "Task");
  if (!found.project_id) throw new AppError("Task has no project", 400);

  const insights = await getWaitingTimeInsights(found.project_id, userId);
  const match = insights.find((r) => r.taskId === taskId);
  if (match) return match;

  const segments = await getTaskStatusDuration(taskId);
  const features = buildFeatures(segments, found.created_at);
  return {
    taskId,
    taskTitle: found.title,
    waitingTimeScore: 0,
    anomalyScore: 0,
    isAnomaly: false,
    isHighWaitingTime: false,
    severity: "low",
    method: "iqr",
    features,
    explanation: "This task has not spent any time in a waiting or blocked state.",
    recommendation: "No action needed.",
  };
}

async function persistInsights(projectId: string, results: WaitingTimeResult[]): Promise<void> {
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
    score: r.waitingTimeScore,
    metrics: {
      anomalyScore: r.anomalyScore,
      isAnomaly: r.isAnomaly,
      isHighWaitingTime: r.isHighWaitingTime,
      severity: r.severity,
      method: r.method,
      features: r.features,
    },
    narrative: r.explanation,
    computed_at: new Date().toISOString(),
  }));

  const { error: insertError } = await supabase.from("project_insights").insert(rows);
  if (insertError) throw new AppError(insertError.message, 500);
}