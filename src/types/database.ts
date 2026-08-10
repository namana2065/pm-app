export type PriorityLevel = "low" | "medium" | "high" | "critical";
export type StatusType = "to_do" | "in_progress" | "waiting" | "blocked" | "done";
export type RoleType = "admin" | "editor" | "viewer";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  job_role_id: string | null;
}

export interface Workspace {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string | null;
  user_id: string | null;
  role: RoleType;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  workspace_id: string | null;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
  is_deleted: boolean;
}

export interface ProjectMember {
  id: string;
  project_id: string | null;
  user_id: string | null;
  role: RoleType;
}

export interface Section {
  id: string;
  project_id: string | null;
  name: string;
  description: string | null;
  position: number;
  created_at: string | null;
  deleted_at: string | null;
  is_deleted: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  section_id: string | null;
  delay_cause_id: string | null;
  parent_task_id: string | null;
  priority: PriorityLevel;
  start_date: string | null;
  due_date: string | null;
  position: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
  is_deleted: boolean;
  status: StatusType;
}

export interface TaskDep {
  id: string;
  blocking_task_id: string | null;
  blocked_task_id: string | null;
  created_at: string | null;
}

export interface TaskHistory {
  id: string;
  task_id: string;
  task_snapshot: Partial<Task> | null;
  user_id: string;
  event_type: string;
  created_at: string;
}

export interface AssigneeEvent {
  id: string;
  task_id: string | null;
  project_id: string | null;
  user_id: string | null;
  event_type: string;
  from_value: string | null;
  to_value: string | null;
  created_at: string;
}


export interface TaskAssignee {
  id: string;
  task_id: string | null;
  user_id: string | null;
}

export interface StatusTimeline {
  taskId: string;
  status: StatusType;
  enteredAt: string;
  exitedAt: string | null;
  durationHours: number | null;
}

export interface AssigneeHandoff {
  taskId: string;
  eventType: "assignee_added" | "assignee_removed";
  fromUserId: string | null;
  toUserId: string | null;
  changedAt: string;
  gapHours: number | null;
}

export interface CriticalPathResult {
  targetTaskId: string;
  chain: Task[];
  totalDurationDays: number;
  estimatedCompletionDate: string | null;
}

export interface TaskImpact {
  taskId: string;
  directDependents: number;
  totalDependents: number;
  blockedDependents: number;
}

// ── AI Workflow Engine ──────────────────────────────────────────────────

export type SeverityLevel = "low" | "medium" | "high" | "critical";

export interface ContextSwitchingFeatures {
  /** Distinct tasks this user actively worked on (entered in_progress) in the window. */
  activeTaskCount: number;
  /** Highest number of tasks this user had in_progress at the same time. */
  peakConcurrentActiveTasks: number;
  /** Time-weighted average number of concurrently active tasks. */
  avgConcurrentActiveTasks: number;
  /** Number of times the user picked up an additional task while another was still active. */
  contextSwitchCount: number;
  /** contextSwitchCount normalized per day of observed activity. */
  contextSwitchesPerDay: number;
  /** Average duration (hours) a task stayed in_progress for this user. */
  avgTaskActiveDurationHours: number;
  /** Number of days spanned by this user's observed activity. */
  windowDays: number;
}

export interface ContextSwitchingResult {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  /** 0-100 severity of this user's context-switching behaviour, independent of peers. */
  contextSwitchingScore: number;
  /** 0-100 how statistically unusual this user is relative to the rest of the project's team. */
  anomalyScore: number;
  isAnomaly: boolean;
  severity: SeverityLevel;
  method: "iqr" | "isolation_forest";
  features: ContextSwitchingFeatures;
  explanation: string;
  recommendation: string;
}

export interface HandoffFeatures {
  /** Hours between the previous owner being removed and the next owner being added. */
  handoffDelayHours: number;
  /** Hours the task then sat in waiting/blocked state before work resumed after the handoff. */
  postHandoffIdleHours: number;
}

export interface HandoffResult {
  taskId: string;
  taskTitle: string | null;
  previousOwnerId: string | null;
  previousOwnerName: string | null;
  nextOwnerId: string | null;
  nextOwnerName: string | null;
  /** When the previous owner was removed from the task. */
  removedAt: string;
  /** When the next owner was added to the task. */
  addedAt: string;
  /** 0-100 severity of this handoff's inefficiency, independent of peers. */
  handoffBreakdownScore: number;
  /** 0-100 how statistically unusual this handoff is relative to other handoffs in the project. */
  anomalyScore: number;
  isAnomaly: boolean;
  severity: SeverityLevel;
  method: "iqr" | "isolation_forest";
  features: HandoffFeatures;
  explanation: string;
  recommendation: string;
}

export interface DashboardSummary {
  overallRisk: SeverityLevel;
  /** 0-100, higher is healthier. Derived from the severity mix across all detected insights. */
  healthScore: number;
  totalAnomalies: number;
  contextSwitchingAnomalies: number;
  handoffBreakdownAnomalies: number;
}

export interface InsightsDashboardResult {
  summary: DashboardSummary;
  contextSwitching: ContextSwitchingResult[];
  handoffBreakdowns: HandoffResult[];
  /** Always [] — Hidden Waiting Time Detection isn't implemented in this project. See hiddenWaitingStatus. */
  hiddenWaiting: unknown[];
  hiddenWaitingStatus: "not_implemented";
  /** Top actionable recommendations pulled from the high/critical severity insights above. */
  recommendations: string[];
  computedAt: string;
}

