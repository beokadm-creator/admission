import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock3, Info, Ticket, Users } from 'lucide-react';
import { auth, db, functions } from '../firebase/config';
import { useSchool } from '../contexts/SchoolContext';
import { getQueueUserId } from '../lib/queue';
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

function formatDetailedCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

function getCountdownParts(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [
    { label: 'DAY', value: String(days).padStart(2, '0') },
    { label: 'HOUR', value: String(hours).padStart(2, '0') },
    { label: 'MIN', value: String(minutes).padStart(2, '0') },
    { label: 'SEC', value: String(seconds).padStart(2, '0') }
  ];
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
  const [starting, setStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [autoEntering, setAutoEntering] = useState(false);
  const [showProgramImage, setShowProgramImage] = useState(false);
  const [selectedRoundId, setSelectedRoundId] = useState<string>('round1');

  const autoStartedRef = useRef(false);
  const joinRequestIdRef = useRef<string | null>(null);
  const startRequestIdRef = useRef<string | null>(null);

  const queueEnabled = schoolConfig?.queueSettings?.enabled !== false;
  const rounds = normalizeAdmissionRounds(schoolConfig);
  const currentRound = getCurrentAdmissionRound(schoolConfig, now);
  const selectedRound = rounds.find((round) => round.id === selectedRoundId) || currentRound || rounds[0];
  const maxActiveSessions = schoolConfig?.queueSettings?.maxActiveSessions || queueState.maxActiveSessions || 60;
  const regularCapacity = selectedRound?.maxCapacity || schoolConfig?.maxCapacity || 0;
  const waitlistCapacity = selectedRound?.waitlistCapacity || schoolConfig?.waitlistCapacity || 0;
  const totalCapacity = regularCapacity + waitlistCapacity;
  const openTimeMs = selectedRound?.openDateTime ? new Date(selectedRound.openDateTime).getTime() : 0;
  const isOpen = !!openTimeMs && now >= openTimeMs;
  const openDateLabel = formatDateLabel(openTimeMs);
  const countdownLabel = formatCountdown(Math.max(0, openTimeMs - now));
  const detailedCountdownLabel = formatDetailedCountdown(Math.max(0, openTimeMs - now));
  const countdownParts = getCountdownParts(Math.max(0, openTimeMs - now));
  const gateHeadline = '2028학년도 서울대학교 입학전형의 안정적 준비를 위한 학부모 교육 프로그램';
  const programInfo =
    schoolConfig?.programInfo?.trim() ||
    '행사 개요, 준비물, 유의사항은 이 영역에서 함께 확인할 수 있습니다.';

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
    if (!queueEnabled) return;
    if (auth.currentUser?.uid) {
      setUserId(auth.currentUser.uid);
      return;
    }

    let cancelled = false;

    void getQueueUserId()
      .then((nextUserId) => {
        if (!cancelled) {
          setUserId(nextUserId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMessage('대기열 준비 중 인증 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
        }
      });

    return () => {
      cancelled = true;
    };
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
  const canEnter = myEntry?.status === 'eligible' && myNumber !== null && myNumber <= queueState.currentNumber;
  const waitingAhead = myNumber ? Math.max(0, myNumber - queueState.currentNumber - 1) : 0;
  const estimatedWaitMinutes =
    waitingAhead > 0 ? Math.max(1, Math.ceil((waitingAhead / Math.max(maxActiveSessions, 1)) * 3)) : 0;
  const remainingRegular = Math.max(0, regularCapacity - Math.min(queueState.confirmedCount, regularCapacity));
  const remainingWaitlist = Math.max(0, waitlistCapacity - Math.min(queueState.waitlistedCount, waitlistCapacity));
  const completedCount = queueState.confirmedCount + queueState.waitlistedCount;
  const waitingCount = Math.max(0, queueState.lastAssignedNumber - queueState.currentNumber);
  const remainingCapacity = Math.max(0, queueState.totalCapacity - completedCount);
  const queueJoinLimit = Math.max(1, Math.ceil(getAdmissionRoundTotal(selectedRound) * 1.5));
  const queueLimitReached = !myEntry && queueState.lastAssignedNumber >= queueJoinLimit;
  const selectedRoundStatusLabel = !isOpen
    ? '오픈 대기'
    : remainingCapacity <= 0 || queueLimitReached
      ? '접수 마감'
      : '접수 진행 중';
  const waitingDisplayValue = myNumber === null ? '-' : waitingAhead.toLocaleString();
  const waitingDisplayHelper =
    myNumber === null
      ? '대기번호를 받으면 앞 대기 인원이 표시됩니다'
      : waitingAhead > 0
        ? `예상 ${estimatedWaitMinutes}분`
        : canEnter
          ? '지금 입장 가능'
          : '곧 입장 예정';
  const joinDisabledReason =
    !myEntry || myEntry.status === 'expired'
      ? !isOpen
        ? `접수는 ${openDateLabel}에 시작됩니다. 오픈 전에는 버튼이 비활성화됩니다.`
        : remainingCapacity <= 0
          ? '모집 정원과 예비 정원이 모두 마감되어 더 이상 새로운 대기번호를 발급할 수 없습니다.'
          : queueLimitReached
            ? `대기 접수 상한 ${queueJoinLimit.toLocaleString()}명(정규+예비의 1.5배)에 도달해 버튼이 비활성화되었습니다. 이미 번호를 받은 분들만 계속 진행할 수 있습니다.`
            : null
      : null;
  const buttonStatusMessage = canEnter
    ? '지금 신청 가능합니다. 3분 안에 제출하지 않으시면 기회가 양보됩니다.'
    : myEntry?.status === 'expired'
      ? '이전 신청 기회가 종료되었습니다. 지속 참가하시려면 대기열에 다시 입장해 새 번호를 받아주십시오.'
      : queueLimitReached
        ? `대기 접수 상한 ${queueJoinLimit.toLocaleString()}명에 도달해 버튼이 비활성화되었습니다. 이미 번호를 받으신 분들만 입장이 가능합니다.`
        : joinDisabledReason || '오픈 시각에 활성화되는 버튼을 누르시면 대기번호가 발급됩니다.';
  const primaryActionLabel = joining
    ? `${selectedRound?.label || ''} 대기번호 발급 중...`
    : myEntry?.status === 'expired'
      ? `${selectedRound?.label || ''} 대기열 다시 입장하기`
      : `${selectedRound?.label || ''} 대기열 입장하기`;

  useEffect(() => {
    if (!canEnter || !isOpen || !schoolId || loading || autoStartedRef.current) return;

    autoStartedRef.current = true;
    setAutoEntering(true);

    const timer = window.setTimeout(() => {
      void startRegistration();
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [canEnter, isOpen, schoolId, loading]);

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
      return `현재는 ${selectedRound?.label || '선택한 차수'} 오픈 전입니다. 카드에서 오픈 시각과 접수 상태를 먼저 확인해 주세요.`;
    }

    if (myEntry?.status === 'expired') {
      return '이전 작성 기회가 만료되었습니다. 다시 신청하려면 대기열에 다시 입장해 새 번호를 받아야 합니다.';
    }

    if (myNumber === null) {
      if (queueLimitReached) {
        return '대기 접수 상한에 도달해 새 번호 발급이 마감되었습니다. 이미 번호를 받은 분들만 계속 진행합니다.';
      }
      if (remainingCapacity <= 0) {
        return '현재 모집 정원과 예비 정원이 모두 마감되었습니다.';
      }
      return '버튼을 누르면 서버가 즉시 공식 대기번호를 발급하고, 번호 순서대로 신청 기회를 엽니다.';
    }

    if (canEnter) {
      return '지금 신청서를 작성하실 수 있습니다. 잠시 후 신청 페이지로 자동 이동합니다.';
    }

    if (remainingCapacity <= 0) {
      return '전체 모집은 마감되었지만, 취소나 세션 만료가 생기면 일부 순번에 추가 기회가 열릴 수 있습니다.';
    }

    if (queueState.availableCapacity <= 0) {
      return '현재 작성 가능한 자리가 모두 사용 중입니다. 제출이나 세션 만료가 발생하면 다음 순번이 열립니다.';
    }

    if (waitingAhead === 0) {
      return '곧 입장 순서가 됩니다. 화면을 유지하면 입장 가능 상태가 자동으로 반영됩니다.';
    }

    return `앞에 약 ${waitingAhead}명이 대기 중이며, 예상 대기 시간은 약 ${estimatedWaitMinutes}분입니다.`;
  }, [canEnter, estimatedWaitMinutes, isOpen, maxActiveSessions, myEntry?.status, myNumber, queueLimitReached, queueState.availableCapacity, remainingCapacity, waitingAhead]);

  const ensureQueueUserId = async () => {
    if (auth.currentUser?.uid) {
      setUserId(auth.currentUser.uid);
      return auth.currentUser.uid;
    }

    const nextUserId = await getQueueUserId();
    setUserId(nextUserId);
    return nextUserId;
  };

  const joinQueue = async () => {
    if (!schoolId || joining || !isOpen) return;

    setJoining(true);
    setErrorMessage(null);
    const requestId = createRequestId('joinQueue');
    joinRequestIdRef.current = requestId;

    try {
      await ensureQueueUserId();
      const joinQueueFn = httpsCallable(functions, 'joinQueue');
      let result: any = null;
      let lastError: any = null;
      const maxAttempts = 3;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          result = await joinQueueFn({ schoolId, roundId: selectedRound?.id, requestId });
          lastError = null;
          break;
        } catch (error: any) {
          lastError = error;
          const code = String(error?.code || '');
          const shouldRetry = code.includes('resource-exhausted') || code.includes('deadline-exceeded');
          if (!shouldRetry || attempt === maxAttempts) {
            throw error;
          }
          const backoffMs = 250 + Math.floor(Math.random() * 350) + (attempt - 1) * 250;
          await sleep(backoffMs);
        }
      }

      if (!result && lastError) {
        throw lastError;
      }
      if (result.data) {
        setMyEntry((prev) => ({
          number: result.data.number ?? prev?.number ?? null,
          status: result.data.status ?? prev?.status ?? 'waiting',
          activeReservationId: prev?.activeReservationId ?? null
        }));
      }
    } catch (error: any) {
      joinRequestIdRef.current = null;
      setErrorMessage(error?.message || '대기열 입장에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      joinRequestIdRef.current = null;
      setJoining(false);
    }
  };

  const startRegistration = async () => {
    if (!schoolId || starting || !isOpen) return;

    setStarting(true);
    setErrorMessage(null);
    if (!startRequestIdRef.current) {
      startRequestIdRef.current = createRequestId('startRegistration');
    }

    try {
      await ensureQueueUserId();
      const startFn = httpsCallable(functions, 'startRegistrationSession');
      const result: any = await startFn({ schoolId, roundId: myEntry?.roundId || selectedRound?.id, requestId: startRequestIdRef.current });

      if (!result.data?.success) {
        throw new Error('?깅줉 ?몄뀡 ?앹꽦???ㅽ뙣?덉뒿?덈떎.');
      }

      localStorage.setItem(`registrationSessionId_${schoolId}`, result.data.sessionId);
      localStorage.setItem(`registrationExpiresAt_${schoolId}`, String(result.data.expiresAt));
      navigate(`/${schoolId}/register`);
    } catch (error: any) {
      startRequestIdRef.current = null;
      setAutoEntering(false);
      autoStartedRef.current = false;
      setErrorMessage(error?.message || '신청 페이지로 이동하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-snu-gray px-4">
        <div className="text-center">
          <div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-4 border-gray-200 border-t-snu-blue" />
          <p className="text-sm font-bold tracking-wider text-gray-500">CONNECTING...</p>
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
          <h2 className="text-2xl font-bold text-gray-900">지금 입장 가능합니다</h2>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            신청 페이지로 자동 이동 중입니다.
            <br />
            작성 시간은 3분이며, 초과 시 자동으로 만료됩니다.
          </p>
          {errorMessage && <p className="mt-4 text-sm font-semibold text-rose-600">{errorMessage}</p>}
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
          <h1 className="text-3xl font-black tracking-tight text-stone-950">대기열 없이 바로 신청이 가능한 과정입니다.</h1>
          <p className="mt-3 text-base leading-relaxed text-stone-600">
            오픈 시각이 되면 서버가 바로 신청 세션을 열어드리며, 별도 대기열 없이 신청이 가능합니다.
          </p>
          <button
            onClick={() => void startRegistration()}
            disabled={!isOpen || starting}
            className="mt-6 flex w-full items-center justify-center rounded-2xl bg-stone-950 px-6 py-4 text-base font-bold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
          >
            {starting ? '신청 페이지 준비 중...' : isOpen ? '지금 바로 신청하기' : '오픈 대기 중'}
          </button>
          <p className="mt-4 text-sm text-stone-500">오픈 시간(KST): {openDateLabel}</p>
          {errorMessage && <p className="mt-4 text-sm font-semibold text-rose-600">{errorMessage}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-snu-gray px-4 py-6 pb-28 text-snu-text sm:px-6 sm:py-8 sm:pb-8">
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
                        alt={`${schoolConfig?.name || '학교'} 로고`}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  ) : null}
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/70">QUEUE ACCESS</p>
                    <h1 className="mt-2 text-2xl font-bold leading-tight sm:text-4xl">{schoolConfig?.name || '행사 신청 대기열'}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/85 sm:text-base">
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
                                ? (remainingCapacity <= 0 || queueLimitReached ? '현재 접수는 마감되었습니다' : '현재 버튼이 열려 있습니다')
                                : `오픈까지 ${formatCountdown(Math.max(0, roundOpenTime - now))}`)
                            : (roundIsOpen ? '선택하면 현재 상태를 확인할 수 있습니다' : `오픈까지 ${formatCountdown(Math.max(0, roundOpenTime - now))}`)}
                        </p>
                        <p className={`mt-2 text-[11px] font-semibold sm:mt-3 ${isSelected ? 'text-snu-blue/80' : 'text-white/70'}`}>
                          {isSelected ? selectedRoundStatusLabel : (roundIsOpen ? '선택 가능' : '오픈 전')}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-3xl border border-white/15 bg-white/10 p-5 backdrop-blur-sm sm:p-6">
                <p className="text-xl font-bold leading-tight sm:text-3xl">
                  {remainingCapacity <= 0 || queueLimitReached ? `${selectedRound?.label || '해당 차수'} 마감` : isOpen ? `${selectedRound?.label || '해당 차수'} 순차 입장 진행 중` : `${selectedRound?.label || '해당 차수'} 오픈 대기 중`}
                </p>
                <p className="mt-2 text-sm text-white/80">{openDateLabel}</p>
                <div className="mt-5 rounded-2xl border border-white/15 bg-black/10 p-4">
                  <p className="text-sm font-semibold text-white/85">{detailedCountdownLabel}</p>
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
              label="발급된 번호"
              value={queueState.lastAssignedNumber}
              helper={`버튼 클릭으로 발급된 전체 대기번호 / 상한 ${queueJoinLimit.toLocaleString()}명`}
            />
            <MetricCard
              icon={<Ticket className="h-5 w-5" />}
              label="현재 입장 번호"
              value={queueState.currentNumber}
              helper="입장 가능한 마지막 번호"
            />
            <MetricCard
              icon={<Clock3 className="h-5 w-5" />}
              label="작성 중"
              value={queueState.activeReservationCount}
              helper="현재 신청서를 작성 중인 인원"
            />
            <MetricCard
              icon={<CheckCircle2 className="h-5 w-5" />}
              label="제출 완료"
              value={completedCount}
              helper="신청 제출을 마친 인원"
            />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-3xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
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

            <div className="mt-6 grid gap-3">
              {!myEntry || myEntry.status === 'expired' ? (
                <button
                  onClick={() => void joinQueue()}
                  disabled={!isOpen || joining || remainingCapacity <= 0 || queueLimitReached}
                  className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-snu-blue px-5 py-4 text-base font-bold text-white transition hover:bg-snu-dark disabled:cursor-not-allowed disabled:bg-gray-300 sm:min-h-[60px]"
                >
                  {primaryActionLabel}
                  {!joining && <ArrowRight className="ml-2 h-5 w-5" />}
                </button>
              ) : canEnter ? (
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

              {schoolConfig?.buttonSettings?.showLookupButton && (
                <Link
                  to={`/${schoolId}/lookup`}
                  className="flex min-h-[52px] w-full items-center justify-center rounded-2xl border border-gray-300 bg-white px-5 py-4 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                >
                  신청 내역 조회
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              )}
            </div>

            <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm leading-relaxed text-gray-600">
              <p>{buttonStatusMessage}</p>
            </div>

            <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4">
              <p className="text-sm font-bold text-gray-900">이용 안내</p>
              <div className="mt-3 space-y-2 text-sm leading-relaxed text-gray-600">
                <p>접수는 {openDateLabel}에 시작됩니다. 오픈 전에는 버튼이 비활성화됩니다.</p>
                <p>오픈 시간에 나타나는 버튼을 누르면 대기번호가 발급됩니다.</p>
                <p>대기 접수는 상한 {queueJoinLimit.toLocaleString()}명(정규+예비의 1.5배)에서 마감됩니다.</p>
                <p>1차에서 신청하지 못한 경우 2차 오픈 시각에 다시 대기열에 입장할 수 있습니다.</p>
              </div>
            </div>

            <section className="mt-4 rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">프로그램 안내</h2>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-gray-600">{programInfo}</p>
              {schoolConfig?.programImageUrl && (
                <button
                  onClick={() => setShowProgramImage(true)}
                  className="mt-4 flex min-h-[56px] w-full items-center justify-center rounded-2xl border border-gray-300 bg-white px-5 py-3 text-base font-bold text-gray-700 transition hover:bg-gray-50"
                >
                  프로그램 이미지 보기
                </button>
              )}
            </section>

            {errorMessage && <p className="mt-4 text-sm font-semibold text-rose-600">{errorMessage}</p>}
          </section>

          <div className="space-y-6">
            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">운영 현황</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <InfoTile label="현재 대기 인원" value={waitingCount} helper="번호를 받았지만 아직 작성 중이 아닌 인원" />
                <InfoTile label="남은 확정 접수" value={remainingRegular} helper="확정으로 접수 가능한 잔여 인원" />
                <InfoTile label="남은 예비 접수" value={remainingWaitlist} helper="예비는 확정이 아니며, 결원 발생 시 별도 연락 대상입니다" />
                <InfoTile label="작성 중 / 기준" value={`${queueState.activeReservationCount} / ${maxActiveSessions}`} helper="동시에 작성 가능한 인원 기준" />
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">진행 흐름</h2>
              <div className="mt-4 space-y-3">
                <FlowCard
                  tone="blue"
                  step="1"
                  title="차수 선택"
                  body="1차 또는 2차 버튼을 눌러 해당 차수의 오픈 시간과 접수 상태를 확인합니다."
                />
                <FlowCard
                  tone="indigo"
                  step="2"
                  title="버튼 오픈 후 대기번호 발급"
                  body="오픈 시간에 나타나는 버튼을 누르면 대기번호가 발급됩니다."
                />
                <FlowCard
                  tone="amber"
                  step="3"
                  title="순차 입장"
                  body={`동시 작성 가능 인원 ${maxActiveSessions}명을 유지하며, 제출 또는 만료로 자리가 생기면 다음 순번이 입장합니다.`}
                />
                <FlowCard
                  tone="emerald"
                  step="4"
                  title="3분 안에 작성"
                  body="입장 후 3분 안에 제출해야 하며, 시간이 지나면 세션이 만료되고 다시 대기열에 입장해야 합니다."
                />
                <FlowCard
                  tone="rose"
                  step="5"
                  title="확정 / 예비 안내"
                  body="예비 접수는 확정 참가가 아니며, 확정 등록 인원에서 결원이 발생한 경우에만 별도 연락을 드립니다."
                />
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">문의 안내</h2>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-gray-600">
                문의처 02-6959-3871~3{'\n'}
                카카오 문의를 권장 합니다.{'\n'}
                교육 프로그램 및 홈페이지 기능 관련 문의
              </p>
              <a
                href="https://pf.kakao.com/_wxexmxgn/chat"
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex w-full items-center justify-center rounded-2xl bg-[#FEE500] px-5 py-3 text-sm font-bold text-[#191919] transition hover:brightness-95"
              >
                카카오채널 문의
              </a>
            </section>

          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur sm:hidden">
          <div className="mx-auto flex max-w-6xl gap-3">
            {!myEntry || myEntry.status === 'expired' ? (
              <button
                onClick={() => void joinQueue()}
                disabled={!isOpen || joining || remainingCapacity <= 0 || queueLimitReached}
                className="flex min-h-[54px] flex-1 items-center justify-center rounded-2xl bg-snu-blue px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {primaryActionLabel}
              </button>
            ) : canEnter ? (
              <button
                onClick={() => void startRegistration()}
                disabled={starting}
                className="flex min-h-[54px] flex-1 items-center justify-center rounded-2xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {starting ? '신청 페이지 준비 중...' : '지금 신청하기'}
              </button>
            ) : (
              <button
                disabled
                className="flex min-h-[54px] flex-1 items-center justify-center rounded-2xl border border-gray-200 bg-gray-100 px-4 text-sm font-bold text-gray-500"
              >
                입장 대기 중
              </button>
            )}

            {schoolConfig?.buttonSettings?.showLookupButton && (
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4" onClick={() => setShowProgramImage(false)}>
            <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <img src={schoolConfig.programImageUrl} alt="Program Details" className="h-auto w-full object-contain" />
            </div>
          </div>
        )}
      </div>
    </div>
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
      <p className="mt-3 text-2xl font-bold text-gray-900 sm:mt-4 sm:text-3xl">{value.toLocaleString()}</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-500">{helper}</p>
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
      <p className="mt-2 text-xl font-bold text-gray-900 sm:text-2xl">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-500">{helper}</p>
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
    <div className={`rounded-2xl border p-4 ${toneClasses[tone]}`}>
      <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-70">STEP {step}</p>
      <p className="mt-2 font-bold">{title}</p>
      <p className="mt-2 text-xs leading-relaxed opacity-80">{body}</p>
    </div>
  );
}

