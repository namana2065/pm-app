import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";
import { requireProjectAccess } from "./accessService";
import { getProjectStatusDuration } from "./historyService";
import { detectAnomalies } from "../utils/anomalyDetection";
import {
  AssigneeEvent,
  HandoffFeatures,
  HandoffResult,
  SeverityLevel,
  StatusTimeline,
} from "../types/database";

const INSIGHT_TYPE = "handoff_breakdown";
const IDLE_STATUSES = new Set(["waiting", "blocked"]);

export interface PairedHandoff {
  taskId: string;
  previousOwnerId: string | null;
  nextOwnerId: string | null;
  removedAt: string;
  addedAt: string;
}

/** Loads {id -> title} for every non-deleted task in the project. */
async function loadProjectTasks(projectId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("task")
    .select("id, title")
    .eq("project_id", projectId)
    .eq("is_deleted", false);

  if (error) throw new AppError(error.message, 500);

  const map = new Map<string, string>();
  for (const task of data ?? []) {
    map.set(task.id, task.title);
  }
  return map;
}

/** Loads assignee_added/assignee_removed workflow events for the given tasks, oldest first. */
async function loadAssigneeEvents(
  projectId: string,
  taskIds: string[]
): Promise<AssigneeEvent[]> {
  const { data, error } = await supabase
    .from("workflow_event")
    .select("*")
    .eq("project_id", projectId)
    .in("task_id", taskIds)
    .in("event_type", ["assignee_added", "assignee_removed"])
    .order("created_at", { ascending: true });

  if (error) throw new AppError(error.message, 500);
  return (data ?? []) as AssigneeEvent[];
}

/**
 * Pairs assignee events for one task into ownership handoffs.
 *
 * A handoff is an outgoing assignee X being replaced by a DIFFERENT assignee Y,
 * in either order:
 *   - remove X, then add Y   (delay = time between the two events)
 *   - add Y, then remove X   (delay = 0, the new owner was already in place)
 *
 * Removing and re-adding the SAME user is a re-assignment, not a handoff, and
 * is ignored. Events are matched by user id (not first-in-first-out), so
 * interleaved changes for several users cannot create a fake A -> B transfer.
 * Unmatched removals/additions are left unpaired (no completed handoff yet).
 */
export function pairHandoffs(taskId: string, events: AssigneeEvent[]): PairedHandoff[] {
  const pendingRemovals: { userId: string; at: string }[] = [];
  const pendingAdditions: { userId: string; at: string }[] = [];
  const handoffs: PairedHandoff[] = [];

  const sorted = [...events].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

  for (const event of sorted) {
    if (event.event_type === "assignee_removed") {
      const userId = event.from_value ?? event.user_id;
      if (!userId) continue;

      // Added then removed again: cancel that pending addition.
      const own = pendingAdditions.findIndex((a) => a.userId === userId);
      if (own !== -1) pendingAdditions.splice(own, 1);

      // A different user was already added -> add-then-remove handoff.
      const next = pendingAdditions.findIndex((a) => a.userId !== userId);
      if (next !== -1) {
        const [added] = pendingAdditions.splice(next, 1);
        handoffs.push({
          taskId,
          previousOwnerId: userId,
          nextOwnerId: added.userId,
          removedAt: event.created_at,
          addedAt: added.at,
        });
      } else {
        pendingRemovals.push({ userId, at: event.created_at });
      }
    } else if (event.event_type === "assignee_added") {
      const userId = event.to_value ?? event.user_id;
      if (!userId) continue;

      // Same user removed earlier and re-added: a re-assignment, not a handoff.
      const same = pendingRemovals.findIndex((r) => r.userId === userId);
      if (same !== -1) {
        pendingRemovals.splice(same, 1);
        continue;
      }

      // A different user was removed earlier -> remove-then-add handoff.
      const prev = pendingRemovals.findIndex((r) => r.userId !== userId);
      if (prev !== -1) {
        const [removed] = pendingRemovals.splice(prev, 1);
        handoffs.push({
          taskId,
          previousOwnerId: removed.userId,
          nextOwnerId: userId,
          removedAt: removed.at,
          addedAt: event.created_at,
        });
      } else {
        pendingAdditions.push({ userId, at: event.created_at });
      }
    }
  }

  return handoffs;
}

