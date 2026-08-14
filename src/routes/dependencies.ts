import { Router } from "express";
import { getUserId } from "../utils/auth";
import {
  createDep,
  deleteDep,
  listDeps,
} from "../services/dependencyService";
import { validateTaskAccess } from "../services/accessService";
import { getTaskRiskScore } from "../services/riskScoreService";
import { getTaskImpact } from "../services/dependencyAnalysisService";
const router = Router();

router.get("/task/:taskId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const deps = await listDeps(req.params.taskId, userId);
    res.json(deps);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { blockingTaskId, blockedTaskId } = req.body;
    const dep = await createDep(blockingTaskId, blockedTaskId, userId);
    res.status(201).json(dep);
  } catch (err) {
    next(err);
  }
});

router.delete("/:depId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    await deleteDep(req.params.depId, userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.get("/task/:taskId/impact", async (req, res, next) => {
  try {
    const userId = getUserId(req);

    await validateTaskAccess(userId, req.params.taskId);

    const impact = await getTaskImpact(req.params.taskId);

    res.json(impact);
  } catch (err) {
    next(err);
  }
});
router.get("/task/:taskId/risk", async (req, res, next) => {
  try {
    const userId = getUserId(req);

    await validateTaskAccess(userId, req.params.taskId);

    const result = await getTaskRiskScore(req.params.taskId, userId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
export default router;
