import express from "express";
import cors from "cors";
import { requireUser } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import projectRoutes from "./routes/projects";
import authRoutes from "./routes/auth";
import sectionRoutes from "./routes/sections";
import taskRoutes from "./routes/tasks";
import workspaceRoutes from "./routes/workspaces";
import dependencyRoutes from "./routes/dependencies";
import historyRoutes from "./routes/history";
import insightsRoutes from "./routes/insights";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // Auth routes must NOT require authentication
  app.use("/api/auth", authRoutes);

  // Everything below this point requires authentication
  app.use(requireUser);

  app.use("/api/workspaces", workspaceRoutes);
  app.use("/api/projects", projectRoutes);
  app.use("/api/projects/:projectId/sections", sectionRoutes);
  app.use("/api/tasks", taskRoutes);
  app.use("/api/dependencies", dependencyRoutes);
  app.use("/api/history", historyRoutes);
  app.use("/api/insights", insightsRoutes);

  app.use(errorHandler);

  return app;
}