import React, { useEffect, useMemo, useState } from 'react';
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FirebaseError } from 'firebase/app';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, Ticket, Users, X } from 'lucide-react';
import { auth, db, functions } from '../firebase/config';
import { useSchool } from '../contexts/SchoolContext';
import {
  clearRecentQueueExpiry,
  getRecentQueueCompletion,
  getRecentQueueExpiry,
  getQueueUserId,
  isSameQueueIdentity,
  loadStoredQueueIdentity,
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
  if (typeof error !== 'object' || error === null) return null;
  const directDetails = 'details' in error ? (error as { details?: unknown }).details : undefined;
  if (directDetails && typeof directDetails === 'object') return directDetails as CallableErrorDetails;
  return null;
}

function getCallableErrorMessage(error: unknown, fallback: string) {
  const details = getCallableErrorDetails(error);
  if (details?.message) return details.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return fallback;
}

function shouldApplyJoinCooldown(error: unknown) {
  const code = getCallableErrorCode(error);
  const details = getCallableErrorDetails(error);
  if (code === 'functions/already-exists' || code === 'functions/invalid-argument' || code === 'functions/failed-precondition') return false;
  if (details?.reason === 'QUEUE_CLOSED' || details?.reason === 'CAPACITY_FULL' || details?.isFull) return false;
  return true;
}

