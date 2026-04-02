import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock } from 'lucide-react';
import { useSchool } from '../../contexts/SchoolContext';
import { callCallableWithRetry, isTransientCallableError } from '../../lib/callable';
import { createRequestId } from '../../lib/requestId';
import { loadStoredQueueIdentity, markRecentQueueExpiry } from '../../lib/queue';

interface RegisterFormInputs {
  studentName: string;
  phone: string;
  email?: string;
  studentId?: string;
  schoolName?: string;
  grade?: string;
  address?: string;
}

interface ReservationSessionResponse {
  success?: boolean;
  expiresAt?: number;
  roundId?: string | null;
}

interface ConfirmReservationResponse {
  success?: boolean;
  status?: 'confirmed' | 'waitlisted';
}

interface TermsAccordionProps {
  title: string;
  content: string;
  isOpen: boolean;
  onToggle: () => void;
  isChecked: boolean;
  onCheck: (checked: boolean) => void;
}

const TermsAccordion = ({ title, content, isOpen, onToggle, isChecked, onCheck }: TermsAccordionProps) => (
  <div className={`mb-3 overflow-hidden rounded-lg border transition-all duration-200 ${isOpen ? 'border-snu-blue/30 shadow-sm' : 'border-gray-200 hover:border-snu-blue/20'}`}>
    <div
      className={`flex cursor-pointer select-none items-center p-4 transition-colors ${isOpen ? 'bg-snu-blue/5' : 'bg-gray-50/50 hover:bg-gray-50'}`}
      onClick={onToggle}
    >
      <div className="relative mr-3 flex items-center justify-center rounded-full" onClick={(event) => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(event) => onCheck(event.target.checked)}
          className="peer relative h-6 min-h-[24px] w-6 min-w-[24px] cursor-pointer appearance-none rounded-sm border-2 border-gray-300 transition-all checked:border-snu-blue checked:bg-snu-blue focus:outline-none focus:ring-2 focus:ring-snu-blue/30 focus:ring-offset-1"
        />
        <svg className="pointer-events-none absolute h-3 w-3 text-white opacity-0 transition-opacity peer-checked:opacity-100" viewBox="0 0 14 10" fill="none">
          <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="flex-1 text-sm font-bold text-gray-800">{title}</span>
      <span className="text-gray-400">
        <ChevronDown className={`h-5 w-5 transform transition-transform duration-200 ${isOpen ? 'rotate-180 text-snu-blue' : ''}`} />
      </span>
    </div>
    {isOpen && (
      <div className="max-h-48 overflow-y-auto whitespace-pre-wrap border-t border-gray-100 bg-white p-4 text-base leading-relaxed text-gray-700">
        {content || '내용이 없습니다.'}
      </div>
    )}
  </div>
);

const SUBMIT_GRACE_MS = 90 * 1000;

