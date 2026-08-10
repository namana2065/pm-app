import { Router } from "express";
import { getUserId } from "../utils/auth";
import {
  createTask,
  deleteTask,
  getDelayDays,
  getTaskById,
  listTasks,
  updateTask,
  updateTaskStatus,
} from "../services/taskService";
import { getCriticalPathToTask, getTaskImpact } from "../services/dependencyAnalysisService";
import { addAssignee, listAssignees, removeAssignee } from "../services/assigneeService";
import { StatusType } from "../types/database";

const router = Router();

router.get("/project/:projectId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const tasks = await listTasks(req.params.projectId, userId);
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

router.post("/project/:projectId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const task = await createTask({
      title: req.body.title,
      projectId: req.params.projectId,
      sectionId: req.body.sectionId,
      userId,
      description: req.body.description,
      priority: req.body.priority,
      startDate: req.body.startDate,
      dueDate: req.body.dueDate,
    });
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

router.get("/:taskId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const task = await getTaskById(req.params.taskId, userId);
    res.json(task);
  } catch (err) {
    next(err);
  }
});

router.patch("/:taskId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const task = await updateTask(req.params.taskId, userId, {
      title: req.body.title,
      description: req.body.description,
      priority: req.body.priority,
      startDate: req.body.startDate,
      dueDate: req.body.dueDate,
      sectionId: req.body.sectionId,
      delayCauseId: req.body.delayCauseId,
    });
    res.json(task);
  } catch (err) {
    next(err);
  }
});

router.delete("/:taskId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    await deleteTask(req.params.taskId, userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.patch("/:taskId/status", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const status = req.body.status as StatusType;
    const task = await updateTaskStatus(req.params.taskId, userId, status);
    res.json(task);
  } catch (err) {
    next(err);
  }
});

router.get("/:taskId/delay-days", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const task = await getTaskById(req.params.taskId, userId);
    const delayDays = await getDelayDays(task);
    res.json({ taskId: task.id, delayDays, status: task.status });
  } catch (err) {
    next(err);
  }
});

router.get("/:taskId/impact", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    await getTaskById(req.params.taskId, userId);
    const impact = await getTaskImpact(req.params.taskId);
    res.json(impact);
  } catch (err) {
    next(err);
  }
});

router.get("/:taskId/critical-path", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    await getTaskById(req.params.taskId, userId);
    const path = await getCriticalPathToTask(req.params.taskId);
    res.json(path);
  } catch (err) {
    next(err);
  }
});

router.get("/:taskId/assignees", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const assignees = await listAssignees(req.params.taskId, userId);
    res.json(assignees);
  } catch (err) {
    next(err);
  }
});

router.post("/:taskId/assignees", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const row = await addAssignee(req.params.taskId, userId, req.body.assigneeId);
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

router.delete("/:taskId/assignees/:assigneeId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    await removeAssignee(req.params.taskId, userId, req.params.assigneeId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
