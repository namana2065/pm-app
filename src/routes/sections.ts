import { Router } from "express";
import { getUserId } from "../utils/auth";
import {
  createSection,
  deleteSection,
  listSections,
  updateSection,
} from "../services/sectionService";

const router = Router({ mergeParams: true });

router.get("/", async (req, res, next) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const sections = await listSections(projectId, getUserId(req));
    res.json(sections);
  } catch (err) {
    next(err);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const { projectId } = req.params as { projectId: string };
    const section = await createSection(projectId, getUserId(req), req.body.name);
    res.status(201).json(section);
  } catch (err) {
    next(err);
  }
});

router.patch("/:sectionId", async (req, res, next) => {
  try {
    const { projectId, sectionId } = req.params as {
      projectId: string;
      sectionId: string;
    };
    const section = await updateSection(sectionId, projectId, getUserId(req), {
      name: req.body.name,
      description: req.body.description,
      position: req.body.position,
    });
    res.json(section);
  } catch (err) {
    next(err);
  }
});

router.delete("/:sectionId", async (req, res, next) => {
  try {
    const { projectId, sectionId } = req.params as {
      projectId: string;
      sectionId: string;
    };
    await deleteSection(sectionId, projectId, getUserId(req));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
