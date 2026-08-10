import { Router } from "express";
import { getUserId } from "../utils/auth";
import { getContextSwitchingInsights } from "../services/contextSwitchingService";
import { getHandoffBreakdownInsights } from "../services/handoffService";
import { getInsightsDashboard } from "../services/insightsDashboardService";

const router = Router();

router.get("/context-switching/:projectId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const insights = await getContextSwitchingInsights(req.params.projectId, userId);
    res.json(insights);
  } catch (err) {
    next(err);
  }
});

router.get("/handoffs/:projectId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const insights = await getHandoffBreakdownInsights(req.params.projectId, userId);
    res.json(insights);
  } catch (err) {
    next(err);
  }
});

router.get("/dashboard/:projectId", async (req, res, next) => {
  try {
    const userId = getUserId(req);
    const dashboard = await getInsightsDashboard(req.params.projectId, userId);
    res.json(dashboard);
  } catch (err) {
    next(err);
  }
});

export default router;
