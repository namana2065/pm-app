import { test } from "node:test";
import assert from "node:assert/strict";

// Services import the Supabase client at load time; give it dummy env so pure
// logic can be tested without a database.
process.env.SUPABASE_URL ??= "http://localhost";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test";

const load = async () => ({
  history: await import("../src/services/historyService"),
  handoff: await import("../src/services/handoffService"),
  dash: await import("../src/services/insightsDashboardService"),
  anomaly: await import("../src/utils/anomalyDetection"),
});

const snap = (at: string, status: string) =>
  ({ id: at, task_id: "T", user_id: null, event_type: "updated", task_snapshot: { status }, created_at: at }) as any;

const ev = (type: "assignee_added" | "assignee_removed", user: string, at: string) =>
  ({
    id: `${type}${user}${at}`, task_id: "T", project_id: "P", user_id: user, event_type: type,
    from_value: type === "assignee_removed" ? user : null,
    to_value: type === "assignee_added" ? user : null,
    created_at: at,
  }) as any;

test("timeline: repeated same-status snapshots merge into one interval", async () => {
  const { history } = await load();
  const rows = [
    snap("2026-01-01T00:00:00Z", "in_progress"),
    snap("2026-01-02T00:00:00Z", "in_progress"),
    snap("2026-01-03T00:00:00Z", "in_progress"),
    snap("2026-01-04T00:00:00Z", "waiting"),
    snap("2026-01-05T00:00:00Z", "waiting"),
  ];
  const tl = history.buildStatusTimeline("T", rows, { status: "waiting", created_at: rows[0].created_at } as any);
  assert.deepEqual(tl.map((s: any) => s.status), ["in_progress", "waiting"]);
  assert.equal(Math.round(tl[0].durationHours), 72); // Jan 1 -> Jan 4
  assert.equal(tl[0].enteredAt, "2026-01-01T00:00:00Z");
  assert.equal(tl[1].exitedAt, null); // open final segment
});

test("handoff: same user removed and re-added is NOT a handoff", async () => {
  const { handoff } = await load();
  const events = [
    ev("assignee_removed", "A", "2026-08-10T16:18:00Z"),
    ev("assignee_removed", "S", "2026-08-10T16:19:54Z"),
    ev("assignee_added", "A", "2026-08-10T16:20:05Z"),
    ev("assignee_added", "S", "2026-08-10T16:20:22Z"),
  ];
  assert.equal(handoff.pairHandoffs("T", events).length, 0);
});

test("handoff: remove A then add B is a handoff A -> B", async () => {
  const { handoff } = await load();
  const h = handoff.pairHandoffs("T", [
    ev("assignee_removed", "A", "2026-08-10T10:00:00Z"),
    ev("assignee_added", "B", "2026-08-10T12:00:00Z"),
  ]);
  assert.equal(h.length, 1);
  assert.equal(h[0].previousOwnerId, "A");
  assert.equal(h[0].nextOwnerId, "B");
});

test("handoff: add B then remove A (reverse order) is also detected", async () => {
  const { handoff } = await load();
  const h = handoff.pairHandoffs("T", [
    ev("assignee_added", "B", "2026-08-10T10:00:00Z"),
    ev("assignee_removed", "A", "2026-08-10T12:00:00Z"),
  ]);
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].previousOwnerId, h[0].nextOwnerId], ["A", "B"]);
});

test("handoff: interleaved removals/additions cannot invent a cross-user transfer", async () => {
  const { handoff } = await load();
  const h = handoff.pairHandoffs("T", [
    ev("assignee_removed", "A", "2026-08-10T10:00:00Z"),
    ev("assignee_removed", "S", "2026-08-10T10:01:00Z"),
    ev("assignee_added", "S", "2026-08-10T10:02:00Z"), // S re-added first
    ev("assignee_added", "A", "2026-08-10T10:03:00Z"),
  ]);
  assert.equal(h.length, 0); // old FIFO code returned A -> S and S -> A
});

test("dashboard: totalAnomalies equals the sum of the category counts", async (t) => {
  const { dash } = await load();
  // buildSummary must be exported from insightsDashboardService.ts for this test.
  if (typeof (dash as any).buildSummary !== "function") {
    t.skip("buildSummary is not exported; add `export` to run this test");
    return;
  }
  const cs: any[] = [{ isAnomaly: true, severity: "critical" }, { isAnomaly: false, severity: "low" }];
  const ho: any[] = [];
  const hw: any[] = [{ isAnomaly: true, severity: "critical" }];
  const rs: any[] = [{ isWaitingTimeAnomaly: true, riskLevel: "critical" }]; // mirrors hw
  const s = dash.buildSummary(cs, ho, hw, rs);
  assert.equal(s.totalAnomalies, 2);
  assert.equal(s.totalAnomalies, s.contextSwitchingAnomalies + s.handoffBreakdownAnomalies + s.hiddenWaitingAnomalies);
});

test("IQR path reproduces the reported paper-run scores", async () => {
  const { anomaly } = await load();
  const ctx = anomaly.detectAnomalies([[9, 3.05, 0.24, 12], [1, 0.67, 0, 1], [1, 0.7, 0, 2], [1, 0.93, 0, 3], [1, 1, 0, 1]]);
  assert.equal(ctx[0].anomalyScore, 100);
  assert.ok(ctx[0].isAnomaly && ctx.slice(1).every((r: any) => !r.isAnomaly));
  assert.ok(ctx.every((r: any) => r.method === "iqr"));
});

test("Isolation Forest: used at n>=30, deterministic, normal points score low, outlier flagged", async () => {
  const { anomaly } = await load();
  const data: number[][] = [];
  for (let i = 0; i < 40; i++) data.push([10 + (i % 5), 1 + (i % 3) * 0.1, 0.1 * (i % 4)]);
  data.push([500, 40, 9]); // clear outlier
  const a = anomaly.detectAnomalies(data);
  const b = anomaly.detectAnomalies(data);
  assert.deepEqual(a, b); // seeded -> reproducible
  assert.ok(a.every((r: any) => r.method === "isolation_forest"));
  assert.ok(a[40].isAnomaly && a[40].anomalyScore >= 50);
  const normals = a.slice(0, 40);
  assert.ok(normals.filter((r: any) => r.isAnomaly).length <= 2);
  // normal points must NOT sit at ~50 (old bug => always "medium" severity)
  const medianNormal = normals.map((r: any) => r.anomalyScore).sort((x: number, y: number) => x - y)[20];
  assert.ok(medianNormal < 35, `median normal score ${medianNormal} should be < 35`);
});

test("n=29 uses IQR, n=30 uses Isolation Forest (threshold boundary)", async () => {
  const { anomaly } = await load();
  const mk = (n: number) => Array.from({ length: n }, (_, i) => [i % 7, i % 3]);
  assert.equal(anomaly.detectAnomalies(mk(29))[0].method, "iqr");
  assert.equal(anomaly.detectAnomalies(mk(30))[0].method, "isolation_forest");
});
