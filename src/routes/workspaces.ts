import { Router } from "express";
import { getUserId } from "../utils/auth";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspaceById,
  listWorkspaces,
  updateWorkspace,
} from "../services/workspaceService";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const workspaces = await listWorkspaces(getUserId(req));
    res.json(workspaces);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const workspace = await createWorkspace(getUserId(req), req.body.name);
    res.status(201).json(workspace);
  } catch (err) {
    next(err);
  }
});

router.get("/:workspaceId", async (req, res, next) => {
  try {
    const workspace = await getWorkspaceById(req.params.workspaceId, getUserId(req));
    res.json(workspace);
  } catch (err) {
    next(err);
  }
});

router.patch("/:workspaceId", async (req, res, next) => {
  try {
    const workspace = await updateWorkspace(
      req.params.workspaceId,
      getUserId(req),
      req.body.name
    );
    res.json(workspace);
  } catch (err) {
    next(err);
  }
});

router.delete("/:workspaceId", async (req, res, next) => {
  try {
    await deleteWorkspace(req.params.workspaceId, getUserId(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
