import { Router } from "express";
import { getUserId } from "../utils/auth";
import {
  createProject,
  deleteProject,
  getProjectById,
  listProjects,
  updateProject,
} from "../services/projectService";
import {
  addProjectMember,
  listProjectMembers,
  removeUserFromProject,
} from "../services/membershipService";
const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { name, workspaceId, description } = req.body;
    const project = await createProject({ name, workspaceId, userId, description });
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});
router.get("/:projectId/members", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const members = await listProjectMembers(req.params.projectId, userId);
    res.json(members);
  } catch (err) {
    next(err);
  }
});
router.get("/workspace/:workspaceId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const projects = await listProjects(req.params.workspaceId, userId);
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

router.get("/:projectId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const project = await getProjectById(req.params.projectId, userId);
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.patch("/:projectId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const project = await updateProject(req.params.projectId, userId, {
      name: req.body.name,
      description: req.body.description,
    });
    res.json(project);
  } catch (err) {
    next(err);
  }
});

router.delete("/:projectId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    await deleteProject(req.params.projectId, userId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

router.post("/:projectId/members", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { memberUserId, role } = req.body;
    const member = await addProjectMember(
      req.params.projectId,
      userId,
      memberUserId,
      role ?? "viewer"
    );
    res.status(201).json(member);
  } catch (err) {
    next(err);
  }
});

router.delete("/:projectId/members/:memberUserId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const { requireProjectAccess } = await import("../services/accessService");
    await requireProjectAccess(userId, req.params.projectId, "admin");
    await removeUserFromProject(req.params.memberUserId, req.params.projectId);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
