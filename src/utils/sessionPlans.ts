import { CheckInMode, SessionStatus, AuditAction } from '../types';

export interface SessionBatchPlan {
  sessionId: string;
  sessionUpdate: {
    status: SessionStatus;
    checkInMode: CheckInMode;
    closedAt?: string;
    updatedAt: string;
  };
  auditEntry: {
    id: string;
    action: AuditAction;
    performedBy: string;
    performedByEmail?: string;
    targetId: string;
    details: string;
  };
}

/**
 * Pure generator function for completeSession atomic batch plan.
 * Bundles session status update and audit log entry for atomic execution.
 */
export function buildCompleteSessionBatchPlan(
  sessionId: string,
  operatorUid: string,
  operatorEmail?: string
): SessionBatchPlan {
  const nowIso = new Date().toISOString();
  const auditId = `audit_complete_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
  return {
    sessionId,
    sessionUpdate: {
      status: 'completed',
      checkInMode: 'closed',
      closedAt: nowIso,
      updatedAt: nowIso,
    },
    auditEntry: {
      id: auditId,
      action: 'complete_session',
      performedBy: operatorUid,
      performedByEmail: operatorEmail,
      targetId: sessionId,
      details: `Marked session ${sessionId} as completed`,
    },
  };
}

/**
 * Pure generator function for reopenSession atomic batch plan.
 * Bundles session status reset and audit log entry for atomic execution.
 */
export function buildReopenSessionBatchPlan(
  sessionId: string,
  targetMode: CheckInMode = 'auto',
  operatorUid: string,
  operatorEmail?: string
): SessionBatchPlan {
  const nowIso = new Date().toISOString();
  const auditId = `audit_reopen_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
  return {
    sessionId,
    sessionUpdate: {
      status: 'scheduled',
      checkInMode: targetMode,
      updatedAt: nowIso,
    },
    auditEntry: {
      id: auditId,
      action: 'reopen_session',
      performedBy: operatorUid,
      performedByEmail: operatorEmail,
      targetId: sessionId,
      details: `Reopened session ${sessionId} with checkInMode ${targetMode}`,
    },
  };
}
