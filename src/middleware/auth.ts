import { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";

export interface AuthRequest extends Request {
  userId: string;
}

/**
 * Accepts either:
 *  - Authorization: Bearer <token>  → real session from /api/auth/login or /api/auth/signup
 *  - X-User-Id: <uuid>              → legacy path, still works exactly as before
 */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  try {
    const authHeader = req.header("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        throw new AppError("Invalid or expired session", 401);
      }
      (req as AuthRequest).userId = data.user.id;
      return next();
    }

    const userId = req.header("X-User-Id");
    if (!userId) {
      throw new AppError("Missing Authorization bearer token or X-User-Id header", 401);
    }

    const { data, error } = await supabase
      .from("app_user")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (error) throw new AppError(error.message, 500);
    if (!data) throw new AppError("User not found", 401);

    (req as AuthRequest).userId = userId;
    next();
  } catch (err) {
    next(err);
  }
}