import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Hourglass,
  Info,
  ShieldCheck,
  Ticket,
  Users,
  X
} from 'lucide-react';
import { functions, rtdb as database } from '../firebase/config';
import { useSchool } from '../contexts/SchoolContext';
import { getQueueUserId } from '../lib/queue';

interface QueueMeta {
  currentNumber: number;
  lastAssignedNumber: number;
}

interface QueueEntry {
  number: number;
}

interface SlotStats {
  total: number;
  reserved: number;
  confirmed: number;
  available: number;
}

type QueueTone = 'active' | 'warning' | 'closed';

function formatKoreanDate(openTimeMs: number) {
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

function formatCountdownLabel(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function getQueueTone(isOpen: boolean, remainingCapacity: number, potentialCapacity: number): QueueTone {
  if (!isOpen) return 'warning';
  if (remainingCapacity <= 0) return 'closed';
  if (potentialCapacity <= 0) return 'warning';
  return 'active';
}

export default function SmartQueueGate() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const { schoolConfig } = useSchool();
  const navigate = useNavigate();

  const [queueMeta, setQueueMeta] = useState<QueueMeta>({ currentNumber: 0, lastAssignedNumber: 0 });
  const [slotStats, setSlotStats] = useState<SlotStats>({ total: 0, reserved: 0, confirmed: 0, available: 0 });
  const [myNumber, setMyNumber] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [autoEntering, setAutoEntering] = useState(false);
  const [showProgramImage, setShowProgramImage] = useState(false);
  const autoStartedRef = useRef(false);

  const queueEnabled = schoolConfig?.queueSettings?.enabled !== false;
  const batchSize = schoolConfig?.queueSettings?.batchSize || 80;
  const batchIntervalMs = schoolConfig?.queueSettings?.batchInterval || 60000;
  const batchIntervalSeconds = Math.max(1, Math.round(batchIntervalMs / 1000));
  const regularCapacity = schoolConfig?.maxCapacity || 0;
  const waitlistCapacity = schoolConfig?.waitlistCapacity || 0;
  const totalCapacity = regularCapacity + waitlistCapacity;
  const openTimeMs = schoolConfig?.openDateTime ? new Date(schoolConfig.openDateTime).getTime() : 0;
  const isOpen = !!openTimeMs && now >= openTimeMs;
  const openDateLabel = formatKoreanDate(openTimeMs);
  const countdownMs = Math.max(0, openTimeMs - now);
  const countdownLabel = formatCountdownLabel(countdownMs);

  const heroMessage =
    schoolConfig?.heroMessage?.trim() ||
    schoolConfig?.parkingMessage?.trim() ||
    '오픈 시각이 되면 버튼이 활성화되며, 클릭 순서대로 대기열 번호가 부여됩니다.';
  const programInfo =
    schoolConfig?.programInfo?.trim() ||
    '행사 개요, 준비물, 유의사항을 이 영역에 안내해 주세요.';

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    getQueueUserId()
      .then(setUserId)
      .catch(() => {
        setErrorMessage('인증 준비 중 문제가 발생했습니다. 새로고침 후 다시 시도해 주세요.');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!schoolId || !userId) return;

    const metaRef = ref(database, `queue/${schoolId}/meta`);
    const entryRef = ref(database, `queue/${schoolId}/entries/${userId}`);
    const slotsRef = ref(database, `slots/${schoolId}`);

    const offMeta = onValue(metaRef, (snapshot) => {
      const data = snapshot.val();
      setQueueMeta({
        currentNumber: data?.currentNumber || 0,
        lastAssignedNumber: data?.lastAssignedNumber || 0
      });
      setLoading(false);
    });

    const offEntry = onValue(entryRef, (snapshot) => {
      const data = snapshot.val() as QueueEntry | null;
      setMyNumber(data?.number ?? null);
    });

    const offSlots = onValue(slotsRef, (snapshot) => {
      const data = snapshot.val();
      setSlotStats({
        total: data?.total || totalCapacity,
        reserved: data?.reserved || 0,
        confirmed: data?.confirmed || 0,
        available: data?.available ?? totalCapacity
      });
    });

    return () => {
      offMeta();
      offEntry();
      offSlots();
    };
  }, [schoolId, totalCapacity, userId]);

  const canEnter = myNumber !== null && myNumber <= queueMeta.currentNumber;

  // 입장 가능 상태가 되면 자동으로 등록 페이지로 이동
  useEffect(() => {
    if (!canEnter || !isOpen || !schoolId || loading || autoStartedRef.current) return;
    autoStartedRef.current = true;
    setAutoEntering(true);
    const timer = setTimeout(() => {
      startRegistration();
    }, 2000);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEnter, isOpen, schoolId, loading]);
  const waitingAhead = myNumber ? Math.max(0, myNumber - queueMeta.currentNumber - 1) : 0;
  const estimatedWaitMinutes =
    waitingAhead > 0 ? Math.max(1, Math.ceil((waitingAhead / batchSize) * (batchIntervalMs / 60000))) : 0;

  const regularConfirmed = Math.min(slotStats.confirmed, regularCapacity);
  const waitlistConfirmed = Math.min(Math.max(0, slotStats.confirmed - regularCapacity), waitlistCapacity);
  const remainingRegular = Math.max(0, regularCapacity - regularConfirmed);
  const remainingWaitlist = Math.max(0, waitlistCapacity - waitlistConfirmed);

  const queueSummary = useMemo(() => {
    const clickedCount = queueMeta.lastAssignedNumber;
    const admittedCount = queueMeta.currentNumber;
    const writingCount = slotStats.reserved;
    const completedCount = slotStats.confirmed;
    const waitingCount = Math.max(0, clickedCount - admittedCount);
    const remainingCapacity = Math.max(0, totalCapacity - completedCount);
    const potentialCapacity = Math.max(0, totalCapacity - completedCount - writingCount);
    const tone = getQueueTone(isOpen, remainingCapacity, potentialCapacity);

    let title = '순차 입장 진행 중';
    let description = `${batchSize}명씩 ${batchIntervalSeconds}초 간격으로 순차 입장하고 있습니다.`;

    if (!isOpen) {
      title = '오픈 대기 중';
      description = `${openDateLabel}에 버튼이 활성화됩니다. 그 전에는 입장 요청이 열리지 않습니다.`;
    } else if (remainingCapacity <= 0) {
      title = '모집 마감';
      description = '정규 신청 인원과 예비 접수 인원이 모두 마감되었습니다.';
    } else if (potentialCapacity <= 0) {
      title = '잔여 좌석 임박';
      description = '현재 작성 중인 인원까지 반영하면 남은 좌석이 거의 없습니다.';
    }

    return {
      clickedCount,
      admittedCount,
      writingCount,
      completedCount,
      waitingCount,
      remainingCapacity,
      potentialCapacity,
      tone,
      title,
      description
    };
  }, [
    batchIntervalSeconds,
    batchSize,
    isOpen,
    openDateLabel,
    queueMeta.currentNumber,
    queueMeta.lastAssignedNumber,
    slotStats.confirmed,
    slotStats.reserved,
    totalCapacity
  ]);

  const statusStyles = {
    active: {
      badge: 'border-white/20 bg-emerald-500 text-white',
      panel: 'border-emerald-100 bg-emerald-50 text-emerald-900'
    },
    warning: {
      badge: 'border-white/20 bg-amber-500 text-white',
      panel: 'border-amber-100 bg-amber-50 text-amber-900'
    },
    closed: {
      badge: 'border-white/20 bg-rose-500 text-white',
      panel: 'border-rose-100 bg-rose-50 text-rose-900'
    }
  } as const;

  const myStatusMessage = useMemo(() => {
    if (!isOpen) {
      return '오픈 시간이 되면 버튼이 나타납니다. 버튼을 누른 순서대로 번호가 부여됩니다.';
    }

    if (myNumber === null) {
      if (queueSummary.remainingCapacity <= 0) {
        return '현재 모집이 마감되어 새로운 번호 발급 가능성이 매우 낮습니다.';
      }

      return '버튼을 누르면 본인 순번이 즉시 저장됩니다. 순번과 현황은 아래에서 계속 확인할 수 있습니다.';
    }

    if (canEnter) {
      return '지금 바로 신청서를 작성할 수 있습니다. 5분 안에 제출을 완료해 주세요.';
    }

    if (queueSummary.remainingCapacity <= 0) {
      return '현재는 마감 상태입니다. 앞선 신청자의 취소 또는 만료가 발생할 때만 기회가 생깁니다.';
    }

    if (queueSummary.potentialCapacity <= 0) {
      return '현재 작성 중인 인원까지 반영하면 좌석이 거의 소진됩니다. 취소 또는 만료가 발생하면 순차적으로 기회가 주어집니다.';
    }

    if (waitingAhead === 0 && !canEnter) {
      return '현재 대기열의 가장 첫 번째 순서입니다. 곧 작성이 시작됩니다.';
    }

    return `내 앞에 ${waitingAhead}명이 있으며 예상 대기 시간은 약 ${estimatedWaitMinutes}분입니다.`;
  }, [
    canEnter,
    estimatedWaitMinutes,
    isOpen,
    myNumber,
    queueSummary.potentialCapacity,
    queueSummary.remainingCapacity,
    waitingAhead
  ]);

  const transparencyMetrics = [
    {
      icon: <Users className="h-5 w-5" />,
      label: '버튼 클릭 인원',
      value: queueSummary.clickedCount,
      helper: '버튼을 눌러 순번을 받은 누적 인원'
    },
    {
      icon: <Activity className="h-5 w-5" />,
      label: '현재 입장 중',
      value: queueSummary.admittedCount,
      helper: '작성 페이지에 진입 가능한 순번 기준'
    },
    {
      icon: <Hourglass className="h-5 w-5" />,
      label: '작성 중',
      value: queueSummary.writingCount,
      helper: '5분 이내 작성 중인 인원'
    },
    {
      icon: <CheckCircle2 className="h-5 w-5" />,
      label: '작성 완료',
      value: queueSummary.completedCount,
      helper: '신청 제출이 완료된 인원'
    }
  ];

  const guidanceCards = [
    {
      icon: ShieldCheck,
      title: '공정한 순번 부여',
      body: '오픈 후 버튼 클릭 순서대로 번호가 부여되며, 같은 계정으로 중복 진입은 제한됩니다.'
    },
    {
      icon: Clock3,
      title: '순차 입장 방식',
      body: `${batchSize}명씩 ${batchIntervalSeconds}초 간격으로 입장하여 갑작스러운 트래픽 집중을 완화합니다.`
    },
    {
      icon: Info,
      title: '마감 안내',
      body: '정규 신청과 예비 접수가 모두 마감되면 화면 상태가 즉시 모집 마감으로 바뀝니다.'
    }
  ];

  const joinQueue = async () => {
    if (!schoolId || joining || !isOpen) return;

    setJoining(true);
    setErrorMessage(null);

    try {
      const joinQueueFn = httpsCallable(functions, 'joinQueue');
      const result: any = await joinQueueFn({ schoolId });

      if (result.data?.number) {
        setMyNumber(result.data.number);
      }
    } catch (error: any) {
      setErrorMessage(error?.message || '대기열 진입에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setJoining(false);
    }
  };

  const startRegistration = async () => {
    if (!schoolId || starting || !isOpen) return;

    setStarting(true);
    setErrorMessage(null);

    try {
      const startFn = httpsCallable(functions, 'startRegistrationSession');
      const result: any = await startFn({ schoolId });

      if (!result.data?.success) {
        throw new Error('등록 세션 생성에 실패했습니다.');
      }

      localStorage.setItem(`registrationSessionId_${schoolId}`, result.data.sessionId);
      localStorage.setItem(`registrationExpiresAt_${schoolId}`, String(result.data.expiresAt));
      navigate(`/${schoolId}/register`);
    } catch (error: any) {
      setErrorMessage(error?.message || '신청 페이지 진입에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-snu-gray px-4">
        <div className="text-center">
          <div className="mx-auto mb-5 h-14 w-14 animate-spin rounded-full border-4 border-gray-200 border-t-snu-blue" />
          <p className="text-sm font-bold text-gray-500 tracking-wider">CONNECTING TO SNU...</p>
        </div>
      </div>
    );
  }

  if (autoEntering) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-snu-gray px-4">
        <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 text-center shadow-md">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 border border-emerald-100">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          </div>
          <h3 className="text-xl font-bold text-gray-900">신청 차례가 되었습니다</h3>
          <p className="mt-2 text-sm text-gray-500 font-medium">자동으로 작성 페이지로 이동합니다...</p>
          <div className="mt-5 w-full h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ animation: 'shrink 2s linear forwards', width: '100%' }} />
          </div>
          {errorMessage && (
            <p className="mt-4 text-sm font-bold text-red-600">{errorMessage}</p>
          )}
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
          <h1 className="text-3xl font-black tracking-tight text-stone-950">대기열 기능이 비활성화되어 있습니다</h1>
          <p className="mt-3 text-sm leading-relaxed text-stone-600">
            이 학교는 현재 대기열 없이 직접 신청을 받도록 설정되어 있습니다. 오픈 시간이 되면 바로 신청서를 작성할 수 있습니다.
          </p>
          <button
            onClick={startRegistration}
            disabled={!isOpen || starting}
            className="mt-6 flex w-full items-center justify-center rounded-2xl bg-stone-950 px-6 py-4 text-base font-bold text-white transition hover:-translate-y-0.5 hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-400"
          >
            {starting ? '신청 페이지 준비 중...' : isOpen ? '신청서 바로 작성하기' : '오픈 대기 중'}
            {isOpen && !starting && <ArrowRight className="ml-2 h-5 w-5" />}
          </button>
          <p className="mt-4 text-sm text-stone-500">오픈 시간: {openDateLabel}</p>
          {errorMessage && <p className="mt-4 text-sm font-semibold text-rose-600">{errorMessage}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-snu-gray px-4 py-6 text-snu-text sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-md">
          <div className="bg-snu-blue px-5 py-6 sm:px-8 sm:py-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex flex-col gap-5">
                <div className="flex items-start gap-4">
                  {(schoolId === 'seoul' || schoolConfig?.logoUrl) ? (
                    <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/20 bg-white p-2 shadow-sm">
                      <img 
                        src={schoolId === 'seoul' ? 'https://www.snu.ac.kr/webdata/uploads/kor/image/2022/09/snu_ui_download.png' : schoolConfig?.logoUrl} 
                        alt={schoolConfig?.name || 'SNU Logo'} 
                        className="h-full w-full object-contain" 
                      />
                    </div>
                  ) : (
                    <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg border border-white/20 bg-white/10">
                      <Ticket className="h-8 w-8 text-white" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.4em] text-white/70">SEOUL NATIONAL UNIVERSITY</p>
                    <h1 className="mt-2 text-3xl font-bold leading-tight text-white sm:text-4xl">{schoolConfig?.name || '서울대학교 행사 신청'}</h1>
                    <p className="mt-3 max-w-3xl text-sm leading-relaxed text-white/90 sm:text-base">{heroMessage}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-white/15 bg-white/5 p-4 text-white/90">
                    <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-white/60">PROGRAM INFO</p>
                    <button 
                      onClick={() => setShowProgramImage(true)}
                      className="mt-3 flex w-full items-center justify-center rounded-md bg-white/10 px-4 py-2 text-xs font-bold text-white transition hover:bg-white/20 border border-white/20 shadow-sm"
                    >
                      프로그램 보기
                    </button>
                    <p className="mt-2 text-[10px] text-white/40 leading-relaxed font-medium italic">* 행사 개요, 준비물, 유의사항 확인</p>
                  </div>
                  <div className="rounded-lg border border-white/15 bg-white/5 p-4 text-white/90">
                    <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-white/60">OPERATIONAL STANDARDS</p>
                    <div className="mt-2 grid gap-1 text-sm font-light">
                      <p>정규 신청: {regularCapacity.toLocaleString()}명</p>
                      <p>예비 접수: {waitlistCapacity.toLocaleString()}명</p>
                      <p>순차 입장: {batchSize.toLocaleString()}명 / {batchIntervalSeconds}초</p>
                      <p>작성 제한: 5분</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-full max-w-sm rounded-lg border border-white/10 bg-white/10 p-5 backdrop-blur-sm lg:ml-6">
                <p className="text-sm font-bold text-white/80">현재 상태</p>
                <p className="mt-2 text-2xl font-bold text-white tracking-tight">{queueSummary.title}</p>
                <p className="mt-3 text-sm leading-relaxed text-white/80">{queueSummary.description}</p>
                <div className={`mt-4 inline-flex items-center rounded-md border px-4 py-1.5 text-xs font-bold tracking-[0.2em] ${statusStyles[queueSummary.tone].badge}`}>
                  {queueSummary.tone === 'active' && 'OPEN'}
                  {queueSummary.tone === 'warning' && 'NOTICE'}
                  {queueSummary.tone === 'closed' && 'CLOSED'}
                </div>
                <div className="mt-5 rounded-md bg-white/10 p-4 border border-white/5">
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/60">오픈 시각</p>
                  <p className="mt-2 text-lg font-bold text-white">{openDateLabel}</p>
                  <p className="mt-3 text-xs text-white/70">
                    {!isOpen ? `입장 시작까지 ${countdownLabel} 남았습니다.` : '현재 현장 접수가 진행 중입니다.'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 border-t border-gray-100 bg-gray-50/50 p-5 sm:grid-cols-2 xl:grid-cols-4">
            {transparencyMetrics.map((metric) => (
              <StatCard
                key={metric.label}
                icon={metric.icon}
                label={metric.label}
                value={metric.value}
                helper={metric.helper}
              />
            ))}
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-6">
            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">MY STATUS</p>
                  <p className="mt-3 text-5xl font-bold tracking-tight text-snu-blue">{myNumber ?? '--'}</p>
                  <p className="mt-3 text-sm leading-relaxed text-gray-600 font-medium">{myStatusMessage}</p>
                </div>
                <div className="min-w-[112px] rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-right">
                  <p className="text-xs font-bold uppercase tracking-[0.1em] text-gray-400">WAITING</p>
                  <p className="mt-2 text-3xl font-bold text-gray-900">{waitingAhead}</p>
                  <p className="mt-1 text-xs text-gray-400 font-medium">EST. {estimatedWaitMinutes}분</p>
                </div>
              </div>

              <div className="mt-6 grid gap-3">
                {myNumber === null ? (
                  <button
                    onClick={joinQueue}
                    disabled={!isOpen || joining || queueSummary.remainingCapacity <= 0}
                    className="flex w-full items-center justify-center rounded-md bg-snu-blue px-6 py-4 text-base font-bold text-white transition-all hover:bg-snu-dark shadow-sm disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {joining ? '순번 요청 중...' : isOpen ? '대기열 입장하기' : '오픈 대기 중'}
                    {!joining && isOpen && queueSummary.remainingCapacity > 0 && <ArrowRight className="ml-2 h-5 w-5" />}
                  </button>
                ) : canEnter ? (
                  <button
                    onClick={startRegistration}
                    disabled={starting}
                    className="flex w-full items-center justify-center rounded-md bg-[#2d6a4f] px-6 py-4 text-base font-bold text-white transition-all hover:bg-[#1b4332] shadow-sm disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {starting ? '페이지 준비 중...' : '신청서 작성하러 가기'}
                    {!starting && <ArrowRight className="ml-2 h-5 w-5" />}
                  </button>
                ) : (
                  <button
                    disabled
                    className="w-full rounded-md border border-gray-200 bg-gray-100 px-6 py-4 text-sm font-bold text-gray-400"
                  >
                    아직 입장 순서가 아닙니다
                  </button>
                )}

                {schoolConfig?.buttonSettings?.showLookupButton && (
                  <Link
                    to={`/${schoolId}/lookup`}
                    className="flex w-full items-center justify-center rounded-md border border-gray-300 bg-white px-6 py-4 text-sm font-bold text-gray-700 transition hover:bg-gray-50 shadow-sm"
                  >
                    신청 내역 조회하기
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                )}
              </div>

              <div className={`mt-5 rounded-md border px-4 py-4 text-sm leading-relaxed font-medium ${statusStyles[queueSummary.tone].panel}`}>
                {queueSummary.remainingCapacity <= 0
                  ? '모집이 마감되었습니다. 취소 또는 미신청분이 발생할 경우 추가 기회가 열릴 수 있습니다.'
                  : canEnter
                    ? '입장 가능한 상태입니다. 5분 내로 작성을 시작하지 않으면 선착순 기회가 소멸됩니다.'
                    : isOpen
                      ? '본인의 순번과 실시간 현황이 반영됩니다. 현재 화면을 유지해 주시기 바랍니다.'
                      : '오픈 후에만 입장 신청이 가능합니다. 미리 클릭하여도 순번이 앞당겨지지 않습니다.'}
              </div>

              {errorMessage && <p className="mt-4 text-sm font-bold text-red-600">{errorMessage}</p>}
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-gray-100 text-gray-700">
                  <CircleDashed className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">TRANSPARENCY</p>
                  <h2 className="text-xl font-bold text-gray-900">실시간 운영 현황 안내</h2>
                </div>
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <MetricPanel
                  label="MY NUMBER"
                  value={myNumber ?? 0}
                  caption={myNumber === null ? '아직 순번을 부여받지 않았습니다.' : '귀하의 대기열 입장 순번입니다.'}
                  displayValue={myNumber === null ? '--' : myNumber.toLocaleString()}
                />
                <MetricPanel
                  label="현재 대기 인원"
                  value={queueSummary.waitingCount}
                  caption="이미 순번을 받았지만 아직 작성 차례가 오지 않은 인원"
                />
                <MetricPanel
                  label="남은 정규 신청"
                  value={remainingRegular}
                  caption="확정 완료 기준으로 계산한 잔여 인원"
                />
                <MetricPanel
                  label="남은 예비 접수"
                  value={remainingWaitlist}
                  caption="정규 신청 마감 후 예비 접수로 배정 가능한 인원"
                />
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-bold text-gray-500">
                <Clock3 className="h-4 w-4" />
                <span>OPEN COUNTDOWN</span>
              </div>
              <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 px-4 py-5 text-center">
                <p className="text-4xl font-bold tracking-tight text-snu-blue">{isOpen ? 'START' : countdownLabel}</p>
                <p className="mt-2 text-xs font-semibold text-gray-400">
                  {isOpen ? '현재 접수가 활발히 진행 중입니다.' : `${openDateLabel} 정시 오픈`}
                </p>
              </div>
            </section>

            <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-bold text-gray-900 border-b pb-3 border-gray-100">이용 규정 안내</h2>
              <div className="mt-4 space-y-3">
                {guidanceCards.map((item) => (
                  <div key={item.title} className="flex gap-3 rounded-md bg-gray-50/50 p-4 border border-gray-50">
                    <item.icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-snu-blue" />
                    <div>
                      <p className="text-sm font-bold text-gray-900">{item.title}</p>
                      <p className="mt-1 text-xs leading-relaxed text-gray-500 font-medium">{item.body}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <div className="pb-4 text-center text-[11px] font-bold tracking-[0.2em] text-gray-400 uppercase">
          &copy; {new Date().getFullYear()} SEOUL NATIONAL UNIVERSITY ADMISSIONS
        </div>
      </div>

      {showProgramImage && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4 transition-all duration-300 font-sans backdrop-blur-sm"
          onClick={() => setShowProgramImage(false)}
        >
          <div className="relative max-w-4xl w-full bg-white rounded-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-widest">Program Details</h3>
              <button 
                className="p-2 rounded-full text-gray-400 hover:text-gray-900 hover:bg-gray-100 transition-all"
                onClick={() => setShowProgramImage(false)}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto bg-gray-50/50 p-2 sm:p-4">
              {schoolConfig?.programImageUrl ? (
                <img 
                  src={schoolConfig.programImageUrl} 
                  alt="Program Details" 
                  className="w-full h-auto object-contain mx-auto shadow-sm"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="flex flex-col items-center justify-center h-64 text-gray-400 font-bold space-y-4">
                  <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                    <Info className="w-8 h-8 opacity-20" />
                  </div>
                  <p>등록된 프로그램 이미지가 없습니다.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
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
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-gray-50 text-snu-blue">
        {icon}
      </div>
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="mt-2 text-4xl font-bold tracking-tight text-gray-900">{value.toLocaleString()}</p>
      <p className="mt-2 text-xs leading-relaxed text-gray-400 font-medium">{helper}</p>
    </div>
  );
}

function MetricPanel({
  label,
  value,
  caption,
  displayValue
}: {
  label: string;
  value: number;
  caption: string;
  displayValue?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
      <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900">
        {displayValue || value.toLocaleString()}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-gray-500 font-medium">{caption}</p>
    </div>
  );
}
