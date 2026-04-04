import { AdmissionRoundConfig } from './shared/queueShared';

export interface QueueStateDoc {
  roundId: string;
  roundLabel: string;
  currentNumber: number;
  lastAssignedNumber: number;
  lastAdvancedAt: number;
  activeReservationCount: number;
  pendingAdmissionCount: number;
  maxActiveSessions: number;
  confirmedCount: number;
  waitlistedCount: number;
  totalCapacity: number;
  availableCapacity: number;
  updatedAt: number;
  queueEnabled: boolean;
}

export interface QueueLiveMetrics {
  activeReservationCount: number;
  pendingAdmissionCount: number;
  confirmedCount: number;
  waitlistedCount: number;
  availableCapacity: number;
}

interface QueueStateContext {
  totalCapacity: number;
  maxActiveSessions: number;
  queueEnabled: boolean;
  now?: number;
}

export function buildQueueStateDoc(
  round: AdmissionRoundConfig,
  context: QueueStateContext,
  existing?: Partial<QueueStateDoc> | null
): QueueStateDoc {
  const pendingAdmissionCount = Number(existing?.pendingAdmissionCount ?? 0);
  const confirmedCount = Number(existing?.confirmedCount ?? 0);
  const waitlistedCount = Number(existing?.waitlistedCount ?? 0);
  const activeReservationCount = Number(existing?.activeReservationCount ?? 0);
  const currentNumber = Number(existing?.currentNumber ?? 0);
  const lastAssignedNumber = Number(existing?.lastAssignedNumber ?? 0);
  const lastAdvancedAt = Number(existing?.lastAdvancedAt ?? 0);
  const updatedAt = Number(existing?.updatedAt ?? context.now ?? Date.now());

  return {
    roundId: round.id,
    roundLabel: round.label,
    currentNumber,
    lastAssignedNumber,
    lastAdvancedAt,
    activeReservationCount,
    pendingAdmissionCount,
    maxActiveSessions: context.maxActiveSessions,
    confirmedCount,
    waitlistedCount,
    totalCapacity: context.totalCapacity,
    availableCapacity: Math.max(
      0,
      context.totalCapacity - confirmedCount - waitlistedCount - activeReservationCount
    ),
    updatedAt,
    queueEnabled: context.queueEnabled
  };
}

export function getAvailableWriterSlots(queueState: QueueStateDoc) {
  return Math.max(0, queueState.maxActiveSessions - queueState.activeReservationCount);
}

export function getQueueAdvanceAmount(queueState: QueueStateDoc, limit = Number.MAX_SAFE_INTEGER) {
  const waitingCount = Math.max(0, queueState.lastAssignedNumber - queueState.currentNumber);
  const admissionHeadroom = Math.max(
    0,
    queueState.maxActiveSessions - queueState.activeReservationCount - queueState.pendingAdmissionCount
  );

  return Math.max(0, Math.min(waitingCount, queueState.availableCapacity, admissionHeadroom, limit));
}

export function getAdvanceLimitFromCounts(
  queueState: QueueStateDoc,
  counts: QueueLiveMetrics,
  limit = Number.MAX_SAFE_INTEGER
) {
  const admissionHeadroom = Math.max(
    0,
    queueState.maxActiveSessions - counts.activeReservationCount - counts.pendingAdmissionCount
  );

  return Math.max(0, Math.min(counts.availableCapacity, admissionHeadroom, limit));
}
