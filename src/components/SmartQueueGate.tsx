import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FirebaseError } from 'firebase/app';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock3, ShieldCheck, Ticket, Users, X } from 'lucide-react';
import { useQueueChallenge } from '../hooks/useQueueChallenge';
import QueueChallengeModal from './QueueChallengeModal';
import { auth, db, functions } from '../firebase/config';
import { useSchool } from '../contexts/SchoolContext';
import {
  clearRecentQueueExpiry,
  getRecentQueueCompletion,
  getRecentQueueExpiry,
  getQueueUserId,
  isSameQueueIdentity,
  loadStoredQueueIdentity,
  markRecentQueueExpiry,
  normalizeQueuePhone,
  QueueIdentityInput,
  saveStoredQueueIdentity
} from '../lib/queue';
import { callCallableWithRetry } from '../lib/callable';
import { createRequestId } from '../lib/requestId';
import { getCurrentAdmissionRound, getAdmissionRoundTotal, normalizeAdmissionRounds } from '../lib/admissionRounds';

interface QueueState {
  currentNumber: number;
  lastAssignedNumber: number;
  activeReservationCount: number;
  maxActiveSessions: number;
  confirmedCount: number;
  waitlistedCount: number;
  totalCapacity: number;
  availableCapacity: number;
  updatedAt: number;
}

interface QueueEntry {
  roundId?: string;
  roundLabel?: string;
  number: number | null;
  status: 'waiting' | 'eligible' | 'consumed' | 'expired';
  activeReservationId?: string | null;
}

interface JoinQueueResponse {
  number?: number | null;
  status?: QueueEntry['status'] | 'direct';
}

interface StartRegistrationResponse {
  success?: boolean;
  sessionId?: string;
  expiresAt?: number;
}

type JoinClosureState = {
  reason?: string;
  message?: string;
};

type CallableErrorDetails = {
  reason?: string;
  isFull?: boolean;
  message?: string;
  roundId?: string;
  queueJoinLimit?: number;
};

function formatDateLabel(openTimeMs: number) {
  if (!openTimeMs) return '추후 공지';

  return new Date(openTimeMs).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function getCountdownParts(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    { label: '일', value: String(days).padStart(2, '0') },
    { label: '시간', value: String(hours).padStart(2, '0') },
    { label: '분', value: String(minutes).padStart(2, '0') },
    { label: '초', value: String(seconds).padStart(2, '0') }
  ];
}

const RECENT_EXPIRY_SUPPRESSION_MS = 15 * 1000;
const JOIN_RETRY_COOLDOWN_MS = 7 * 1000;
const AUTO_ENTRY_TIMEOUT_MS = 15000;

function getCallableErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
    return (error as { code: string }).code;
  }

  return '';
}

function getCallableErrorDetails(error: unknown): CallableErrorDetails | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const directDetails = 'details' in error ? (error as { details?: unknown }).details : undefined;
  if (directDetails && typeof directDetails === 'object') {
    return directDetails as CallableErrorDetails;
  }

  const customData = 'customData' in error ? (error as { customData?: unknown }).customData : undefined;
  if (customData && typeof customData === 'object' && 'details' in customData) {
    const nestedDetails = (customData as { details?: unknown }).details;
    if (nestedDetails && typeof nestedDetails === 'object') {
      return nestedDetails as CallableErrorDetails;
    }
  }

  return null;
}

function getCallableErrorMessage(error: unknown, fallback: string) {
  const details = getCallableErrorDetails(error);
  if (details?.message) {
    return details.message;
  }

  if (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }

  return fallback;
}

function shouldApplyJoinCooldown(error: unknown) {
  const code = getCallableErrorCode(error);
  const message = getCallableErrorMessage(error, '');
  const details = getCallableErrorDetails(error);

  if (code === 'functions/already-exists' || code === 'functions/invalid-argument' || code === 'functions/failed-precondition') {
    return false;
  }

  if (details?.reason === 'QUEUE_CLOSED' || details?.reason === 'CAPACITY_FULL' || details?.isFull) {
    return false;
  }

  if (message.includes('이미 진행 중인 대기열') || message.includes('이미 신청이 접수') || message.includes('이름을 입력') || message.includes('휴대폰 번호')) {
    return false;
  }

  return true;
}