/**
 * Sums idle (waiting/blocked) hours for a task starting from `sinceMs`, up
 * until the task first re-enters in_progress after that point (or "now" if
 * it never does). This captures how long the task sat idle right after the
 * handoff before real work resumed.
 */
function computePostHandoffIdleHours(timeline: StatusTimeline[], sinceMs: number): number {
  const relevant = timeline
    .filter((segment) => new Date(segment.enteredAt).getTime() >= sinceMs)
    .sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime());

  let idleHours = 0;
  for (const segment of relevant) {
    if (segment.status === "in_progress") break; // work resumed, stop counting idle time
    if (IDLE_STATUSES.has(segment.status)) {
      idleHours += segment.durationHours ?? 0;
    }
  }
  return idleHours;
}

function buildFeatures(handoff: PairedHandoff, taskTimeline: StatusTimeline[]): HandoffFeatures {
  const removedMs = new Date(handoff.removedAt).getTime();
  const addedMs = new Date(handoff.addedAt).getTime();
  const handoffDelayHours = Math.max(0, (addedMs - removedMs) / (1000 * 60 * 60));

  const postHandoffIdleHours = computePostHandoffIdleHours(taskTimeline, Math.max(removedMs, addedMs));

  return {
    handoffDelayHours: Math.round(handoffDelayHours * 100) / 100,
    postHandoffIdleHours: Math.round(postHandoffIdleHours * 100) / 100,
  };
}

/**
 * A 0-100 score describing how inefficient this handoff was, computed
 * directly from its own features (does not require comparison to other
 * handoffs, unlike the anomaly score).
 */
function computeHandoffBreakdownScore(features: HandoffFeatures): number {
  const delayPenalty = features.handoffDelayHours * 1.5;
  const idlePenalty = features.postHandoffIdleHours * 1;

  return Math.min(100, Math.round(delayPenalty + idlePenalty));
}

function computeSeverity(handoffBreakdownScore: number, anomalyScore: number): SeverityLevel {
  const signal = Math.max(handoffBreakdownScore, anomalyScore);
  if (signal >= 80) return "critical";
  if (signal >= 60) return "high";
  if (signal >= 35) return "medium";
  return "low";
}

function buildExplanation(
  taskTitle: string,
  previousOwnerName: string,
  nextOwnerName: string,
  features: HandoffFeatures
): string {
  return (
    `"${taskTitle}" took ${features.handoffDelayHours}h to move from ${previousOwnerName} to ` +
    `${nextOwnerName}, then sat idle for another ${features.postHandoffIdleHours}h before work resumed.`
  );
}

function buildRecommendation(severity: SeverityLevel, features: HandoffFeatures): string {
  if (severity === "critical") {
    return "This handoff stalled the task significantly. Assign a clear next owner before removing the previous one, and follow up immediately after reassignment.";
  }
  if (severity === "high") {
    return "Consider a direct handoff conversation between the previous and next owner to avoid idle time after reassignment.";
  }
  if (severity === "medium") {
    return "Keep an eye on handoffs for this task; a short handoff checklist could tighten the transition.";
  }
  return "No action needed — this handoff transitioned smoothly.";
}

/**
 * Computes Handoff Breakdown Detection insights for every completed
 * ownership transfer (assignee removed -> assignee added) in a project, and
 * persists the results into the existing project_insights table
 * (insight_type = "handoff_breakdown").
 */
