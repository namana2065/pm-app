// Hybrid anomaly detection: IQR for small datasets, Isolation Forest for larger ones.
// Shared across the AI Workflow Engine features (context switching, handoffs, etc).
// Pure TypeScript, no external dependencies.

export type AnomalyMethod = "iqr" | "isolation_forest";

export interface AnomalyResult {
  index: number;
  anomalyScore: number; // 0-100, higher = more anomalous
  isAnomaly: boolean;
  method: AnomalyMethod;
}

/** Below this many data points we fall back to IQR (Isolation Forest needs more
 * data to build meaningful trees). Above it we use Isolation Forest. */
const ISOLATION_FOREST_MIN_SAMPLES = 30;

/** Isolation Forest score above this is treated as anomalous (standard
 * convention from Liu et al., 2008: scores > ~0.6 indicate anomalies). */
const ISOLATION_FOREST_ANOMALY_THRESHOLD = 0.6;

// ─────────────────────────────────────────────────────────────────────────
// IQR (Interquartile Range)
// ─────────────────────────────────────────────────────────────────────────

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

/**
 * Per-dimension IQR anomaly scoring. For each feature (column) we compute
 * Q1/Q3 fences and score how far outside the fences a value falls. The final
 * per-row score is the max across dimensions, since a single wildly-off
 * feature is enough to flag an entity as anomalous.
 */
function iqrScores(data: number[][]): number[] {
  const n = data.length;
  if (n === 0) return [];
  const dims = data[0].length;

  const dimScores: number[][] = data.map(() => new Array(dims).fill(0));

  for (let d = 0; d < dims; d++) {
    const column = data.map((row) => row[d]).sort((a, b) => a - b);
    const q1 = quantile(column, 0.25);
    const q3 = quantile(column, 0.75);
    const iqr = q3 - q1;

    if (iqr === 0) continue; // no spread on this dimension, nothing to flag

    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;

    for (let i = 0; i < n; i++) {
      const value = data[i][d];
      let distance = 0;
      if (value > upperFence) distance = (value - upperFence) / iqr;
      else if (value < lowerFence) distance = (lowerFence - value) / iqr;

      // Normalize: a value 3x the IQR beyond the fence maps to ~100.
      dimScores[i][d] = Math.min(100, distance * (100 / 3));
    }
  }

  return dimScores.map((row) => Math.max(0, ...row));
}

// ─────────────────────────────────────────────────────────────────────────
// Isolation Forest
// ─────────────────────────────────────────────────────────────────────────

interface ITreeNode {
  size: number;
  splitFeature?: number;
  splitValue?: number;
  left?: ITreeNode;
  right?: ITreeNode;
}

const NUM_TREES = 100;
const MAX_SUBSAMPLE_SIZE = 256;

function averagePathLengthForUnbuiltNode(size: number): number {
  // c(n): average path length of an unsuccessful search in a BST,
  // used to normalize path lengths for leaves that stopped early.
  if (size <= 1) return 0;
  const harmonic = Math.log(size - 1) + 0.5772156649; // Euler-Mascheroni constant
  return 2 * harmonic - (2 * (size - 1)) / size;
}

function buildTree(
  sample: number[][],
  indices: number[],
  depth: number,
  maxDepth: number
): ITreeNode {
  if (depth >= maxDepth || indices.length <= 1) {
    return { size: indices.length };
  }

  const dims = sample[0].length;
  const splitFeature = Math.floor(Math.random() * dims);

  let min = Infinity;
  let max = -Infinity;
  for (const i of indices) {
    const v = sample[i][splitFeature];
    if (v < min) min = v;
    if (v > max) max = v;
  }

  if (min === max) {
    return { size: indices.length };
  }

  const splitValue = min + Math.random() * (max - min);

  const left: number[] = [];
  const right: number[] = [];
  for (const i of indices) {
    if (sample[i][splitFeature] < splitValue) left.push(i);
    else right.push(i);
  }

  // Degenerate split guard (shouldn't normally happen given min !== max).
  if (left.length === 0 || right.length === 0) {
    return { size: indices.length };
  }

  return {
    size: indices.length,
    splitFeature,
    splitValue,
    left: buildTree(sample, left, depth + 1, maxDepth),
    right: buildTree(sample, right, depth + 1, maxDepth),
  };
}

function pathLength(node: ITreeNode, point: number[], depth: number): number {
  if (node.splitFeature === undefined || node.splitValue === undefined) {
    return depth + averagePathLengthForUnbuiltNode(node.size);
  }
  if (point[node.splitFeature] < node.splitValue) {
    return pathLength(node.left!, point, depth + 1);
  }
  return pathLength(node.right!, point, depth + 1);
}

/**
 * Isolation Forest anomaly scoring (Liu, Ting & Zhou, 2008).
 * Builds an ensemble of random isolation trees; points that are isolated
 * with shorter average path length are more anomalous.
 * Returns scores in [0, 1], where ~0.5 is "normal" and closer to 1 is
 * increasingly anomalous.
 */
function isolationForestScores(data: number[][]): number[] {
  const n = data.length;
  const subSampleSize = Math.min(MAX_SUBSAMPLE_SIZE, n);
  const maxDepth = Math.ceil(Math.log2(Math.max(subSampleSize, 2)));
  const normalization = averagePathLengthForUnbuiltNode(subSampleSize) || 1;

  const trees: ITreeNode[] = [];
  const allIndices = Array.from({ length: n }, (_, i) => i);

  for (let t = 0; t < NUM_TREES; t++) {
    // Sample without replacement for this tree.
    const shuffled = [...allIndices].sort(() => Math.random() - 0.5);
    const sampleIndices = shuffled.slice(0, subSampleSize);
    trees.push(buildTree(data, sampleIndices, 0, maxDepth));
  }

  return data.map((point) => {
    const avgPathLength =
      trees.reduce((sum, tree) => sum + pathLength(tree, point, 0), 0) /
      trees.length;
    return Math.pow(2, -avgPathLength / normalization);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Hybrid entry point
// ─────────────────────────────────────────────────────────────────────────

/**
 * Runs hybrid anomaly detection over a set of feature vectors (one row per
 * entity being analyzed, e.g. one row per user or per task).
 * - Fewer than ISOLATION_FOREST_MIN_SAMPLES rows -> IQR (Isolation Forest
 *   needs a reasonable sample size to build meaningful trees).
 * - Otherwise -> Isolation Forest.
 */
export function detectAnomalies(data: number[][]): AnomalyResult[] {
  const n = data.length;
  if (n === 0) return [];

  if (n < ISOLATION_FOREST_MIN_SAMPLES) {
    const scores = iqrScores(data);
    return scores.map((score, index) => ({
      index,
      anomalyScore: Math.round(score),
      isAnomaly: score >= 50, // beyond ~1.5x IQR past the fence
      method: "iqr" as const,
    }));
  }

  const rawScores = isolationForestScores(data);
  return rawScores.map((score, index) => ({
    index,
    anomalyScore: Math.round(score * 100),
    isAnomaly: score >= ISOLATION_FOREST_ANOMALY_THRESHOLD,
    method: "isolation_forest" as const,
  }));
}