export default function SmartQueueGate() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const { schoolConfig } = useSchool();
  const navigate = useNavigate();

  const [queueState, setQueueState] = useState<QueueState>({
    currentNumber: 0,
    lastAssignedNumber: 0,
    activeReservationCount: 0,
    maxActiveSessions: 60,
    confirmedCount: 0,
    waitlistedCount: 0,
    totalCapacity: 0,
    availableCapacity: 0,
    updatedAt: 0
  });
  const [myEntry, setMyEntry] = useState<QueueEntry | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [joiningElapsed, setJoiningElapsed] = useState(0);
  const [starting, setStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [joinCooldownUntil, setJoinCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [autoEntering, setAutoEntering] = useState(false);
  const [showProgramImage, setShowProgramImage] = useState(false);
  const [selectedRoundId, setSelectedRoundId] = useState<string>('round1');
  const [queueIdentity, setQueueIdentity] = useState<QueueIdentityInput>({ studentName: '', phone: '' });
  const [identityHydrated, setIdentityHydrated] = useState(false);
  const [closedRounds, setClosedRounds] = useState<Record<string, JoinClosureState>>({});

  const autoStartedRef = useRef(false);
  const joinRequestIdRef = useRef<string | null>(null);
  const startRequestIdRef = useRef<string | null>(null);

  const queueEnabled = schoolConfig?.queueSettings?.enabled !== false;
  const rounds = normalizeAdmissionRounds(schoolConfig);
  const baseCurrentRound = getCurrentAdmissionRound(schoolConfig, now);
  const currentRound = schoolConfig?.forceActiveRound
    ? (rounds.find((r) => r.id === schoolConfig.forceActiveRound) ?? baseCurrentRound)
    : baseCurrentRound;
  const selectedRound = rounds.find((round) => round.id === selectedRoundId) || currentRound || rounds[0];
  const maxActiveSessions = schoolConfig?.queueSettings?.maxActiveSessions || queueState.maxActiveSessions || 60;
  const regularCapacity = selectedRound?.maxCapacity || schoolConfig?.maxCapacity || 0;
  const waitlistCapacity = selectedRound?.waitlistCapacity || schoolConfig?.waitlistCapacity || 0;
  const totalCapacity = regularCapacity + waitlistCapacity;
  const openTimeMs = selectedRound?.openDateTime ? new Date(selectedRound.openDateTime).getTime() : 0;
  const isOpen = !!openTimeMs && now >= openTimeMs;
  const openDateLabel = formatDateLabel(openTimeMs);
  const countdownParts = getCountdownParts(Math.max(0, openTimeMs - now));
  const gateHeadline = schoolConfig?.heroMessage?.trim() || '오픈 시간에 버튼을 눌러 대기번호를 받고, 순서가 되면 신청서를 작성합니다.';
  const programInfo =
    schoolConfig?.programInfo?.trim() ||
    '행사 개요, 준비물, 유의사항은 아래 프로그램 안내 영역에서 바로 확인하실 수 있습니다.';

  const normalizedQueuePhone = normalizeQueuePhone(queueIdentity.phone);
  const queueIdentityReady = queueIdentity.studentName.trim().length > 0 && /^010\d{8}$/.test(normalizedQueuePhone);
  const joinCooldownSeconds = Math.max(0, Math.ceil((joinCooldownUntil - now) / 1000));
  const joinCooldownActive = joinCooldownSeconds > 0;
  const recentExpiryAt = schoolId ? getRecentQueueExpiry(schoolId) : 0;
  const suppressAutoEntry = !!recentExpiryAt && now - recentExpiryAt < RECENT_EXPIRY_SUPPRESSION_MS;
  const recentCompletion = schoolId ? getRecentQueueCompletion(schoolId) : null;
  const recentCompletionMatchesIdentity = isSameQueueIdentity(recentCompletion, {
    studentName: queueIdentity.studentName,
    phone: normalizedQueuePhone
  });
  const suppressCompletedAutoEntry = recentCompletionMatchesIdentity && !!recentCompletion;
  const friendlyErrorMessage = useMemo(() => {
    if (!errorMessage) return null;
    if (errorMessage.includes('조회 페이지에서 결과를 확인')) {
      return '입력하신 이름 또는 전화번호로 이미 신청이 완료되어 있습니다. 상단의 조회 메뉴에서 결과를 확인해 주세요.';
    }
    if (
      errorMessage.includes('이미 진행 중인 대기열')
      || errorMessage.includes('이미 요청이 접수')
      || errorMessage.includes('이미 신청이 접수')
      || errorMessage.includes('이미 같은 휴대폰 번호')
    ) {
      return errorMessage;
    }
    if (errorMessage.includes('schoolId') || errorMessage.includes('대기번호') || errorMessage.includes('이름')) {
      return errorMessage;
    }
    if (errorMessage.includes('FULL_CAPACITY')) {
      return '모집 정원과 예비 정원이 모두 마감되었습니다.';
    }
    if (errorMessage.includes('운영 상한') || errorMessage.includes('정원이 없습니다') || errorMessage.includes('이용 가능한 접수 인원이 없습니다')) {
      return '현재 대기열이 마감되었습니다.';
    }
    if (errorMessage.includes('요청이 너무 빈번') || errorMessage.includes('초 후에 다시 시도')) {
      return errorMessage;
    }

    return '접속이 많아 처리가 지연되고 있습니다. 잠시 후 다시 시도해 주세요.';
  }, [errorMessage]);

  useEffect(() => {
    if (!joining) {
      setJoiningElapsed(0);
      return;
    }
    const start = Date.now();
    const timer = setInterval(() => setJoiningElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [joining]);

  useEffect(() => {
    if (currentRound?.id) {
      setSelectedRoundId((prev) => {
        if (!prev || !rounds.some((round) => round.id === prev)) {
          return currentRound.id;
        }
        if (!myEntry && prev === 'round1' && currentRound.id === 'round2') {
          return currentRound.id;
        }
        return prev;
      });
    }
  }, [currentRound?.id, myEntry, rounds]);

  useEffect(() => {
    setClosedRounds({});
  }, [schoolId]);

  useEffect(() => {
    if (!schoolId || !selectedRound?.id) {
      return;
    }

    const storedIdentity = loadStoredQueueIdentity(schoolId, selectedRound.id);
    if (storedIdentity) {
      setQueueIdentity(storedIdentity);
    }
    setIdentityHydrated(true);
  }, [schoolId, selectedRound?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUserId(user?.uid ?? null);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // 기존 세션이 있는 경우(재방문자)에만 즉시 UID를 설정한다.
    // 신규 방문자는 signInAnonymously를 페이지 로드 시 호출하지 않고,
    // 대기열 진입 버튼을 눌렀을 때(ensureQueueUserId)에만 생성한다.
    if (auth.currentUser?.uid) {
      setUserId(auth.currentUser.uid);
    }
  }, [queueEnabled]);

  useEffect(() => {
    if (!schoolId) return;

    const queueStateDocId = selectedRound?.id || 'round1';
    const unsubscribe = onSnapshot(
      doc(db, 'schools', schoolId, 'queueState', queueStateDocId),
      (snapshot) => {
        const data = snapshot.data();
        setQueueState({
          currentNumber: data?.currentNumber || 0,
          lastAssignedNumber: data?.lastAssignedNumber || 0,
          activeReservationCount: data?.activeReservationCount || 0,
          maxActiveSessions: data?.maxActiveSessions || 60,
          confirmedCount: data?.confirmedCount || 0,
          waitlistedCount: data?.waitlistedCount || 0,
          totalCapacity: data?.totalCapacity || totalCapacity,
          availableCapacity: data?.availableCapacity ?? totalCapacity,
          updatedAt: data?.updatedAt || 0
        });
        setLoading(false);
      },
      () => {
        setErrorMessage('대기열 상태를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [schoolId, totalCapacity, selectedRound?.id]);

  useEffect(() => {
    if (!schoolId || !userId) return;

    const unsubscribe = onSnapshot(
      doc(db, 'schools', schoolId, 'queueEntries', userId),
      (snapshot) => {
        const data = snapshot.data();
        setMyEntry(
          data
            && (!selectedRound?.id || data.roundId === selectedRound.id)
            ? {
                roundId: data.roundId,
                roundLabel: data.roundLabel ?? null,
                number: data.number ?? null,
                status: data.status,
                activeReservationId: data.activeReservationId ?? null
              }
            : null
        );
      },
      () => {
        setErrorMessage('내 대기열 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    );

    return () => unsubscribe();
  }, [schoolId, userId, selectedRound?.id]);

  const myNumber = myEntry?.number ?? null;
  const canEnter = myEntry?.status === 'eligible' && myNumber !== null && !suppressCompletedAutoEntry;
  const waitingAhead = myEntry?.status === 'eligible'
    ? 0
    : myNumber
      ? Math.max(0, myNumber - queueState.currentNumber - 1)
      : 0;
  const isNearTurnWaiting = myEntry?.status === 'waiting' && myNumber !== null && waitingAhead === 0;
  const hasActiveQueueEntry = myEntry?.status === 'waiting' || myEntry?.status === 'eligible';
  const showLookupButton = !!schoolConfig?.buttonSettings?.showLookupButton && !hasActiveQueueEntry;
  const estimatedWaitMinutes =
    waitingAhead > 0 ? Math.max(1, Math.ceil((waitingAhead / Math.max(maxActiveSessions, 1)) * 3)) : 0;
  const remainingRegular = Math.max(0, regularCapacity - Math.min(queueState.confirmedCount, regularCapacity));
  const remainingWaitlist = Math.max(0, waitlistCapacity - Math.min(queueState.waitlistedCount, waitlistCapacity));
  const completedCount = queueState.confirmedCount + queueState.waitlistedCount;
  const waitingCount = Math.max(0, queueState.lastAssignedNumber - queueState.currentNumber);
  const remainingCapacity = Math.max(0, queueState.totalCapacity - completedCount);
  const queueJoinLimit = Math.max(1, getAdmissionRoundTotal(selectedRound));
  const closedRoundState = selectedRound?.id ? closedRounds[selectedRound.id] : undefined;
  const queueLimitReached = !myEntry && (
    Boolean(closedRoundState?.reason) ||
    queueState.lastAssignedNumber >= queueJoinLimit
  );
  const selectedRoundStatusLabel = !isOpen
    ? '오픈 전'
    : remainingCapacity <= 0 || queueLimitReached
      ? '접수 마감'
      : '접수 진행 중';
  const waitingDisplayValue = myNumber === null ? '-' : waitingAhead.toLocaleString();
  const waitingDisplayHelper =
    myNumber === null
      ? '대기열에 진입하면 여기에 표시됩니다.'
      : waitingAhead > 0
        ? `예상 대기 시간 약 ${estimatedWaitMinutes}분입니다.`
        : canEnter
          ? '지금 바로 입장할 수 있습니다.'
          : '순차를 확인하고 있습니다.';
  const joinDisabledReason =
    !myEntry || myEntry.status === 'expired'
      ? !isOpen
        ? `접수는 ${openDateLabel}에 시작됩니다. 오픈 시간 이후 다시 확인해 주세요.`
        : remainingCapacity <= 0
          ? '현재 신청 가능한 인원이 모두 마감되어 더 이상 대기열에 진입할 수 없습니다.'
          : queueLimitReached
            ? `대기열 접수는 ${queueJoinLimit.toLocaleString()}번에서 마감되었습니다. 이미 번호를 받은 분들만 계속 진행할 수 있습니다.`
            : null
      : null;
  const buttonStatusMessage = canEnter
    ? '지금 바로 신청서를 작성할 수 있습니다. 3분 안에 작성과 제출을 완료해 주세요.'
    : suppressCompletedAutoEntry
      ? recentCompletion?.status === 'waitlisted'
        ? '이전 차수에서 이미 예비 접수가 완료되어 다른 차수에 지원할 수 없습니다. 상단의 조회 메뉴에서 결과를 확인해 주세요.'
        : '이전 차수에서 이미 신청이 완료되어 다른 차수에 지원할 수 없습니다. 상단의 조회 메뉴에서 결과를 확인해 주세요.'
    : isNearTurnWaiting
      ? '곧 신청서로 이동됩니다. 이 화면을 유지해 주세요.'
    : myEntry?.status === 'expired'
      ? '작성 가능 시간이 만료되었습니다. 다시 신청하려면 대기열에 다시 입장해 번호를 받아야 합니다.'
      : joinCooldownActive
        ? `요청을 다시 준비 중입니다. ${joinCooldownSeconds}초 후 다시 시도해 주세요.`
        : queueLimitReached
          ? `대기열 접수는 ${queueJoinLimit.toLocaleString()}번에서 마감되었습니다. 이미 번호를 받은 분들만 신청을 진행할 수 있습니다.`
          : joinDisabledReason || '아래 버튼을 눌러 대기열에 진입하고 순서에 따라 신청을 진행해 주세요.';
  const effectiveButtonStatusMessage =
    queueLimitReached && closedRoundState?.message
      ? closedRoundState.message
      : buttonStatusMessage;
  const primaryActionLabel = joining
    ? joiningElapsed >= 10
      ? `접속 인원이 많아 순차적으로 확인 중입니다 (${joiningElapsed}초)... 화면을 닫지 마세요`
      : `${selectedRound?.label || ''} 대기열 진입 시도 중...`
    : joinCooldownActive
      ? `${joinCooldownSeconds}초 후 다시 시도`
      : myEntry?.status === 'expired'
        ? `${selectedRound?.label || ''} 다시 입장하기`
        : `${selectedRound?.label || ''} 대기열 입장`;

  const shouldShowChallenge =
    schoolConfig?.queueSettings?.useEntryChallenge === true &&
    (!myEntry || myEntry.status === 'expired');

  const challenge = useQueueChallenge({ onSuccess: () => { void joinQueue(); } });

  useEffect(() => {
    if (!schoolId) return;

    // Keep the expiry marker during the suppression window so we don't auto-enter
    // a just-expired user back into the registration session.
    if (recentExpiryAt && !suppressAutoEntry) {
      clearRecentQueueExpiry(schoolId);
    }
  }, [recentExpiryAt, schoolId, suppressAutoEntry]);

  useEffect(() => {
    if (!suppressAutoEntry && myEntry?.status !== 'expired') {
      return;
    }

    autoStartedRef.current = false;
    setAutoEntering(false);
  }, [myEntry?.status, suppressAutoEntry]);

  useEffect(() => {
    if (!schoolId || !myEntry || (myEntry.status !== 'waiting' && myEntry.status !== 'eligible')) {
      return;
    }

    const heartbeatFn = httpsCallable(functions, 'heartbeatQueuePresence');
    let disposed = false;

    const sendHeartbeat = async () => {
      if (disposed || document.visibilityState === 'hidden') {
        return;
      }

      try {
        await heartbeatFn({ schoolId });
      } catch {
        // Presence heartbeat should not block the UI.
      }
    };

    void sendHeartbeat();
    const intervalId = window.setInterval(() => {
      void sendHeartbeat();
    }, 10000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void sendHeartbeat();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [myEntry, schoolId]);

  const myStatusMessage = useMemo(() => {
    if (!isOpen) {
      return `${selectedRound?.label || '선택한 차수'} 접수는 아직 시작되지 않았습니다. 위 시작 시각을 확인해 주세요.`;
    }

    if (myEntry?.status === 'expired') {
      return '작성 시간이 초과되었습니다. 다시 신청하려면 대기열에서 새 번호를 받아야 합니다.';
    }

    if (myNumber === null) {
      if (queueLimitReached) {
        return '대기열 접수 상한에 도달해 번호 발급이 마감되었습니다. 이미 번호를 받은 분들만 계속 진행합니다.';
      }
      if (remainingCapacity <= 0) {
        return '현재 모집 정원과 예비 정원이 모두 마감되었습니다.';
      }
      return '버튼을 누르면 대기열에 진입하며, 순서가 되면 신청서 작성이 가능합니다.';
    }

    if (canEnter) {
      return '지금 신청서를 작성할 수 있습니다. 제출 전 연락처와 이름을 다시 확인해 주세요.';
    }

    if (remainingCapacity <= 0) {
      return '죄송합니다. 앞 대기 인원 접수가 모두 마감되어 신청서를 작성하실 수 없습니다.';
    }

    if (queueState.availableCapacity <= 0) {
      return '신청서 작성 인원이 가득 찼습니다. 자리가 생기면 자동으로 입장됩니다.';
    }

    if (suppressCompletedAutoEntry) {
      return recentCompletion?.status === 'waitlisted'
        ? '이전 차수에서 이미 예비 접수가 완료되어 다른 차수에 지원할 수 없습니다. 상단의 조회 메뉴에서 결과를 확인해 주세요.'
        : '이전 차수에서 이미 신청이 완료되어 다른 차수에 지원할 수 없습니다. 상단의 조회 메뉴에서 결과를 확인해 주세요.';
    }

    if (waitingAhead === 0) {
      return '곧 입장 순서가 됩니다. 현재 화면을 유지해 주세요.';
    }

    return `내 앞에 ${waitingAhead}명이 대기 중이며, 예상 대기 시간은 약 ${estimatedWaitMinutes}분입니다.`;
  }, [canEnter, estimatedWaitMinutes, isOpen, myEntry?.status, myNumber, queueLimitReached, queueState.availableCapacity, recentCompletion?.status, remainingCapacity, selectedRound?.label, suppressCompletedAutoEntry, waitingAhead]);

  const ensureQueueUserId = useCallback(async () => {
    if (auth.currentUser?.uid) {
      setUserId(auth.currentUser.uid);
      return auth.currentUser.uid;
    }

    const nextUserId = await getQueueUserId();
    setUserId(nextUserId);
    return nextUserId;
  }, []);

  async function joinQueue() {
    if (!schoolId || joining || !isOpen || joinCooldownActive) return;
    if (!queueIdentityReady) {
      setErrorMessage('이름과 연락처를 정확히 입력한 후 대기열에 입장해 주세요.');
      return;
    }

    setJoining(true);
    setErrorMessage(null);
    const requestId = createRequestId('joinQueue');
    const targetRoundId = selectedRound?.id || 'round1';
    joinRequestIdRef.current = requestId;

    try {
      await ensureQueueUserId();
      const joinQueueFn = httpsCallable<
        {
          schoolId: string;
          roundId?: string;
          requestId: string;
          queueIdentity: {
            studentName: string;
            phone: string;
          };
        },
        JoinQueueResponse
      >(functions, 'joinQueue');
      const result = await callCallableWithRetry(
        joinQueueFn,
        {
          schoolId,
          roundId: selectedRound?.id,
          requestId,
          queueIdentity: {
            studentName: queueIdentity.studentName.trim(),
            phone: normalizedQueuePhone
          }
        },
        {
          maxAttempts: 5,
          getDelayMs: ({ attempt }) => 1200 + Math.floor(Math.random() * 1200) + (attempt - 1) * 2500
        }
      );

      if (result.data) {
        if (selectedRound?.id) {
          saveStoredQueueIdentity(schoolId, selectedRound.id, {
            studentName: queueIdentity.studentName.trim(),
            phone: normalizedQueuePhone
          });
        }
        setMyEntry((prev) => ({
          number: result.data.number ?? prev?.number ?? null,
          status: normalizeJoinStatus(result.data.status) ?? prev?.status ?? 'waiting',
          activeReservationId: prev?.activeReservationId ?? null
        }));
      }
      } catch (error: unknown) {
        const errorDetails = getCallableErrorDetails(error);
        joinRequestIdRef.current = null;
        if (
          targetRoundId &&
          (errorDetails?.reason === 'QUEUE_CLOSED' || errorDetails?.reason === 'CAPACITY_FULL' || errorDetails?.isFull)
        ) {
          setClosedRounds((prev) => ({
            ...prev,
            [targetRoundId]: {
              reason: errorDetails.reason,
              message: errorDetails.message || getCallableErrorMessage(error, '현재 접수가 마감되었습니다.')
            }
          }));
        }
        if (shouldApplyJoinCooldown(error)) {
          setJoinCooldownUntil(Date.now() + JOIN_RETRY_COOLDOWN_MS);
        } else {
          setJoinCooldownUntil(0);
        }
        setErrorMessage(getCallableErrorMessage(error, '대기열 입장에 실패했습니다. 잠시 후 다시 시도해 주세요.'));
      } finally {
      joinRequestIdRef.current = null;
      setJoining(false);
    }
  }

  const startRegistration = useCallback(async () => {
    if (!schoolId || starting || !isOpen) return;

    setStarting(true);
    setErrorMessage(null);
    if (!startRequestIdRef.current) {
      startRequestIdRef.current = createRequestId('startRegistration');
    }

    try {
      await ensureQueueUserId();
      const startFn = httpsCallable<
        { schoolId: string; roundId?: string; requestId: string | null },
        StartRegistrationResponse
      >(functions, 'startRegistrationSession');
      const result = await Promise.race([
        callCallableWithRetry(
          startFn,
          { schoolId, roundId: myEntry?.roundId || selectedRound?.id, requestId: startRequestIdRef.current },
          {
            maxAttempts: 4,
            getDelayMs: ({ attempt }) => 1000 + Math.floor(Math.random() * 1000) + (attempt - 1) * 2000
          }
        ),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => {
            const timeoutError = new Error('자동 입장이 지연되고 있습니다. 아래 버튼을 눌러 직접 다시 시도해 주세요.');
            (timeoutError as FirebaseError & { code?: string }).code = 'functions/deadline-exceeded';
            reject(timeoutError);
          }, AUTO_ENTRY_TIMEOUT_MS);
        })
      ]);

      if (!result.data?.success) {
        throw new Error('입장 세션을 생성하지 못했습니다.');
      }

      localStorage.setItem(`registrationSessionId_${schoolId}`, result.data.sessionId);
      localStorage.setItem(`registrationExpiresAt_${schoolId}`, String(result.data.expiresAt));
      window.location.assign(`/${schoolId}/register`);
    } catch (error: unknown) {
      startRequestIdRef.current = null;
      setAutoEntering(false);
      autoStartedRef.current = true;
      setErrorMessage(getCallableErrorMessage(error, '신청서 입장을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setStarting(false);
    }
  }, [ensureQueueUserId, isOpen, myEntry?.roundId, navigate, schoolId, selectedRound?.id, starting]);

  useEffect(() => {
    if (!identityHydrated || !canEnter || !isOpen || !schoolId || loading || autoStartedRef.current) return;
    if (suppressAutoEntry || suppressCompletedAutoEntry) return;

    autoStartedRef.current = true;
    setAutoEntering(true);

    const timer = window.setTimeout(() => {
      void startRegistration();
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [canEnter, identityHydrated, isOpen, loading, schoolId, suppressAutoEntry, suppressCompletedAutoEntry, startRegistration]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-snu-gray px-4">
        <div className="text-center">
          <div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-4 border-gray-200 border-t-snu-blue" />
          <p className="text-sm font-bold tracking-wider text-gray-500">잠시만 기다려 주세요...</p>
        </div>
      </div>
    );
  }

  if (autoEntering) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-snu-gray px-4">
        <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-xl">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">신청서 작성을 준비하고 있습니다</h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            순서가 되면 자동으로 신청서 작성 화면으로 이동합니다.
            <br />
            이동 후 3분 이내에 작성을 완료해 주세요.
          </p>
          {errorMessage && <p className="mt-4 text-sm font-semibold text-rose-600">{errorMessage}</p>}
          <button
            onClick={() => void startRegistration()}
            disabled={starting}
            className="mt-6 flex w-full items-center justify-center rounded-2xl bg-stone-950 px-6 py-4 text-base font-bold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
          >
            {starting ? '신청서로 이동 중...' : '직접 신청서로 이동'}
          </button>
        </div>
      </div>
    );
  }

  if (!queueEnabled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f7f3eb] px-4 py-10">
        <div className="w-full max-w-xl rounded-[2rem] border border-stone-200 bg-white p-8 shadow-xl">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-stone-100">
            <Ticket className="h-8 w-8 text-stone-700" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-stone-950">대기열 없이 바로 신청서를 작성합니다</h1>
          <p className="mt-3 text-base leading-relaxed text-stone-600">
            현재 신청 가능 인원이 남아 있어 바로 접속할 수 있습니다.
          </p>
          <button
            onClick={() => void startRegistration()}
            disabled={!isOpen || starting}
            className="mt-6 flex w-full items-center justify-center rounded-2xl bg-stone-950 px-6 py-4 text-base font-bold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
          >
            {starting ? '신청서로 이동 중...' : isOpen ? '바로 신청하기' : '오픈 대기 중'}
          </button>
          <p className="mt-4 text-sm text-stone-500">오픈 시각(KST): {openDateLabel}</p>
          {errorMessage && <p className="mt-4 text-sm font-semibold text-rose-600">{errorMessage}</p>}
        </div>
      </div>
    );
  }

  const emergencyBannerActive = !!(schoolConfig?.emergencyNotice?.enabled && schoolConfig.emergencyNotice.message);

  return (
    <>
      {emergencyBannerActive && (
        <div className="fixed inset-x-0 top-0 z-50 bg-red-600 px-4 py-2.5 text-center text-sm font-bold text-white shadow-md">
          ⚠️ {schoolConfig!.emergencyNotice!.message}
        </div>
      )}
      <div className={`min-h-screen bg-snu-gray px-4 py-6 pb-28 text-snu-text sm:px-6 sm:py-8 sm:pb-8${emergencyBannerActive ? ' pt-12' : ''}`}>
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-md">
          <div className="bg-snu-blue px-6 py-8 text-white sm:px-8">
            <div className="grid items-stretch gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)] lg:gap-6">
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-4">
                  {schoolConfig?.logoUrl ? (
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-white/15 bg-white/95 p-2 shadow-lg">
                      <img
                        src={schoolConfig.logoUrl}
                        alt={`${schoolConfig?.name || '행사'} 로고`}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/70">행사 안내</p>
                    <h1 className="mt-2 text-2xl font-bold leading-tight sm:text-4xl">{schoolConfig?.name || "행사 신청 시스템"}</h1>
                    <p className="mt-2 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-white/85 sm:text-base">
                      {gateHeadline}
                    </p>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {rounds.map((round) => {
                    const roundOpenTime = round.openDateTime ? new Date(round.openDateTime).getTime() : 0;
                    const roundIsOpen = !!roundOpenTime && now >= roundOpenTime;
                    const isSelected = selectedRound?.id === round.id;
                    return (
                      <button
                        key={round.id}
                        type="button"
                        onClick={() => setSelectedRoundId(round.id)}
                        className={`min-h-[128px] rounded-2xl border px-4 py-3.5 text-left transition sm:min-h-[154px] sm:py-4 ${
                          isSelected
                            ? round.id === 'round1'
                              ? 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8] shadow-lg'
                              : 'border-[#fecdd3] bg-[#fff1f2] text-[#be123c] shadow-lg'
                            : round.id === 'round1'
                              ? 'border-[#93c5fd]/40 bg-[#1d4ed8]/15 text-white hover:bg-[#1d4ed8]/25'
                              : 'border-[#fda4af]/40 bg-[#be123c]/15 text-white hover:bg-[#be123c]/25'
                        }`}
                      >
                        <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${isSelected ? 'text-snu-blue/70' : 'text-white/60'}`}>{round.label}</p>
                        <p className="mt-2 text-sm font-bold leading-snug sm:text-base">{formatDateLabel(roundOpenTime)}</p>
                        <p className={`mt-2 text-[11px] leading-relaxed sm:mt-3 sm:text-xs ${isSelected ? 'text-snu-blue/70' : 'text-white/75'}`}>
                          {isSelected
                            ? (roundIsOpen
                                ? (remainingCapacity <= 0 || queueLimitReached ? '마감되었습니다' : '대기열 입장 가능합니다')
                                : `오픈까지 ${formatCountdown(Math.max(0, roundOpenTime - now))}`)
                            : (roundIsOpen ? '현재 접수 중입니다. 클릭하여 확인하세요.' : `오픈까지 ${formatCountdown(Math.max(0, roundOpenTime - now))}`)}
                        </p>
                        <p className={`mt-2 text-[11px] font-semibold sm:mt-3 ${isSelected ? 'text-snu-blue/80' : 'text-white/70'}`}>
                          {isSelected ? selectedRoundStatusLabel : (roundIsOpen ? '진행 중' : '대기 중')}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-sm sm:p-6">
                <p className="text-xl font-bold leading-tight sm:text-3xl">
                  {remainingCapacity <= 0 || queueLimitReached ? `${selectedRound?.label || "선택 차수"} 마감` : isOpen ? `${selectedRound?.label || "선택 차수"} 신청 접수 진행 중` : `${selectedRound?.label || "선택 차수"} 오픈 대기`}
                </p>
                <p className="mt-2 text-sm text-white/80">{openDateLabel}</p>
                <div className="mt-5 rounded-2xl border border-white/15 bg-black/10 p-4">

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {countdownParts.map((part) => (
                      <div key={part.label} className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3 text-center sm:py-4">
                        <p className="text-xl font-bold tracking-[0.08em] text-white sm:text-3xl">{part.value}</p>
                        <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-white/60">{part.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 bg-gray-50 p-4 sm:gap-4 sm:p-6 xl:grid-cols-4">
            <MetricCard
              icon={<Users className="h-5 w-5" />}
              label='발급된 번호'
              value={queueState.lastAssignedNumber}
              helper={`선착순 ${queueJoinLimit.toLocaleString()}번까지 발급`}
            />
            <MetricCard
              icon={<Ticket className="h-5 w-5" />}
              label='현재 호출 번호'
              value={queueState.currentNumber}
              helper='신청서 작성이 열린 번호'
            />
            <MetricCard
              icon={<Clock3 className="h-5 w-5" />}
              label='작성 중'
              value={queueState.activeReservationCount}
              helper='현재 신청서 작성 인원'
            />
            <MetricCard
              icon={<CheckCircle2 className="h-5 w-5" />}
              label='제출 완료'
              value={completedCount}
              helper='작성 완료된 신청'
            />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            {suppressCompletedAutoEntry ? (
              <div className="flex flex-col items-center py-4 text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-50">
                  <CheckCircle2 className="h-7 w-7 text-green-600" />
                </div>
                <h3 className="mb-2 text-lg font-bold text-gray-900">신청이 완료되었습니다</h3>
                <p className="mb-6 text-sm leading-relaxed text-gray-500">{effectiveButtonStatusMessage}</p>
                <Link
                  to={`/${schoolId}/lookup`}
                  className="flex min-h-[52px] w-full items-center justify-center rounded-2xl bg-snu-blue px-5 py-4 text-base font-bold text-white transition hover:bg-snu-dark"
                >
                  신청 내역 조회하기
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-snu-blue/10 bg-snu-blue/[0.03] p-5">
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">MY STATUS</p>
                    <p className="mt-3 text-4xl font-bold tracking-tight text-snu-blue sm:text-5xl">{myNumber ?? '--'}</p>
                    <p className="mt-2 text-xs text-gray-500">내 대기번호</p>
                  </div>
                  <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 text-right">
                    <p className="text-xs font-bold uppercase tracking-[0.1em] text-gray-400">WAITING</p>
                    <p className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">{waitingDisplayValue}</p>
                    <p className="mt-2 text-xs text-gray-500">{waitingDisplayHelper}</p>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-gray-100 bg-white p-4 text-sm leading-relaxed text-gray-600">
                  {myStatusMessage}
                </div>
                {myNumber !== null && remainingCapacity <= 0 && !canEnter && (
                  <Link
                    to={`/${schoolId}`}
                    className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-4 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                  >
                    메인으로 이동 <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                )}
              </>
            )}

            {!myEntry || myEntry.status === 'expired' ? (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                {shouldShowChallenge && (
                  <div className="mb-4 overflow-hidden rounded-xl border border-amber-300 bg-amber-50">
                    <div className="flex items-center gap-2 bg-amber-500 px-4 py-2.5">
                      <ShieldCheck className="h-4 w-4 shrink-0 text-white" />
                      <p className="text-xs font-black uppercase tracking-widest text-white">자동 매크로 방지</p>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-sm font-bold text-amber-900">
                        “대기열 입장” 버튼을 누르면 <span className="underline decoration-amber-500 decoration-2">4자리 숫자 입력 화면</span>이 나타납니다.
                      </p>
                      <p className="mt-1.5 text-sm leading-relaxed text-amber-800">
                        화면에 표시된 숫자를 직접 입력한 순서대로 대기번호가 부여됩니다.
                        당황하지 마시고 숫자를 확인 후 차분히 입력해 주세요.
                      </p>
                    </div>
                  </div>
                )}
                <p className="text-sm font-bold text-gray-900">입장 확인 정보</p>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">
                  같은 이름과 휴대폰 번호로는 대기번호를 하나만 받을 수 있습니다.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <input
                    value={queueIdentity.studentName}
                    onChange={(event) => setQueueIdentity((prev) => ({ ...prev, studentName: event.target.value }))}
                    placeholder='이름'
                    className="min-h-[52px] rounded-2xl border border-gray-200 bg-white px-4 text-base text-gray-900 outline-none transition focus:border-snu-blue focus:ring-2 focus:ring-snu-blue/10"
                  />
                  <input
                    value={queueIdentity.phone}
                    onChange={(event) => setQueueIdentity((prev) => ({ ...prev, phone: normalizeQueuePhone(event.target.value) }))}
                    inputMode="numeric"
                    placeholder='휴대폰 번호 (01012345678)'
                    className="min-h-[52px] rounded-2xl border border-gray-200 bg-white px-4 text-base text-gray-900 outline-none transition focus:border-snu-blue focus:ring-2 focus:ring-snu-blue/10"
                  />
                </div>
              </div>
            ) : null}

            <div className="mt-6 grid gap-3">
              {!myEntry || myEntry.status === 'expired' ? (
                <button
                  onClick={() => { if (shouldShowChallenge) { challenge.openChallenge(); } else { void joinQueue(); } }}
                  disabled={!isOpen || joining || joinCooldownActive || remainingCapacity <= 0 || queueLimitReached || !queueIdentityReady}
                  className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-snu-blue px-5 py-4 text-base font-bold text-white transition hover:bg-snu-dark disabled:cursor-not-allowed disabled:bg-gray-300 sm:min-h-[60px]"
                >
                  {primaryActionLabel}
                  {!joining && <ArrowRight className="ml-2 h-5 w-5" />}
                </button>
              ) : isNearTurnWaiting ? null : suppressCompletedAutoEntry ? null : canEnter ? (
                <button
                  onClick={() => void startRegistration()}
                  disabled={starting}
                  className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-emerald-600 px-5 py-4 text-base font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300 sm:min-h-[60px]"
                >
                  {starting ? '신청 페이지 준비 중...' : '지금 신청하기'}
                  {!starting && <ArrowRight className="ml-2 h-5 w-5" />}
                </button>
              ) : (
                <button disabled className="min-h-[56px] w-full rounded-2xl border border-gray-200 bg-gray-100 px-5 py-4 text-sm font-bold text-gray-500 sm:min-h-[60px]">
                  대기 순서에 따라 자동으로 입장 기회가 열립니다
                </button>
              )}

              {showLookupButton && !isNearTurnWaiting && (
                <Link
                  to={`/${schoolId}/lookup`}
                  className="flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-gray-300 bg-white px-5 py-4 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                >
                  신청 내역 조회
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              )}
            </div>

            {!suppressCompletedAutoEntry && (
              <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm leading-relaxed text-gray-600">
                <p>{effectiveButtonStatusMessage}</p>
              </div>
            )}

            {!suppressCompletedAutoEntry && (
            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-sm font-bold text-gray-900">이용 안내</p>
              <div className="mt-3 space-y-2 text-sm leading-relaxed text-gray-600">
                <p>접수는 {openDateLabel}에 시작됩니다.</p>
                <p>오픈 시간에 버튼을 누르면 대기열 진입을 시도합니다.</p>
                <p>대기열은 정규 {regularCapacity.toLocaleString()}명 + 예비 {waitlistCapacity.toLocaleString()}명, 총 정원({queueJoinLimit.toLocaleString()}명) 기준으로만 운영됩니다.</p>
                <p className="font-semibold text-gray-800">⚠️ 번호를 받은 후 반드시 이 화면을 유지해 주세요. 화면을 닫으면 번호가 소멸됩니다.</p>
                <p>1차에서 접수하지 못한 경우, 이탈자 발생 시 2차 예비번호 순서로 확정될 수 있습니다.</p>
              </div>
            </div>
            )}

            <section className="mt-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">프로그램 안내</h2>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-gray-600">{programInfo}</p>
              {schoolConfig?.programImageUrl && (
                <button
                  onClick={() => setShowProgramImage(true)}
                  className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-gray-300 bg-white px-4 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50 sm:min-h-[56px] sm:px-5 sm:text-base"
                >
                  프로그램 이미지 보기
                </button>
              )}
            </section>

            {friendlyErrorMessage && (
              friendlyErrorMessage.includes('마감') ? (
                <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-semibold text-gray-600">{friendlyErrorMessage}</p>
                  <Link
                    to={`/${schoolId}`}
                    className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-4 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                  >
                    메인으로 이동 <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </div>
              ) : (
                <p className={`mt-4 text-sm font-semibold ${
                  friendlyErrorMessage.includes('다시 시도') ? 'text-amber-600' : 'text-rose-600'
                }`}>{friendlyErrorMessage}</p>
              )
            )}
          </section>

          <div className="space-y-6">
            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">운영 현황</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <InfoTile label='현재 대기 인원' value={waitingCount} helper='번호를 받았지만 아직 작성 중이 아닌 인원' />
                <InfoTile label='남은 확정 접수' value={remainingRegular} helper='확정으로 접수 가능한 잔여 인원' />
                <InfoTile label='남은 예비 접수' value={remainingWaitlist} helper='예비로 접수 가능한 잔여 인원' />
                <InfoTile label='작성 중 / 기준' value={`${queueState.activeReservationCount} / ${maxActiveSessions}`} helper='동시에 작성 가능한 인원 기준' />
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">진행 흐름</h2>
              <div className="mt-4 space-y-3">
                <FlowCard
                  tone="indigo"
                  step="1"
                  title="매크로 방지 확인 후 대기열 입장"
                  body={`오픈 시각에 버튼을 누르면 4자리 숫자 입력 화면이 표시됩니다. 숫자를 입력한 순서대로 대기번호가 부여되며, 대기열은 정원(${queueState.totalCapacity.toLocaleString()}명)에 맞게만 운영됩니다.`}
                />
                <FlowCard
                  tone="amber"
                  step="2"
                  title="순차 입장 — 화면 유지 필수"
                  body={`동시에 최대 ${maxActiveSessions}명이 작성할 수 있습니다. 자리가 생겨야 다음 순번의 입장이 열립니다. 번호를 받은 후 반드시 이 화면을 유지해 주세요.`}
                />
                <FlowCard
                  tone="emerald"
                  step="3"
                  title="3분 이내 제출"
                  body="입장 후 3분 이내에 제출하셔야 합니다. 시간이 지나면 기회가 소멸되고 다시 대기번호를 받아야 합니다."
                />
                <FlowCard
                  tone="rose"
                  step="4"
                  title="확정 / 예비 결과"
                  body="번호 순서에 따라 확정 또는 예비로 결과가 나뉩니다. 예비 결과는 담당자가 개별 연락드리며, 1차 이탈자 발생 시 예비번호 순서로 확정될 수 있습니다."
                />
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">문의 안내</h2>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-gray-600">
                문의처 02-6959-3871~3{'\n'}
                카카오톡 문의를 권장합니다.{'\n'}
                교육 프로그램 및 홈페이지 기능 관련 문의
              </p>
              <a
                href="https://pf.kakao.com/_wxexmxgn/chat"
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex w-full items-center justify-center rounded-2xl bg-[#FEE500] px-5 py-3 text-sm font-bold text-[#191919] transition hover:brightness-95"
              >
                카카오톡 문의
              </a>
            </section>
          </div>
        </div>

        {/* ───────── 모바일 하단 고정 바 ───────── */}
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/97 shadow-[0_-12px_30px_rgba(15,23,42,0.10)] backdrop-blur sm:hidden">
          {/* 이름·전화번호 미입력 상태면 인라인 폼 표시 */}
          {(!myEntry || myEntry.status === 'expired') && !queueIdentityReady && (
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="mb-2 text-xs font-bold text-gray-500">
                ✍️ 이름과 휴대폰 번호를 입력해야 대기열에 입장할 수 있습니다.
              </p>
              <div className="flex gap-2">
                <input
                  value={queueIdentity.studentName}
                  onChange={(e) => setQueueIdentity((prev) => ({ ...prev, studentName: e.target.value }))}
                  placeholder="이름"
                  className="min-h-[44px] flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-snu-blue focus:ring-2 focus:ring-snu-blue/10"
                />
                <input
                  value={queueIdentity.phone}
                  onChange={(e) => setQueueIdentity((prev) => ({ ...prev, phone: normalizeQueuePhone(e.target.value) }))}
                  inputMode="numeric"
                  placeholder="010-0000-0000"
                  className="min-h-[44px] flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 outline-none focus:border-snu-blue focus:ring-2 focus:ring-snu-blue/10"
                />
              </div>
            </div>
          )}

          <div className="mx-auto flex max-w-6xl gap-3 px-4 py-3">
            {!myEntry || myEntry.status === 'expired' ? (
              <button
                onClick={() => { if (shouldShowChallenge) { challenge.openChallenge(); } else { void joinQueue(); } }}
                disabled={!isOpen || joining || joinCooldownActive || remainingCapacity <= 0 || queueLimitReached || !queueIdentityReady}
                className="flex min-h-[54px] flex-1 items-center justify-center rounded-2xl bg-snu-blue px-4 text-sm font-bold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {!queueIdentityReady
                  ? '이름·전화번호를 먼저 입력해 주세요'
                  : primaryActionLabel}
              </button>
            ) : isNearTurnWaiting ? null : suppressCompletedAutoEntry ? null : canEnter ? (
              <button
                onClick={() => void startRegistration()}
                disabled={starting}
                className="flex min-h-[54px] flex-1 items-center justify-center rounded-2xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {starting ? '신청 준비 중...' : '지금 신청'}
              </button>
            ) : (
              <button
                disabled
                className="flex min-h-[54px] flex-1 items-center justify-center rounded-2xl border border-gray-200 bg-gray-100 px-4 text-sm font-bold text-gray-500"
              >
                입장 대기 중
              </button>
            )}

            {showLookupButton && !isNearTurnWaiting && (
              <Link
                to={`/${schoolId}/lookup`}
                className="flex min-h-[54px] items-center justify-center rounded-2xl border border-gray-300 bg-white px-4 text-sm font-bold text-gray-700"
              >
                조회
              </Link>
            )}
          </div>
        </div>


        {showProgramImage && schoolConfig?.programImageUrl && (
          <div className="fixed inset-0 z-[100] bg-black/90 sm:p-4" onClick={() => setShowProgramImage(false)}>
            <div className="flex h-full items-end justify-center sm:items-center">
              <div
                role="dialog"
                aria-modal="true"
                aria-label="프로그램 이미지"
                className="flex h-[100dvh] w-full flex-col overflow-hidden bg-slate-950 sm:h-auto sm:max-h-[92vh] sm:w-auto sm:max-w-[min(96vw,1100px)] sm:rounded-3xl sm:bg-white sm:shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-white sm:border-gray-200 sm:bg-white sm:text-gray-900">
                  <div>
                    <p className="text-sm font-semibold">프로그램 이미지</p>
                    <p className="text-xs text-white/70 sm:text-gray-500">화면에 맞게 자동으로 축소되어 표시됩니다.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowProgramImage(false)}
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20 sm:border-gray-200 sm:bg-gray-100 sm:text-gray-700 sm:hover:bg-gray-200"
                    aria-label="이미지 닫기"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 sm:bg-white sm:p-4">
                  <img
                    src={schoolConfig.programImageUrl}
                    alt="Program Details"
                    className="block h-auto w-auto max-h-full max-w-full rounded-2xl object-contain shadow-2xl"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>

    {challenge.isOpen && (
      <QueueChallengeModal
        isOpen={challenge.isOpen}
        challengeDigits={challenge.challengeDigits}
        userDigits={challenge.userDigits}
        isShaking={challenge.isShaking}
        hasError={challenge.hasError}
        handleDigitInput={challenge.handleDigitInput}
        handleBackspace={challenge.handleBackspace}
        handlePaste={challenge.handlePaste}
        submitChallenge={challenge.submitChallenge}
        closeChallenge={challenge.closeChallenge}
      />
    )}
    </>
  );
}

function MetricCard({
  icon,
  label,
  value,
  helper
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-3.5 shadow-sm sm:p-4">
      <div className="flex items-center gap-3 text-snu-blue">
        {icon}
        <p className="text-sm font-bold text-gray-900">{label}</p>
      </div>
      <p className="mt-3 text-3xl font-bold text-gray-900 sm:mt-4 sm:text-4xl">{value.toLocaleString()}</p>
      <p className="mt-2 text-base leading-relaxed text-gray-500">{helper}</p>
    </div>
  );
}

function InfoTile({
  label,
  value,
  helper
}: {
  label: string;
  value: number | string;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3.5 sm:p-4">
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">{value}</p>
      <p className="mt-2 text-base leading-relaxed text-gray-500">{helper}</p>
    </div>
  );
}

function FlowCard({
  step,
  title,
  body,
  tone
}: {
  step: string;
  title: string;
  body: string;
  tone: 'blue' | 'indigo' | 'amber' | 'emerald' | 'rose';
}) {
  const toneClasses = {
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    rose: 'border-rose-200 bg-rose-50 text-rose-900'
  };

  return (
    <div className={`rounded-2xl border p-5 ${toneClasses[tone]}`}>
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] opacity-70">STEP {step}</p>
      <h4 className="mt-3 text-lg font-bold">{title}</h4>
      <p className="mt-2 text-base leading-relaxed opacity-80">{body}</p>
    </div>
  );
}
function normalizeJoinStatus(status: JoinQueueResponse['status'] | undefined): QueueEntry['status'] {
  if (status === 'waiting' || status === 'eligible' || status === 'consumed' || status === 'expired') {
    return status;
  }

  return 'waiting';
}