export async function getHandoffBreakdownInsights(
  projectId: string,
  userId: string
): Promise<HandoffResult[]> {
  await requireProjectAccess(userId, projectId, "viewer");

  const taskTitles = await loadProjectTasks(projectId);
  const taskIds = Array.from(taskTitles.keys());
  if (taskIds.length === 0) return [];

  const events = await loadAssigneeEvents(projectId, taskIds);
  if (events.length === 0) return [];

  const eventsByTask = new Map<string, AssigneeEvent[]>();
  for (const event of events) {
    if (!event.task_id) continue;
    const existing = eventsByTask.get(event.task_id) ?? [];
    existing.push(event);
    eventsByTask.set(event.task_id, existing);
  }

  const pairedHandoffs: PairedHandoff[] = [];
  for (const [taskId, taskEvents] of eventsByTask) {
    pairedHandoffs.push(...pairHandoffs(taskId, taskEvents));
  }
  if (pairedHandoffs.length === 0) return [];

  const timeline = await getProjectStatusDuration(projectId);
  const timelineByTask = new Map<string, StatusTimeline[]>();
  for (const segment of timeline) {
    const existing = timelineByTask.get(segment.taskId) ?? [];
    existing.push(segment);
    timelineByTask.set(segment.taskId, existing);
  }

  const ownerIds = Array.from(
    new Set(
      pairedHandoffs.flatMap((h) => [h.previousOwnerId, h.nextOwnerId]).filter((id): id is string => !!id)
    )
  );

  const { data: owners, error: ownersError } =
    ownerIds.length > 0
      ? await supabase.from("app_user").select("id, name").in("id", ownerIds)
      : { data: [], error: null };

  if (ownersError) throw new AppError(ownersError.message, 500);
  const ownerMap = new Map((owners ?? []).map((o) => [o.id, o.name]));

  const perHandoffFeatures = pairedHandoffs.map((h) =>
    buildFeatures(h, timelineByTask.get(h.taskId) ?? [])
  );
  const featureVectors = perHandoffFeatures.map((f) => [
    f.handoffDelayHours,
    f.postHandoffIdleHours,
  ]);

  const anomalyResults = detectAnomalies(featureVectors);

  const results: HandoffResult[] = pairedHandoffs.map((handoff, index) => {
    const features = perHandoffFeatures[index];
    const anomaly = anomalyResults[index];

    const taskTitle = taskTitles.get(handoff.taskId) ?? "Unknown task";
    const previousOwnerName = handoff.previousOwnerId
      ? ownerMap.get(handoff.previousOwnerId) ?? "a previous owner"
      : "an unassigned state";
    const nextOwnerName = handoff.nextOwnerId
      ? ownerMap.get(handoff.nextOwnerId) ?? "a new owner"
      : "an unassigned state";

    const handoffBreakdownScore = computeHandoffBreakdownScore(features);
    const severity = computeSeverity(handoffBreakdownScore, anomaly.anomalyScore);

    return {
      taskId: handoff.taskId,
      taskTitle: taskTitles.get(handoff.taskId) ?? null,
      previousOwnerId: handoff.previousOwnerId,
      previousOwnerName: handoff.previousOwnerId ? ownerMap.get(handoff.previousOwnerId) ?? null : null,
      nextOwnerId: handoff.nextOwnerId,
      nextOwnerName: handoff.nextOwnerId ? ownerMap.get(handoff.nextOwnerId) ?? null : null,
      removedAt: handoff.removedAt,
      addedAt: handoff.addedAt,
      handoffBreakdownScore,
      anomalyScore: anomaly.anomalyScore,
      isAnomaly: anomaly.isAnomaly,
      severity,
      method: anomaly.method,
      features,
      explanation: buildExplanation(taskTitle, previousOwnerName, nextOwnerName, features),
      recommendation: buildRecommendation(severity, features),
    };
  });

  await persistInsights(projectId, results);

  return results.sort((a, b) => b.anomalyScore - a.anomalyScore);
}

/** Overwrites this project's stored handoff-breakdown insights with the freshly computed ones. */
async function persistInsights(projectId: string, results: HandoffResult[]): Promise<void> {
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
    score: r.handoffBreakdownScore,
    metrics: {
      previousOwnerId: r.previousOwnerId,
      nextOwnerId: r.nextOwnerId,
      removedAt: r.removedAt,
      addedAt: r.addedAt,
      anomalyScore: r.anomalyScore,
      isAnomaly: r.isAnomaly,
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
