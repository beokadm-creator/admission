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

function formatKstTimeLabel(timestampMs: number) {
  if (!timestampMs) return '확인 전';

  return new Date(timestampMs).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
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
  const [queueStateFromCache, setQueueStateFromCache] = useState(false);
  const [entryFromCache, setEntryFromCache] = useState(false);

  const autoStartedRef = useRef(false);
  const joinRequestIdRef = useRef<string | null>(null);
  const startRequestIdRef = useRef<string | null>(null);

  const queueEnabled = schoolConfig?.queueSettings?.enabled !== false;
  const batchSize = schoolConfig?.queueSettings?.batchSize || 1;
  const batchIntervalMs = schoolConfig?.queueSettings?.batchInterval || 10000;
  const batchIntervalSeconds = Math.max(1, Math.round(batchIntervalMs / 1000));
  const maxActiveSessions = schoolConfig?.queueSettings?.maxActiveSessions || queueState.maxActiveSessions || 60;
  const regularCapacity = schoolConfig?.maxCapacity || 0;
  const waitlistCapacity = schoolConfig?.waitlistCapacity || 0;
  const totalCapacity = regularCapacity + waitlistCapacity;
  const openTimeMs = schoolConfig?.openDateTime ? new Date(schoolConfig.openDateTime).getTime() : 0;
  const isOpen = !!openTimeMs && now >= openTimeMs;
  const openDateLabel = formatDateLabel(openTimeMs);
  const countdownLabel = formatCountdown(Math.max(0, openTimeMs - now));

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

    const unsubscribe = onSnapshot(
      doc(db, 'schools', schoolId, 'queueState', 'current'),
      (snapshot) => {
        const data = snapshot.data();
        setQueueStateFromCache(snapshot.metadata.fromCache);
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
  }, [schoolId, totalCapacity]);

  useEffect(() => {
    if (!schoolId || !userId) return;

    const unsubscribe = onSnapshot(
      doc(db, 'schools', schoolId, 'queueEntries', userId),
      (snapshot) => {
        const data = snapshot.data();
        setEntryFromCache(snapshot.metadata.fromCache);
        setMyEntry(
          data
            ? {
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
  }, [schoolId, userId]);

  const myNumber = myEntry?.number ?? null;
  const canEnter = myEntry?.status === 'eligible' && myNumber !== null && myNumber <= queueState.currentNumber;
  const waitingAhead = myNumber ? Math.max(0, myNumber - queueState.currentNumber - 1) : 0;
  const estimatedWaitMinutes =
    waitingAhead > 0 ? Math.max(1, Math.ceil((waitingAhead / Math.max(batchSize, 1)) * (batchIntervalMs / 60000))) : 0;
  const remainingRegular = Math.max(0, regularCapacity - Math.min(queueState.confirmedCount, regularCapacity));
  const remainingWaitlist = Math.max(0, waitlistCapacity - Math.min(queueState.waitlistedCount, waitlistCapacity));
  const completedCount = queueState.confirmedCount + queueState.waitlistedCount;
  const waitingCount = Math.max(0, queueState.lastAssignedNumber - queueState.currentNumber);
  const remainingCapacity = Math.max(0, queueState.totalCapacity - completedCount);
  const queueJoinLimit = Math.max(1, Math.ceil(totalCapacity * 1.5));
  const queueLimitReached = !myEntry && queueState.lastAssignedNumber >= queueJoinLimit;
  const dataConfidenceLabel = queueStateFromCache || entryFromCache ? '캐시 기준' : '실시간 반영';
  const joinDisabledReason =
    !myEntry || myEntry.status === 'expired'
      ? !isOpen
        ? `접수는 ${openDateLabel}에 시작됩니다. 오픈 전에는 버튼이 비활성화됩니다.`
        : remainingCapacity <= 0
          ? '모집 정원과 예비 정원이 모두 마감되어 더 이상 새로운 대기번호를 발급할 수 없습니다.'
          : queueLimitReached
            ? `대기 접수 상한 ${queueJoinLimit.toLocaleString()}명에 도달해 버튼이 비활성화되었습니다. 이미 번호를 받은 분들만 계속 진행할 수 있습니다.`
            : null
      : null;

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
      return '오픈 시간이 되면 모든 사용자에게 버튼이 동시에 열리고, 클릭 즉시 서버가 대기번호를 발급합니다.';
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
      return '지금 신청서를 작성할 수 있습니다. 잠시 후 신청 페이지로 자동 이동합니다.';
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
  }, [canEnter, estimatedWaitMinutes, isOpen, myEntry?.status, myNumber, queueLimitReached, queueState.availableCapacity, remainingCapacity, waitingAhead]);

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
          result = await joinQueueFn({ schoolId, requestId });
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
      setErrorMessage(error?.message || '?湲곗뿴 ?낆옣???ㅽ뙣?덉뒿?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄??二쇱꽭??');
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
      const result: any = await startFn({ schoolId, requestId: startRequestIdRef.current });

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
      setErrorMessage(error?.message || '?좎껌???섏씠吏濡??대룞?섏? 紐삵뻽?듬땲?? ?ㅼ떆 ?쒕룄??二쇱꽭??');
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
          <h1 className="text-3xl font-black tracking-tight text-stone-950">대기열 없이 바로 신청하는 학교입니다.</h1>
          <p className="mt-3 text-sm leading-relaxed text-stone-600">
            오픈 시간이 되면 서버가 바로 신청 세션을 열어 주며, 별도 대기열 없이 신청할 수 있습니다.
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
    <div className="min-h-screen bg-snu-gray px-4 py-6 text-snu-text sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-md">
          <div className="bg-snu-blue px-6 py-8 text-white sm:px-8">
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/70">QUEUE ACCESS</p>
                <h1 className="mt-3 text-3xl font-bold sm:text-4xl">{schoolConfig?.name || '행사 신청 대기열'}</h1>
                <p className="mt-4 max-w-3xl text-sm leading-relaxed text-white/90">
                  오픈 후 버튼을 누르면 서버가 즉시 공식 대기번호를 발급하고, 작성 가능 인원 범위 안에서 순서대로 입장합니다.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">오픈 시간</p>
                    <p className="mt-2 text-lg font-bold">{openDateLabel}</p>
                    <p className="mt-2 text-xs text-white/75">{isOpen ? '현재 접수 진행 중' : `오픈까지 ${countdownLabel}`}</p>
                  </div>
                  <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/60">운영 기준</p>
                    <p className="mt-2 text-sm">동시 작성 {maxActiveSessions}명</p>
                    <p className="mt-1 text-sm">{batchIntervalSeconds}초마다 최대 {batchSize}명 입장</p>
                    <p className="mt-1 text-sm">작성 시간 3분</p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-white/15 bg-white/10 p-6 backdrop-blur-sm">
                <p className="text-sm font-semibold text-white/75">현재 진행 상황</p>
                <p className="mt-3 text-3xl font-bold">
                  {remainingCapacity <= 0 || queueLimitReached ? '대기열 마감' : isOpen ? '순차 입장 진행 중' : '오픈 대기 중'}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-white/85">
                  {remainingCapacity <= 0
                    ? '모집 정원과 예비 정원이 모두 마감되었습니다.'
                    : queueLimitReached
                      ? `대기 접수 상한 ${queueJoinLimit.toLocaleString()}명에 도달해 새 번호 발급이 종료되었습니다.`
                      : queueState.availableCapacity <= 0
                      ? '현재 작성 가능한 자리가 모두 사용 중이며, 제출 또는 만료가 발생하면 다음 순번이 열립니다.'
                      : '대기번호 순서에 따라 차례대로 입장 기회가 열립니다.'}
                </p>
                <p className="mt-4 text-xs text-white/70">
                  기준 시각(KST): {formatKstTimeLabel(queueState.updatedAt)} · {dataConfidenceLabel}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 bg-gray-50 p-6 sm:grid-cols-2 xl:grid-cols-4">
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
          <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">MY STATUS</p>
                <p className="mt-3 text-5xl font-bold tracking-tight text-snu-blue">{myNumber ?? '--'}</p>
                <p className="mt-4 text-sm leading-relaxed text-gray-600">{myStatusMessage}</p>
              </div>
              <div className="min-w-[120px] rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 text-right">
                <p className="text-xs font-bold uppercase tracking-[0.1em] text-gray-400">WAITING</p>
                <p className="mt-2 text-3xl font-bold text-gray-900">{waitingAhead}</p>
                <p className="mt-1 text-xs text-gray-400">예상 {estimatedWaitMinutes}분</p>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              {!myEntry || myEntry.status === 'expired' ? (
                <button
                  onClick={() => void joinQueue()}
                  disabled={!isOpen || joining || remainingCapacity <= 0 || queueLimitReached}
                  className="flex w-full items-center justify-center rounded-2xl bg-snu-blue px-6 py-4 text-base font-bold text-white transition hover:bg-snu-dark disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {joining
                    ? '대기번호 발급 중...'
                    : myEntry?.status === 'expired'
                        ? '대기열 다시 입장하기'
                        : '대기열 입장하기'}
                  {!joining && <ArrowRight className="ml-2 h-5 w-5" />}
                </button>
              ) : canEnter ? (
                <button
                  onClick={() => void startRegistration()}
                  disabled={starting}
                  className="flex w-full items-center justify-center rounded-2xl bg-emerald-600 px-6 py-4 text-base font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {starting ? '신청 페이지 준비 중...' : '지금 바로 신청하기'}
                  {!starting && <ArrowRight className="ml-2 h-5 w-5" />}
                </button>
              ) : (
                <button disabled className="w-full rounded-2xl border border-gray-200 bg-gray-100 px-6 py-4 text-sm font-bold text-gray-500">
                  대기 순서에 따라 자동으로 입장 기회가 열립니다
                </button>
              )}

              {schoolConfig?.buttonSettings?.showLookupButton && (
                <Link
                  to={`/${schoolId}/lookup`}
                  className="flex w-full items-center justify-center rounded-2xl border border-gray-300 bg-white px-6 py-4 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                >
                  신청 내역 조회하기
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              )}
            </div>

              <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm leading-relaxed text-gray-600">
              {canEnter
                ? '입장 가능한 상태입니다. 3분 안에 제출하지 않으면 세션이 만료되며, 다시 신청하려면 대기열에 다시 입장해야 합니다.'
                : myEntry?.status === 'expired'
                  ? '이전 작성 기회가 종료되었습니다. 다시 대기열에 입장하면 새 번호가 발급됩니다.'
                  : queueLimitReached
                    ? `대기 접수 상한 ${queueJoinLimit.toLocaleString()}명에 도달해 버튼이 비활성화되었습니다. 이미 번호를 받은 분들만 계속 진행할 수 있습니다.`
                    : '대기 화면을 유지하면 내 번호와 현재 입장 번호가 실시간으로 갱신됩니다. 화면을 오래 닫아 두면 대기열에서 제외될 수 있습니다.'}
              </div>

            {joinDisabledReason && (
              <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900">
                {joinDisabledReason}
              </p>
            )}

            {errorMessage && <p className="mt-4 text-sm font-semibold text-rose-600">{errorMessage}</p>}
          </section>

          <div className="space-y-6">
            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">운영 현황</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <InfoTile label="현재 대기 인원" value={waitingCount} helper="번호를 받았지만 아직 작성 중이 아닌 인원" />
                <InfoTile label="남은 확정 접수" value={remainingRegular} helper="확정으로 접수 가능한 잔여 인원" />
                <InfoTile label="남은 예비 접수" value={remainingWaitlist} helper="예비 접수로 안내될 수 있는 잔여 인원" />
                <InfoTile label="작성 중 / 기준" value={`${queueState.activeReservationCount} / ${maxActiveSessions}`} helper="동시에 작성 가능한 인원 기준" />
              </div>
            </section>

            <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900">이용 안내</h2>
              <div className="mt-4 space-y-3 text-sm leading-relaxed text-gray-600">
                <GuideCard title="대기번호는 즉시 발급됩니다" body="버튼을 누르면 서버가 즉시 대기번호를 발급하고 화면에도 바로 반영합니다." />
                <GuideCard title="오픈 시간 동시 오픈" body="오픈 시간이 되면 모든 사용자에게 대기열 버튼이 동시에 열리고, 클릭 순서대로 번호가 부여됩니다." />
                <GuideCard title="대기 접수는 상한에서 마감됩니다" body={`대기번호 발급은 운영 상한 ${queueJoinLimit.toLocaleString()}명까지만 열리며, 상한에 도달하면 버튼이 비활성화되고 이미 번호를 받은 분들만 계속 진행합니다.`} />
                <GuideCard title="입장은 순차적으로 열립니다" body={`${batchIntervalSeconds}초마다 최대 ${batchSize}명씩, 현재 작성 가능한 인원 범위 안에서 순서대로 입장합니다.`} />
                <GuideCard title="작성 시간은 3분입니다" body="3분 안에 제출하지 않으면 세션이 만료되고, 다시 신청하려면 대기열에 다시 입장해야 합니다." />
              </div>
            </section>

            {schoolConfig?.programImageUrl && (
              <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-bold text-gray-900">프로그램 안내</h2>
                <button
                  onClick={() => setShowProgramImage(true)}
                  className="mt-4 flex w-full items-center justify-center rounded-2xl border border-gray-300 bg-white px-5 py-3 text-sm font-bold text-gray-700 transition hover:bg-gray-50"
                >
                  프로그램 이미지 보기
                </button>
              </section>
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
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3 text-snu-blue">
        {icon}
        <p className="text-sm font-bold text-gray-900">{label}</p>
      </div>
      <p className="mt-4 text-3xl font-bold text-gray-900">{value.toLocaleString()}</p>
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
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-500">{helper}</p>
    </div>
  );
}

function GuideCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <p className="font-bold text-gray-900">{title}</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-500">{body}</p>
    </div>
  );
}

