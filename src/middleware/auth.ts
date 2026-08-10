import { Request, Response, NextFunction } from "express";
import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";

export interface AuthRequest extends Request {
  userId: string;
}

/** Temporary auth: pass the acting user's UUID in X-User-Id until Supabase Auth is wired. */
export async function requireUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = req.header("X-User-Id");
    if (!userId) {
      throw new AppError("Missing X-User-Id header", 401);
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