export default function SmartQueueGate() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const { schoolConfig } = useSchool();
  const navigate = useNavigate();

  const [queueState, setQueueState] = useState<QueueState>({
    currentNumber: 0, lastAssignedNumber: 0, activeReservationCount: 0,
    maxActiveSessions: 60, confirmedCount: 0, waitlistedCount: 0,
    totalCapacity: 0, availableCapacity: 0, updatedAt: 0
  });
  const [myEntry, setMyEntry] = useState<QueueEntry | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [starting, setStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [joinCooldownUntil, setJoinCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [selectedRoundId, setSelectedRoundId] = useState<string>('round1');
  const [queueIdentity, setQueueIdentity] = useState<QueueIdentityInput>({ studentName: '', phone: '' });
  const [identityHydrated, setIdentityHydrated] = useState(false);
  const [closedRounds, setClosedRounds] = useState<Record<string, JoinClosureState>>({});


  const queueEnabled = schoolConfig?.queueSettings?.enabled !== false;
  const rounds = normalizeAdmissionRounds(schoolConfig);
  const currentRound = getCurrentAdmissionRound(schoolConfig, now);
  
  const selectedRound = useMemo(() => {
    if (schoolConfig?.forceActiveRound) {
      return rounds.find(r => r.id === schoolConfig.forceActiveRound) || currentRound || rounds[0];
    }
    return rounds.find((r) => r.id === selectedRoundId) || currentRound || rounds[0];
  }, [schoolConfig?.forceActiveRound, rounds, selectedRoundId, currentRound]);

  const maxActiveSessions = schoolConfig?.queueSettings?.maxActiveSessions || queueState.maxActiveSessions || 60;
  const regularCapacity = selectedRound?.maxCapacity || schoolConfig?.maxCapacity || 0;
  const waitlistCapacity = selectedRound?.waitlistCapacity || schoolConfig?.waitlistCapacity || 0;
  const totalCapacity = regularCapacity + waitlistCapacity;
  const openTimeMs = selectedRound?.openDateTime ? new Date(selectedRound.openDateTime).getTime() : 0;
  const isOpen = !!openTimeMs && now >= openTimeMs;
  const openDateLabel = formatDateLabel(openTimeMs);
  const countdownParts = getCountdownParts(Math.max(0, openTimeMs - now));
  const gateHeadline = schoolConfig?.heroMessage?.trim() || '오픈 시간에 버튼을 눌러 대기번호를 받고, 순서가 되면 신청서를 작성합니다.';
  const programInfo = schoolConfig?.programInfo?.trim() || '행사 개요, 준비물, 유의사항은 아래 프로그램 안내 영역에서 바로 확인하실 수 있습니다.';

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
    return errorMessage;
  }, [errorMessage]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => setUserId(user?.uid ?? null));
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!schoolId || !userId) return;
    const queueStateDocId = selectedRound?.id || 'round1';
    const unsubscribe = onSnapshot(doc(db, 'schools', schoolId, 'queueState', queueStateDocId),
      (snapshot) => {
        const data = snapshot.data();
        if (data) {
          setQueueState({
            currentNumber: data.currentNumber || 0,
            lastAssignedNumber: data.lastAssignedNumber || 0,
            activeReservationCount: data.activeReservationCount || 0,
            maxActiveSessions: data.maxActiveSessions || 60,
            confirmedCount: data.confirmedCount || 0,
            waitlistedCount: data.waitlistedCount || 0,
            totalCapacity: data.totalCapacity || totalCapacity,
            availableCapacity: data.availableCapacity ?? totalCapacity,
            updatedAt: data.updatedAt || 0
          });
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsubscribe();
  }, [schoolId, totalCapacity, selectedRound?.id, userId]);

  useEffect(() => {
    if (!schoolId || !userId) return;
    const unsubscribe = onSnapshot(doc(db, 'schools', schoolId, 'queueEntries', userId),
      (snapshot) => {
        const data = snapshot.data();
        setMyEntry(data && (!selectedRound?.id || data.roundId === selectedRound.id) ? {
          roundId: data.roundId,
          roundLabel: data.roundLabel ?? null,
          number: data.number ?? null,
          status: data.status,
          activeReservationId: data.activeReservationId ?? null
        } : null);
      }
    );
    return () => unsubscribe();
  }, [schoolId, userId, selectedRound?.id]);

  const myNumber = myEntry?.number ?? null;
  const canEnter = myEntry?.status === 'eligible' && myNumber !== null && !suppressCompletedAutoEntry;
  const waitingAhead = myEntry?.status === 'eligible' ? 0 : myNumber ? Math.max(0, myNumber - queueState.currentNumber - 1) : 0;
  const isNearTurnWaiting = myEntry?.status === 'waiting' && myNumber !== null && waitingAhead === 0;
  const showLookupButton = !!schoolConfig?.buttonSettings?.showLookupButton && !(myEntry?.status === 'waiting' || myEntry?.status === 'eligible');
  const estimatedWaitMinutes = waitingAhead > 0 ? Math.max(1, Math.ceil((waitingAhead / Math.max(maxActiveSessions, 1)) * 3)) : 0;
  const remainingRegular = Math.max(0, regularCapacity - Math.min(queueState.confirmedCount, regularCapacity));
  const remainingWaitlist = Math.max(0, waitlistCapacity - Math.min(queueState.waitlistedCount, waitlistCapacity));
  const completedCount = queueState.confirmedCount + queueState.waitlistedCount;
  const waitingCount = Math.max(0, queueState.lastAssignedNumber - queueState.currentNumber);
  const remainingCapacity = Math.max(0, queueState.totalCapacity - completedCount);
  const queueJoinLimit = Math.max(1, Math.ceil(getAdmissionRoundTotal(selectedRound) * 1.5));
  const closedRoundState = selectedRound?.id ? closedRounds[selectedRound.id] : undefined;
  const queueLimitReached = !myEntry && (Boolean(closedRoundState?.reason) || queueState.lastAssignedNumber >= queueJoinLimit);
  
  const selectedRoundStatusLabel = !isOpen ? '오픈 전' : remainingCapacity <= 0 || queueLimitReached ? '접수 마감' : '접수 진행 중';
  const waitingDisplayValue = myNumber === null ? '-' : waitingAhead.toLocaleString();
  const waitingDisplayHelper = myNumber === null ? '대기번호를 받으면 여기에 표시됩니다.' : waitingAhead > 0 ? `예상 대기 시간 약 ${estimatedWaitMinutes}분입니다.` : canEnter ? '지금 바로 입장할 수 있습니다.' : '순차를 확인하고 있습니다.';

  const myStatusMessage = useMemo(() => {
    if (!isOpen) return `${selectedRound?.label || '선택한 차수'} 접수는 아직 시작되지 않았습니다.`;
    if (myEntry?.status === 'expired') return '작성 시간이 초과되었습니다. 다시 번호를 받아야 합니다.';
    if (myNumber === null) return remainingCapacity <= 0 ? '현재 마감되었습니다.' : '버튼을 눌러 대기번호를 받으세요.';
    if (canEnter) return '지금 신청서를 작성할 수 있습니다.';
    return `내 앞에 ${waitingAhead}명이 대기 중입니다.`;
  }, [canEnter, isOpen, myEntry?.status, myNumber, remainingCapacity, selectedRound?.label, waitingAhead]);

  async function joinQueue() {
    if (!schoolId || joining || !isOpen || joinCooldownActive || !queueIdentityReady) return;
    setJoining(true);
    setErrorMessage(null);
    try {
      const joinQueueFn = httpsCallable<any, JoinQueueResponse>(functions, 'joinQueue');
      const result = await joinQueueFn({
        schoolId, roundId: selectedRound?.id,
        requestId: createRequestId('joinQueue'),
        queueIdentity: { studentName: queueIdentity.studentName.trim(), phone: normalizedQueuePhone }
      });
      if (result.data && selectedRound?.id) {
        saveStoredQueueIdentity(schoolId, selectedRound.id, { studentName: queueIdentity.studentName.trim(), phone: normalizedQueuePhone });
      }
    } catch (error: any) {
      setErrorMessage(getCallableErrorMessage(error, '대기열 입장에 실패했습니다.'));
    } finally {
      setJoining(false);
    }
  }

  async function startRegistration() {
    if (!schoolId || starting || !isOpen) return;
    setStarting(true);
    try {
      const startFn = httpsCallable<any, StartRegistrationResponse>(functions, 'startRegistrationSession');
      const result = await startFn({ schoolId, roundId: myEntry?.roundId || selectedRound?.id, requestId: createRequestId('startRegistration') });
      if (result.data?.success) {
        localStorage.setItem(`registrationSessionId_${schoolId}`, result.data.sessionId!);
        window.location.assign(`/${schoolId}/register`);
      }
    } catch (error: any) {
      setErrorMessage(getCallableErrorMessage(error, '입장에 실패했습니다.'));
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 flex-col">
        {schoolConfig?.emergencyNotice?.enabled && (
          <div className="w-full bg-rose-600 text-white p-4 font-bold text-center fixed top-0"><AlertTriangle className="inline mr-2 h-5 w-5" /> {schoolConfig.emergencyNotice.message}</div>
        )}
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pt-16">
      {schoolConfig?.emergencyNotice?.enabled && (
        <div className="bg-rose-600 text-white p-4 font-bold text-center fixed top-0 w-full z-50"><AlertTriangle className="inline mr-2 h-5 w-5" /> {schoolConfig.emergencyNotice.message}</div>
      )}
      
      <main className="mx-auto w-full max-w-lg px-4 py-8 space-y-6">
        <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
          {schoolConfig?.logoUrl && <img src={schoolConfig.logoUrl} alt="Logo" className="h-12 mx-auto mb-4" />}
          <h1 className="text-2xl font-bold text-center text-gray-900">{schoolConfig?.name}</h1>
          <p className="text-gray-500 text-center mt-2 text-sm whitespace-pre-line">{gateHeadline}</p>
        </section>

        <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 grid grid-cols-2 gap-4">
          <InfoTile label="대기 번호" value={myNumber ?? '--'} helper="나의 번호" />
          <InfoTile label="대기 인원" value={waitingDisplayValue} helper={waitingDisplayHelper} />
        </section>

        <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 space-y-4">
          <p className="text-sm font-medium text-gray-700">{myStatusMessage}</p>
          
          {(!myEntry || myEntry.status === 'expired') && (
            <div className="space-y-4">
              <input value={queueIdentity.studentName} onChange={(e) => setQueueIdentity(p => ({ ...p, studentName: e.target.value }))} placeholder="이름" className="w-full border rounded-xl p-3" />
              <input value={queueIdentity.phone} onChange={(e) => setQueueIdentity(p => ({ ...p, phone: e.target.value }))} placeholder="연락처" className="w-full border rounded-xl p-3" />
              <button onClick={joinQueue} disabled={joining || !isOpen || remainingCapacity <= 0} className="w-full bg-blue-600 text-white rounded-xl py-4 font-bold disabled:bg-gray-300">
                {joining ? '입장 중...' : '대기열 입장'}
              </button>
            </div>
          )}

          {canEnter && (
            <button onClick={startRegistration} disabled={starting} className="w-full bg-emerald-600 text-white rounded-xl py-4 font-bold">
              {starting ? '이동 중...' : '지금 바로 신청하기'}
            </button>
          )}

          {showLookupButton && (
            <Link to={`/${schoolId}/lookup`} className="block w-full text-center py-4 border rounded-xl text-gray-600 font-bold">신청 내역 조회</Link>
          )}
        </section>

        <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
          <h2 className="font-bold text-gray-900 mb-4">현재 운영 현황</h2>
          <div className="grid grid-cols-2 gap-4">
            <MetricCard label="확정 잔여" value={remainingRegular} />
            <MetricCard label="예비 잔여" value={remainingWaitlist} />
          </div>
        </section>
      </main>
    </div>
  );
}

function InfoTile({ label, value, helper }: any) {
  return (
    <div className="bg-gray-50 rounded-2xl p-4 text-center">
      <p className="text-xs text-gray-400 font-bold uppercase">{label}</p>
      <p className="text-2xl font-black mt-1 text-gray-900">{value}</p>
      <p className="text-[10px] text-gray-400 mt-1">{helper}</p>
    </div>
  );
}

function MetricCard({ label, value }: any) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <p className="text-xl font-bold text-gray-900 mt-1">{value?.toLocaleString()}</p>
    </div>
  );
}
