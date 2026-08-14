import { Router } from "express";
import { getUserId } from "../utils/auth";
import {
  getProjectHistory,
  getProjectHistoryFeed,
  getTaskHistory,
  getTaskStatusDuration,
} from "../services/historyService";
import { requireProjectAccess, validateTaskAccess } from "../services/accessService";
import { verifyTaskAuditChain } from "../services/cryptoAuditService";
import { getHiddenWaitingTime } from "../services/waitingTimeService";

const router = Router();

router.get("/tasks/:taskId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    await validateTaskAccess(userId, req.params.taskId);
    const history = await getTaskHistory(req.params.taskId);
    res.json(history);
  } catch (err) {
    next(err);
  }
});

router.get("/tasks/:taskId/segments", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    await validateTaskAccess(userId, req.params.taskId);
    const segments = await getTaskStatusDuration(req.params.taskId);
    res.json(segments);
  } catch (err) {
    next(err);
  }
});

router.get("/projects/:projectId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    await requireProjectAccess(userId, req.params.projectId, "viewer");
    const history = await getProjectHistory(req.params.projectId);
    res.json(history);
  } catch (err) {
    next(err);
  }
});
router.get("/projects/:projectId/feed", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    await requireProjectAccess(userId, req.params.projectId, "viewer");
    const feed = await getProjectHistoryFeed(req.params.projectId);
    res.json(feed);
  } catch (err) {
    next(err);
  }
});
router.get("/tasks/:taskId/crypto/verify", async (req, res, next) => {
  try {
    const userId = getUserId(req);

    await validateTaskAccess(userId, req.params.taskId);

    const result = await verifyTaskAuditChain(req.params.taskId);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get("/tasks/:taskId/waiting-time", async (req, res, next) => {
  try {
    const userId = getUserId(req);

    await validateTaskAccess(userId, req.params.taskId);

    const result = await getHiddenWaitingTime(req.params.taskId, userId); 
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
