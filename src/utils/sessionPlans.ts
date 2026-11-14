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

export interface SoftDeleteSessionPlan {
  sessionId: string;
  sessionUpdate: {
    status: SessionStatus;
    checkInMode: CheckInMode;
    cancelledAt: string;
    deletedAt: string;
    updatedAt: string;
  };
  auditEntry: {
    id: string;
    action: AuditAction;
    performedBy: string;
    performedByEmail?: string;
    targetId: string;
    targetName?: string;
    details: string;
  };
}

export function buildSoftDeleteSessionBatchPlan(
  sessionId: string,
  sessionTitle: string | undefined,
  operatorUid: string,
  operatorEmail?: string
): SoftDeleteSessionPlan {
  if (!operatorUid) {
    throw new Error('Authentication required to soft-delete a session.');
  }
  const nowIso = new Date().toISOString();
  const auditId = `audit_softdel_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
  const label = sessionTitle ? `"${sessionTitle}" (${sessionId})` : sessionId;
  return {
    sessionId,
    sessionUpdate: {
      status: 'cancelled',
      checkInMode: 'closed',
      cancelledAt: nowIso,
      deletedAt: nowIso,
      updatedAt: nowIso,
    },
    auditEntry: {
      id: auditId,
      action: 'delete_session',
      performedBy: operatorUid,
      performedByEmail: operatorEmail,
      targetId: sessionId,
      targetName: sessionTitle,
      details: `Soft-deleted and archived session ${label}`,
    },
  };
}

export type SessionCascadeOp =
  | { op: 'delete'; collection: 'checkIns' | 'announcements' | 'sessionTokens' | 'sessions'; docId: string }
  | {
      op: 'set_audit';
      collection: 'auditLogs';
      docId: string;
      data: {
        id: string;
        action: AuditAction;
        performedBy: string;
        performedByEmail?: string;
        targetId: string;
        targetName?: string;
        details: string;
      };
    };

export interface PermanentDeleteSessionPlan {
  chunks: SessionCascadeOp[][];
  totalOps: number;
  chunkCount: number;
  checkInsCount: number;
  announcementsCount: number;
}

/**
 * Pure cascade batch planner for permanent session deletion.
 * Partitions deletions across checkIns, announcements, sessionTokens/{id}, sessions/{id},
 * and the final auditLogs entry into WriteBatch chunks of <= maxBatchOps (default 400).
 */
export function buildPermanentDeleteSessionOpsPlan(params: {
  sessionId: string;
  sessionTitle?: string;
  checkInIds: string[];
  announcementIds: string[];
  includeSessionToken?: boolean;
  operatorUid: string;
  operatorEmail?: string;
  maxBatchOps?: number;
}): PermanentDeleteSessionPlan {
  const {
    sessionId,
    sessionTitle,
    checkInIds,
    announcementIds,
    includeSessionToken = true,
    operatorUid,
    operatorEmail,
    maxBatchOps = 400,
  } = params;

  if (!operatorUid) {
    throw new Error('Authentication required to permanently delete a session.');
  }

  const limitPerBatch = Math.max(2, Math.min(400, maxBatchOps));
  const ops: SessionCascadeOp[] = [];

  for (const cid of checkInIds) {
    ops.push({ op: 'delete', collection: 'checkIns', docId: cid });
  }
  for (const aid of announcementIds) {
    ops.push({ op: 'delete', collection: 'announcements', docId: aid });
  }
  if (includeSessionToken) {
    ops.push({ op: 'delete', collection: 'sessionTokens', docId: sessionId });
  }

  ops.push({ op: 'delete', collection: 'sessions', docId: sessionId });

  const auditId = `audit_permdel_${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
  const label = sessionTitle ? `"${sessionTitle}" (${sessionId})` : sessionId;
  ops.push({
    op: 'set_audit',
    collection: 'auditLogs',
    docId: auditId,
    data: {
      id: auditId,
      action: 'delete_session',
      performedBy: operatorUid,
      performedByEmail: operatorEmail,
      targetId: sessionId,
      targetName: sessionTitle,
      details: `Permanently deleted session ${label} with ${checkInIds.length} check-in(s), ${announcementIds.length} announcement(s), and kiosk token.`,
    },
  });

  const chunks: SessionCascadeOp[][] = [];
  for (let i = 0; i < ops.length; i += limitPerBatch) {
    chunks.push(ops.slice(i, i + limitPerBatch));
  }

  return {
    chunks,
    totalOps: ops.length,
    chunkCount: chunks.length,
    checkInsCount: checkInIds.length,
    announcementsCount: announcementIds.length,
  };
}

export interface DeleteCheckInBatchPlan {
  checkInId: string;
  reason: string;
  auditEntry: {
    id: string;
    action: AuditAction;
    performedBy: string;
    performedByEmail?: string;
    targetId: string;
    details: string;
    metadata: { reason: string };
  };
}

export function buildDeleteCheckInBatchPlan(params: {
  checkInId: string;
  reason: string;
  operatorUid: string;
  operatorEmail?: string;
}): DeleteCheckInBatchPlan {
  const { checkInId, reason, operatorUid, operatorEmail } = params;
  if (!operatorUid) {
    throw new Error('Authentication required to delete an attendance record.');
  }
  const cleanReason = (reason || '').trim();
  if (!cleanReason) {
    throw new Error('A reason is required to delete an attendance check-in record.');
  }
  if (cleanReason.length > 300) {
    throw new Error('Deletion reason cannot exceed 300 characters.');
  }

  const auditId = `audit_delci_${checkInId.replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`;
  return {
    checkInId,
    reason: cleanReason,
    auditEntry: {
      id: auditId,
      action: 'delete_check_in',
      performedBy: operatorUid,
      performedByEmail: operatorEmail,
      targetId: checkInId,
      details: `Deleted check-in record ${checkInId}. Reason: ${cleanReason}`,
      metadata: { reason: cleanReason },
    },
  };
}

