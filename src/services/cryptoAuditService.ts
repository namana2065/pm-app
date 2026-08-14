import { supabase } from "../lib/supabaseClient";
import { AppError } from "../lib/errors";

export interface AuditVerificationResult {
  valid: boolean;
  checkedRecords: number;
  brokenAt: string | null;
  reason?: string;
}

/**
 * Verifies the SHA-256 hash chain for a task's audit trail by calling the
 * verify_task_audit_chain() Postgres function (see the migration file),
 * instead of recomputing the hash in Node.
 */
export async function verifyTaskAuditChain(taskId: string): Promise<AuditVerificationResult> {
  const { data, error } = await supabase.rpc("verify_task_audit_chain", {
    p_task_id: taskId,
  });

  if (error) throw new AppError(error.message, 500);
  if (!data) throw new AppError("Audit verification returned no result", 500);

  return data as AuditVerificationResult;
}