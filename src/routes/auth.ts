import { Router } from "express";
import { signup, login, logout } from "../services/authService";

const router = Router();

router.post("/signup", async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const session = await signup({ name, email, password });
    res.status(201).json(session);
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const session = await login({ email, password });
    res.json(session);
  } catch (err) {
    next(err);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    const authHeader = req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (token) await logout(token);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;