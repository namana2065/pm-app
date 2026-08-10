// reads userId from request

import { Request } from "express";
import { AuthRequest } from "../middleware/auth";

export function getUserId(req: Request): string {
  return (req as AuthRequest).userId;
}