export default function RegisterPage() {
  const { schoolId } = useParams<{ schoolId: string }>();
  const { schoolConfig } = useSchool();
  const navigate = useNavigate();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState(0);
  const [sessionDuration, setSessionDuration] = useState(180);
  const [timeLeft, setTimeLeft] = useState(180);
  const [slotReserved, setSlotReserved] = useState(false);
  const [reservingSlot, setReservingSlot] = useState(true);
  const [openTerms, setOpenTerms] = useState<number | null>(null);
  const [termsAgreed, setTermsAgreed] = useState({ privacy: false, thirdParty: false, sms: false });
  const [submitting, setSubmitting] = useState(false);
  const [expiredToast, setExpiredToast] = useState(false);
  const [softNotice, setSoftNotice] = useState<string | null>(null);
  const [softNoticeTone, setSoftNoticeTone] = useState<'info' | 'error'>('info');

  const navigatingRef = useRef(false);
  const expireRequestIdRef = useRef<string | null>(null);
  const confirmRequestIdRef = useRef<string | null>(null);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors }
  } = useForm<RegisterFormInputs>();

  useEffect(() => {
    if (!schoolId) return;

    const validateSession = async () => {
      try {
        const storedSessionId = localStorage.getItem(`registrationSessionId_${schoolId}`);
        if (!storedSessionId) {
          navigate(`/${schoolId}/gate`);
          return;
        }

        const getReservationSessionFn = httpsCallable<
          { schoolId: string; sessionId: string },
          ReservationSessionResponse
        >(getFunctions(), 'getReservationSession');
        const result = await callCallableWithRetry(
          getReservationSessionFn,
          { schoolId, sessionId: storedSessionId },
          {
            maxAttempts: 4,
            getDelayMs: ({ attempt }) => 800 + Math.floor(Math.random() * 800) + (attempt - 1) * 1600
          }
        );

        if (!result.data?.success) {
          throw new Error('Registration session is invalid.');
        }

        setSessionId(storedSessionId);
        setExpiresAt(result.data.expiresAt);
        setSlotReserved(true);
        setReservingSlot(false);

        const activeRoundId = typeof result.data.roundId === 'string' ? result.data.roundId : null;
        if (activeRoundId) {
          const storedIdentity = loadStoredQueueIdentity(schoolId, activeRoundId);
          if (storedIdentity) {
            setValue('studentName', storedIdentity.studentName);
            setValue('phone', storedIdentity.phone);
          }
        }

        const remaining = Math.max(0, Math.floor((result.data.expiresAt - Date.now()) / 1000));
        setSessionDuration(remaining || 180);
        setTimeLeft(remaining);
      } catch (error) {
        console.error('[ReservationSession] Error:', error);
        setReservingSlot(false);
        localStorage.removeItem(`registrationSessionId_${schoolId}`);
        localStorage.removeItem(`registrationExpiresAt_${schoolId}`);
        setSoftNoticeTone('error');
        setSoftNotice('신청 가능 상태를 확인하지 못했습니다. 대기열 화면으로 다시 안내해 드릴게요.');
        window.setTimeout(() => navigate(`/${schoolId}/gate`), 1200);
      }
    };

    void validateSession();
  }, [navigate, schoolId, setValue]);

  useEffect(() => {
    if (!slotReserved || !sessionId || !schoolId) {
      return;
    }

      const handleExpired = () => {
        if (navigatingRef.current) return;

      navigatingRef.current = true;
      localStorage.removeItem(`registrationSessionId_${schoolId}`);
      localStorage.removeItem(`registrationExpiresAt_${schoolId}`);
      markRecentQueueExpiry(schoolId);
      setExpiredToast(true);

      try {
        const functions = getFunctions();
        if (!expireRequestIdRef.current) {
          expireRequestIdRef.current = createRequestId('forceExpire');
        }

        void httpsCallable(functions, 'forceExpireSession')({
          schoolId,
          sessionId,
          requestId: expireRequestIdRef.current
        }).catch(() => {});
      } catch {
        // Ignore cleanup errors when the session has already expired.
      }

      window.setTimeout(() => navigate(`/${schoolId}/gate`), 2500);
    };

      const tick = () => {
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) {
          if (submitting && now <= expiresAt + SUBMIT_GRACE_MS) {
            setSoftNoticeTone('info');
            setSoftNotice('제출을 처리 중입니다. 응답이 돌아올 때까지 이 화면을 닫지 말아 주세요.');
            return;
          }
          handleExpired();
        }
      };

    const timer = window.setInterval(tick, 1000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        tick();
      }
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [expiresAt, navigate, schoolId, sessionId, slotReserved, submitting]);

  const handleAllAgree = (checked: boolean) => {
    setTermsAgreed({ privacy: checked, thirdParty: checked, sms: checked });
  };

  const onSubmit = async (data: RegisterFormInputs) => {
    if (!schoolConfig || !schoolId || !sessionId) {
      return;
    }

    if (!termsAgreed.privacy || !termsAgreed.thirdParty || !termsAgreed.sms) {
      setSoftNoticeTone('error');
      setSoftNotice('필수 약관에 모두 동의해 주셔야 신청을 완료할 수 있습니다.');
      return;
    }

    setSubmitting(true);
    if (!confirmRequestIdRef.current) {
      confirmRequestIdRef.current = createRequestId('confirmReservation');
    }

    try {
      const confirmReservationFn = httpsCallable<
        {
          schoolId: string;
          sessionId: string;
          formData: {
            studentName: string;
            phone: string;
            phoneLast4: string;
            email: string | null;
            studentId: string | null;
            schoolName: string | null;
            grade: string | null;
            address: string | null;
            agreedSms: boolean;
          };
          requestId: string | null;
        },
        ConfirmReservationResponse
      >(getFunctions(), 'confirmReservation');
      const formData = {
        studentName: data.studentName,
        phone: data.phone,
        phoneLast4: data.phone.split('-').pop() || '',
        email: data.email || null,
        studentId: data.studentId || null,
        schoolName: data.schoolName || null,
        grade: data.grade || null,
        address: data.address || null,
        agreedSms: true
      };

      const result = await callCallableWithRetry(
        confirmReservationFn,
        {
          schoolId,
          sessionId,
          formData,
          requestId: confirmRequestIdRef.current
        },
        {
          maxAttempts: 5,
          shouldRetry: (error) => isTransientCallableError(error),
          getDelayMs: ({ attempt }) => 1200 + Math.floor(Math.random() * 1200) + (attempt - 1) * 2200
        }
      );

      if (!result.data?.success) {
        throw new Error('Confirmation failed');
      }

      localStorage.removeItem(`registrationSessionId_${schoolId}`);
      localStorage.removeItem(`registrationExpiresAt_${schoolId}`);
      navigate(`/${schoolId}/complete`, { state: { status: result.data.status || 'confirmed' } });
    } catch (error: any) {
      confirmRequestIdRef.current = null;
      console.error('[Registration] Error:', error);

      if (error?.code === 'functions/deadline-exceeded') {
        localStorage.removeItem(`registrationSessionId_${schoolId}`);
        localStorage.removeItem(`registrationExpiresAt_${schoolId}`);
        setSoftNoticeTone('error');
        setSoftNotice('입력 시간이 만료되었습니다. 대기열 화면으로 다시 안내해 드릴게요.');
        navigate(`/${schoolId}/gate`);
      } else if (error?.code === 'functions/failed-precondition') {
        setSoftNoticeTone('error');
        setSoftNotice('현재 신청을 진행할 수 없는 상태입니다. 대기열에서 다시 확인해 주세요.');
        navigate(`/${schoolId}/gate`);
      } else if (error?.code === 'functions/already-exists') {
        setSoftNoticeTone('error');
        setSoftNotice('이미 같은 연락처로 접수된 신청 내역이 있습니다. 신청 조회 화면에서 상태를 확인해 주세요.');
      } else {
        setSoftNoticeTone('error');
        setSoftNotice(error?.message || '신청 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secondsLeft = seconds % 60;
    return `${minutes}:${secondsLeft.toString().padStart(2, '0')}`;
  };

  const timeColor = useMemo<'green' | 'yellow' | 'red'>(() => {
    if (timeLeft > 120) return 'green';
    if (timeLeft > 60) return 'yellow';
    return 'red';
  }, [timeLeft]);

  if (expiredToast) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-snu-gray p-4">
        <div className="w-full max-w-sm rounded-lg border border-gray-100 bg-white p-8 text-center shadow-md">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-amber-100 bg-amber-50">
            <Clock className="h-8 w-8 text-amber-500" />
          </div>
          <h3 className="text-xl font-bold text-gray-900">입력 시간이 만료되었습니다.</h3>
          <p className="mt-2 text-sm font-medium text-gray-400">대기열 화면으로 이동합니다.</p>
          <div className="mt-5 h-1 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full w-full animate-[shrink_2.5s_linear_forwards] bg-amber-400" />
          </div>
        </div>
      </div>
    );
  }

  if (softNotice) {
    const noticeStyle =
      softNoticeTone === 'error'
        ? {
            panel: 'border-rose-100 bg-rose-50',
            iconWrap: 'border-rose-200 bg-rose-100',
            icon: 'text-rose-500'
          }
        : {
            panel: 'border-amber-100 bg-amber-50',
            iconWrap: 'border-amber-100 bg-amber-50',
            icon: 'text-amber-500'
          };

    return (
      <div className="flex min-h-screen items-center justify-center bg-snu-gray p-4">
        <div className={`w-full max-w-sm rounded-lg border p-8 text-center shadow-md ${noticeStyle.panel}`}>
          <div className={`mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border ${noticeStyle.iconWrap}`}>
            <AlertTriangle className={`h-8 w-8 ${noticeStyle.icon}`} />
          </div>
          <h3 className="text-xl font-bold text-gray-900">안내</h3>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">{softNotice}</p>
        </div>
      </div>
    );
  }

  if (reservingSlot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-snu-gray p-4">
        <div className="w-full max-w-sm rounded-lg border border-gray-100 bg-white p-8 text-center shadow-md sm:p-10">
          <div className="relative mx-auto mb-6 h-16 w-16">
            <div className="absolute inset-0 rounded-full border-4 border-gray-100" />
            <div className="absolute inset-0 animate-spin rounded-full border-4 border-snu-blue border-t-transparent" />
          </div>
          <h3 className="text-xl font-bold tracking-tight text-gray-900">신청 가능 상태를 확인하고 있습니다</h3>
          <p className="mt-2 text-sm font-medium uppercase tracking-widest text-gray-400">CONNECTING TO SNU...</p>
        </div>
      </div>
    );
  }

  if (!schoolConfig) {
    return null;
  }

  const isAllAgreed = termsAgreed.privacy && termsAgreed.thirdParty && termsAgreed.sms;
  const progressPercent = Math.max(0, Math.min(100, (timeLeft / Math.max(sessionDuration, 1)) * 100));

  const colorStyles = {
    green: {
      bg: 'border-emerald-100 bg-emerald-50 text-emerald-700',
      bar: 'bg-emerald-500',
      icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />,
      text: 'text-emerald-700'
    },
    yellow: {
      bg: 'border-amber-100 bg-amber-50 text-amber-700',
      bar: 'bg-amber-500',
      icon: <Clock className="h-5 w-5 text-amber-600" />,
      text: 'text-amber-700'
    },
    red: {
      bg: 'border-red-100 bg-red-50 text-red-700',
      bar: 'bg-red-500',
      icon: <AlertTriangle className="h-5 w-5 text-red-600" />,
      text: 'text-red-700'
    }
  } as const;

  const currentStyle = colorStyles[timeColor];

  return (
    <div className="flex min-h-screen flex-col items-center bg-snu-gray font-sans tracking-tight">
      <div className="sticky top-0 z-50 w-full border-b border-gray-100 bg-white/95 shadow-sm backdrop-blur-xl transition-colors duration-300">
        <div className="h-1 w-full overflow-hidden bg-gray-100/50">
          <div className={`${currentStyle.bar} h-full transition-all duration-1000 ease-linear`} style={{ width: `${progressPercent}%` }} />
        </div>

        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 sm:py-4">
          <div className="flex items-center space-x-3">
            <div className={`rounded-lg border bg-white p-2 shadow-sm ${currentStyle.bg}`}>
              {currentStyle.icon}
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400">RESERVED TIME</p>
              <p className="text-[11px] font-bold text-gray-900 sm:text-xs">
                {timeLeft <= 60 ? (
                  <span className="flex items-center text-red-600 transition-all duration-500 animate-pulse">
                    <AlertTriangle className="mr-0.5 h-3 w-3" />
                    마감 시간이 얼마 남지 않았습니다.
                  </span>
                ) : (
                  '지정된 시간 안에 제출을 완료해 주세요.'
                )}
              </p>
            </div>
          </div>

          <div className={`text-right text-2xl font-bold tracking-tighter tabular-nums sm:text-3xl ${currentStyle.text}`}>
            {formatTime(timeLeft)}
          </div>
        </div>
      </div>

      <div className="w-full max-w-2xl animate-fade-in-up px-4 py-8 sm:py-10">
        <div className="mb-10 text-center">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.3em] text-snu-blue">Registration Form</p>
          <h1 className="mb-2 text-2xl font-bold text-gray-900 sm:text-3xl">행사 참가 신청서 작성</h1>
          <p className="text-sm font-medium text-gray-400">안내된 정보를 확인한 뒤 정확한 내용을 입력해 주세요.</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="relative overflow-hidden rounded-lg border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
            <div className="absolute left-0 top-0 h-1 w-full bg-snu-blue" />
            <h2 className="mb-6 flex items-center text-lg font-bold text-gray-900">
              <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-md bg-snu-blue text-[10px] font-bold uppercase text-white shadow-sm">01</span>
              신청자 기본 정보
            </h2>
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-gray-600">
                  신청자 이름 <span className="font-normal text-red-500">*</span>
                </label>
                <input
                  {...register('studentName', { required: true })}
                  className="block min-h-[56px] w-full rounded-md border border-gray-100 bg-gray-50/50 p-4 text-base font-bold text-gray-900 outline-none transition-all placeholder:font-normal placeholder:text-gray-400 focus:border-snu-blue focus:bg-white focus:ring-1 focus:ring-snu-blue"
                  placeholder="신청자 성함을 입력해 주세요"
                  autoFocus
                />
                {errors.studentName && (
                  <span className="mt-2 flex items-center text-sm font-bold tracking-tight text-red-500">
                    <AlertTriangle className="mr-1.5 h-4 w-4" />
                    이름을 입력해 주세요.
                  </span>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-gray-600">
                  휴대전화 번호 <span className="font-normal text-red-500">*</span>
                </label>
                <input
                  {...register('phone', { required: true, pattern: /^010\d{8}$/ })}
                  className="block min-h-[56px] w-full rounded-md border border-gray-100 bg-gray-50/50 p-4 font-mono text-base tracking-widest text-gray-900 outline-none transition-all placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-gray-400 focus:border-snu-blue focus:bg-white focus:ring-1 focus:ring-snu-blue"
                  placeholder="01000000000 숫자만 입력해 주세요"
                  inputMode="numeric"
                />
                {errors.phone && (
                  <span className="mt-2 flex items-center text-sm font-bold tracking-tight text-red-500">
                    <AlertTriangle className="mr-1.5 h-4 w-4" />
                    010으로 시작하는 11자리 숫자를 입력해 주세요.
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="mb-6 flex items-center text-lg font-bold text-gray-900">
              <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-md border border-gray-100 bg-gray-50 text-[10px] font-bold uppercase text-gray-400">02</span>
              추가 수집 정보
            </h2>

            <div className="space-y-5">
              {schoolConfig.formFields.collectStudentId && (
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-gray-600">학번</label>
                  <input
                    {...register('studentId')}
                    className="block min-h-[56px] w-full rounded-md border border-gray-100 bg-gray-50/50 p-4 text-base font-medium transition-all focus:border-snu-blue focus:bg-white focus:ring-1 focus:ring-snu-blue"
                    placeholder="해당하는 경우 입력해 주세요"
                  />
                </div>
              )}

              {schoolConfig.formFields.collectEmail && (
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-gray-600">이메일 주소</label>
                  <input
                    {...register('email')}
                    type="email"
                    className="block min-h-[56px] w-full rounded-md border border-gray-100 bg-gray-50/50 p-4 text-base font-medium transition-all focus:border-snu-blue focus:bg-white focus:ring-1 focus:ring-snu-blue"
                    placeholder="example@snu.ac.kr"
                  />
                </div>
              )}

              {schoolConfig.formFields.collectSchoolName && (
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-gray-600">학교명</label>
                  <input
                    {...register('schoolName')}
                    className="block min-h-[56px] w-full rounded-md border border-gray-100 bg-gray-50/50 p-4 text-base font-medium transition-all focus:border-snu-blue focus:bg-white focus:ring-1 focus:ring-snu-blue"
                    placeholder="현재 재학 중인 학교명을 입력해 주세요"
                  />
                </div>
              )}

              {schoolConfig.formFields.collectGrade && (
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-gray-600">학년</label>
                  <select
                    {...register('grade')}
                    className="block min-h-[56px] w-full rounded-md border border-gray-100 bg-gray-50/50 p-4 text-base font-medium text-gray-700 outline-none transition-all focus:border-snu-blue focus:bg-white focus:ring-1 focus:ring-snu-blue"
                  >
                    <option value="">학년을 선택해 주세요</option>
                    {schoolConfig.formFields.gradeOptions && schoolConfig.formFields.gradeOptions.length > 0 ? (
                      schoolConfig.formFields.gradeOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))
                    ) : (
                      <>
                        <option value="1">1학년</option>
                        <option value="2">2학년</option>
                        <option value="3">3학년</option>
                        <option value="4">4학년 이상</option>
                      </>
                    )}
                  </select>
                </div>
              )}

              {schoolConfig.formFields.collectAddress && (
                <div>
                  <label className="mb-2 block text-sm font-bold uppercase tracking-wider text-gray-600">주소</label>
                  <input
                    {...register('address')}
                    className="block min-h-[56px] w-full rounded-md border border-gray-100 bg-gray-50/50 p-4 text-base font-medium transition-all focus:border-snu-blue focus:bg-white focus:ring-1 focus:ring-snu-blue"
                    placeholder="상세 주소를 포함해 입력해 주세요"
                  />
                </div>
              )}

              {!schoolConfig.formFields.collectStudentId &&
                !schoolConfig.formFields.collectEmail &&
                !schoolConfig.formFields.collectSchoolName &&
                !schoolConfig.formFields.collectGrade &&
                !schoolConfig.formFields.collectAddress && (
                  <p className="py-2 text-base font-medium text-gray-500">추가로 수집하는 정보가 없습니다.</p>
                )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
            <h2 className="mb-6 flex items-center text-lg font-bold text-gray-900">
              <span className="mr-2 flex h-6 w-6 items-center justify-center rounded-md border border-gray-100 bg-gray-50 text-[10px] font-bold uppercase text-gray-400">03</span>
              이용 약관 동의
            </h2>

            <div
              className="mb-6 flex cursor-pointer items-center rounded-lg border border-snu-blue/10 bg-snu-blue/5 p-4 transition-colors hover:bg-snu-blue/10"
              onClick={() => handleAllAgree(!isAllAgreed)}
            >
              <div className="relative mr-3 flex items-center justify-center rounded-full">
                <input
                  type="checkbox"
                  checked={isAllAgreed}
                  onChange={(event) => handleAllAgree(event.target.checked)}
                  onClick={(event) => event.stopPropagation()}
                  className="peer relative h-6 w-6 appearance-none rounded-md border-2 border-snu-blue/30 transition-all checked:border-snu-blue checked:bg-snu-blue outline-none"
                />
                <svg className="pointer-events-none absolute h-4 w-4 text-white opacity-0 transition-opacity peer-checked:opacity-100" viewBox="0 0 14 10" fill="none">
                  <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <label className="cursor-pointer select-none text-lg font-bold text-snu-blue">필수 약관 전체 동의</label>
            </div>

            <div className="space-y-0 text-gray-800">
              <TermsAccordion
                title={schoolConfig.terms.privacy.title || '[필수] 개인정보 수집 및 이용 동의'}
                content={schoolConfig.terms.privacy.content}
                isOpen={openTerms === 1}
                onToggle={() => setOpenTerms(openTerms === 1 ? null : 1)}
                isChecked={termsAgreed.privacy}
                onCheck={(value) => setTermsAgreed((previous) => ({ ...previous, privacy: value }))}
              />
              <TermsAccordion
                title={schoolConfig.terms.thirdParty.title || '[필수] 개인정보 제3자 제공 동의'}
                content={schoolConfig.terms.thirdParty.content}
                isOpen={openTerms === 2}
                onToggle={() => setOpenTerms(openTerms === 2 ? null : 2)}
                isChecked={termsAgreed.thirdParty}
                onCheck={(value) => setTermsAgreed((previous) => ({ ...previous, thirdParty: value }))}
              />
              <TermsAccordion
                title={schoolConfig.terms.sms.title || '[필수] 알림 수신 동의'}
                content={schoolConfig.terms.sms.content}
                isOpen={openTerms === 3}
                onToggle={() => setOpenTerms(openTerms === 3 ? null : 3)}
                isChecked={termsAgreed.sms}
                onCheck={(value) => setTermsAgreed((previous) => ({ ...previous, sms: value }))}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={`min-h-[56px] w-full rounded-2xl py-5 text-lg font-bold text-white shadow-sm transition-all duration-300 sm:text-xl ${
              submitting
                ? 'cursor-not-allowed bg-gray-300 shadow-none'
                : 'bg-snu-blue hover:bg-snu-dark hover:shadow-md focus:ring-4 focus:ring-snu-blue/20'
            }`}
          >
            {submitting ? (
              <span className="flex items-center justify-center text-base tracking-widest">
                <div className="mr-3 h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                처리 중입니다...
              </span>
            ) : (
              '참가 신청서 제출'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
