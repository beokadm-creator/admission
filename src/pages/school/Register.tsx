import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useSchool } from '../../contexts/SchoolContext';
import { AlertTriangle, Clock, CheckCircle2, ChevronDown } from 'lucide-react';
import { createRequestId } from '../../lib/requestId';

interface TermsAccordionProps {
  title: string;
  content: string;
  isOpen: boolean;
  onToggle: () => void;
  isChecked: boolean;
  onCheck: (checked: boolean) => void;
}

const TermsAccordion = ({ title, content, isOpen, onToggle, isChecked, onCheck }: TermsAccordionProps) => (
  <div className={`border rounded-lg mb-3 overflow-hidden transition-all duration-200 ${isOpen ? 'border-snu-blue/30 shadow-sm' : 'border-gray-200 hover:border-snu-blue/20'}`}>
    <div className={`flex items-center p-4 cursor-pointer select-none transition-colors ${isOpen ? 'bg-snu-blue/5' : 'bg-gray-50/50 hover:bg-gray-50'}`} onClick={onToggle}>
      <div className="relative flex items-center justify-center rounded-full mr-3" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={isChecked}
          onChange={(e) => onCheck(e.target.checked)}
          className="peer relative appearance-none w-5 h-5 border-2 border-gray-300 rounded-sm cursor-pointer transition-all checked:border-snu-blue checked:bg-snu-blue focus:outline-none focus:ring-2 focus:ring-snu-blue/30 focus:ring-offset-1"
        />
        <svg className="absolute w-3 h-3 text-white pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" viewBox="0 0 14 10" fill="none">
          <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <span className="font-bold text-sm flex-1 text-gray-800">{title}</span>
      <span className="text-gray-400">
        <ChevronDown className={`w-5 h-5 transform transition-transform duration-200 ${isOpen ? 'rotate-180 text-snu-blue' : ''}`} />
      </span>
    </div>
    {isOpen && (
      <div className="p-4 text-[13px] leading-relaxed text-gray-600 whitespace-pre-wrap border-t border-gray-100 bg-white max-h-48 overflow-y-auto">
        {content || '내용이 없습니다.'}
      </div>
    )}
  </div>
);

interface RegisterFormInputs {
  studentName: string;
  phone: string;
  email?: string;
  studentId?: string;
  schoolName?: string;
  grade?: string;
  address?: string;
}

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
  const navigatingRef = useRef(false);
  const expireRequestIdRef = useRef<string | null>(null);
  const confirmRequestIdRef = useRef<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterFormInputs>();

  useEffect(() => {
    if (!schoolId) {
      return;
    }

    const validateSession = async () => {
      try {
        const storedSessionId = localStorage.getItem(`registrationSessionId_${schoolId}`);
        if (!storedSessionId) {
          navigate(`/${schoolId}`);
          return;
        }

        const functions = getFunctions();
        const getReservationSessionFn = httpsCallable(functions, 'getReservationSession');
        // userId는 서버에서 context.auth.uid로 처리
        const result: any = await getReservationSessionFn({ schoolId, sessionId: storedSessionId });

        if (!result.data?.success) {
          throw new Error('Registration session is invalid.');
        }

        setSessionId(storedSessionId);
        setExpiresAt(result.data.expiresAt);
        setSlotReserved(true);
        setReservingSlot(false);
        const remaining = Math.max(0, Math.floor((result.data.expiresAt - Date.now()) / 1000));
        setSessionDuration(remaining);
        setTimeLeft(remaining);
      } catch (error: any) {
        console.error('[ReservationSession] Error:', error);
        setReservingSlot(false);
        localStorage.removeItem(`registrationSessionId_${schoolId}`);
        localStorage.removeItem(`registrationExpiresAt_${schoolId}`);
        setSoftNotice('?? ?? ??? ?????? ???? ?? ?????. ??? ???? ?????.');
        window.setTimeout(() => navigate(`/${schoolId}/gate`), 1200);
      }
    };

    validateSession();
  }, [schoolId, navigate]);

  useEffect(() => {
    if (!slotReserved || !sessionId || !schoolId) {
      return;
    }

    const handleExpired = () => {
      if (navigatingRef.current) return;
      navigatingRef.current = true;
      localStorage.removeItem(`registrationSessionId_${schoolId}`);
      localStorage.removeItem(`registrationExpiresAt_${schoolId}`);
      setExpiredToast(true);

      // 서버에 만료 알림 → 슬롯 반환 + 대기열 entry 삭제 보장
      if (sessionId) {
        try {
          const fns = getFunctions();
          if (!expireRequestIdRef.current) {
            expireRequestIdRef.current = createRequestId('forceExpire');
          }
          httpsCallable(fns, 'forceExpireSession')({ schoolId, sessionId, requestId: expireRequestIdRef.current }).catch(() => {});
        } catch {
          /* 이미 만료되었을 수 있으므로 무시 */
        }
      }

      setTimeout(() => navigate(`/${schoolId}/gate`), 2500);
    };

    const tick = () => {
      const remaining = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) handleExpired();
    };

    const timer = setInterval(tick, 1000);

    // iOS Safari 백그라운드 복귀 시 타이머가 지연되는 문제 대응:
    // 앱 전환 후 돌아왔을 때 즉시 만료 여부를 재확인합니다.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [slotReserved, sessionId, expiresAt, schoolId, navigate]);

  const handleAllAgree = (checked: boolean) => {
    setTermsAgreed({ privacy: checked, thirdParty: checked, sms: checked });
  };

  const onSubmit = async (data: RegisterFormInputs) => {
    if (!schoolConfig || !schoolId || !sessionId) {
      return;
    }

    if (!termsAgreed.privacy || !termsAgreed.thirdParty || !termsAgreed.sms) {
      alert('모든 약관에 동의해야 합니다.');
      return;
    }

    setSubmitting(true);
    if (!confirmRequestIdRef.current) {
      confirmRequestIdRef.current = createRequestId('confirmReservation');
    }

    try {
      const functions = getFunctions();
      const confirmReservationFn = httpsCallable(functions, 'confirmReservation');

      // userId는 서버에서 context.auth.uid로 처리, 클라이언트 전달 불필요
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

      const result: any = await confirmReservationFn({
        schoolId,
        sessionId,
        formData,
        requestId: confirmRequestIdRef.current
      });

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
        setSoftNotice('?? ??? ???????. ?? ???? ??? ???.');
        navigate(`/${schoolId}/gate`);
      } else if (error?.code === 'functions/failed-precondition') {
        setSoftNotice('??? ??? ?? ??? ????. ??? ???? ?????.');
        navigate(`/${schoolId}/gate`);
      } else if (error?.code === 'functions/already-exists') {
        alert('이미 동일한 전화번호로 신청된 내역이 있습니다. 신청 조회 페이지에서 확인해주세요.');
      } else {
        alert(error?.message || '신청 처리 중 오류가 발생했습니다. 다시 시도해주세요.');
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

  const getTimeColor = () => {
    if (timeLeft > 120) return 'green';
    if (timeLeft > 60) return 'yellow';
    return 'red';
  };

  if (expiredToast) {
    return (
      <div className="min-h-screen bg-snu-gray flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow-md border border-gray-100 text-center max-w-sm w-full">
          <div className="w-16 h-16 mx-auto mb-5 flex items-center justify-center rounded-full bg-amber-50 border border-amber-100">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
          <h3 className="text-xl font-bold text-gray-900">입력 순서가 만료되었습니다</h3>
          <p className="text-sm text-gray-400 mt-2 font-medium">메인 페이지로 이동합니다...</p>
          <div className="mt-5 w-full h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 animate-[shrink_2.5s_linear_forwards]" style={{ width: '100%' }} />
          </div>
        </div>
      </div>
    );
  }

  if (softNotice) {
    return (
      <div className="min-h-screen bg-snu-gray flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-lg shadow-md border border-gray-100 text-center max-w-sm w-full">
          <div className="w-16 h-16 mx-auto mb-5 flex items-center justify-center rounded-full bg-amber-50 border border-amber-100">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
          </div>
          <h3 className="text-xl font-bold text-gray-900">안내</h3>
          <p className="mt-3 text-sm leading-relaxed text-gray-500">{softNotice}</p>
        </div>
      </div>
    );
  }

  if (reservingSlot) {
    return (
      <div className="min-h-screen bg-snu-gray flex items-center justify-center p-4">
        <div className="bg-white p-8 sm:p-10 rounded-lg shadow-md border border-gray-100 text-center max-w-sm w-full">
          <div className="relative w-16 h-16 mx-auto mb-6">
            <div className="absolute inset-0 border-4 border-gray-100 rounded-full"></div>
            <div className="absolute inset-0 border-4 border-snu-blue rounded-full border-t-transparent animate-spin"></div>
          </div>
          <h3 className="text-xl font-bold text-gray-900 tracking-tight">작성 권한을 확인하고 있습니다</h3>
          <p className="text-sm text-gray-400 font-medium mt-2 uppercase tracking-widest">CONNECTING TO SNU...</p>
        </div>
      </div>
    );
  }

  if (!schoolConfig) {
    return null;
  }

  const isAllAgreed = termsAgreed.privacy && termsAgreed.thirdParty && termsAgreed.sms;
  const timeColor = getTimeColor();
  const colorStyles = {
    green: {
      bg: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      bar: 'bg-emerald-500',
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" />,
      text: 'text-emerald-700'
    },
    yellow: {
      bg: 'bg-amber-50 text-amber-700 border-amber-100',
      bar: 'bg-amber-500',
      icon: <Clock className="w-5 h-5 text-amber-600" />,
      text: 'text-amber-700'
    },
    red: {
      bg: 'bg-red-50 text-red-700 border-red-100',
      bar: 'bg-red-500',
      icon: <AlertTriangle className="w-5 h-5 text-red-600" />,
      text: 'text-red-700'
    }
  };

  const currentStyle = colorStyles[timeColor];
  const progressPercent = (timeLeft / sessionDuration) * 100;

  return (
    <div className="min-h-screen bg-snu-gray flex flex-col items-center font-sans tracking-tight">
      <div className="sticky top-0 z-50 w-full backdrop-blur-xl bg-white/95 border-b border-gray-100 shadow-sm transition-colors duration-300">
        <div className="h-1 w-full bg-gray-100/50 overflow-hidden">
          <div className={`${currentStyle.bar} h-full transition-all duration-1000 ease-linear`} style={{ width: `${progressPercent}%` }}></div>
        </div>

        <div className="max-w-2xl mx-auto px-4 py-3 sm:py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg bg-white border border-gray-100 shadow-sm ${currentStyle.bg.split(' ')[2]}`}>
              {currentStyle.icon}
            </div>
            <div>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">RESERVED TIME</p>
              <p className="text-[11px] sm:text-xs font-bold text-gray-900">
                {timeLeft <= 60 ? (
                  <span className="text-red-600 animate-pulse flex items-center transition-all duration-500"><AlertTriangle className="w-3 h-3 mr-0.5" /> 시간이 얼마 남지 않았습니다</span>
                ) : '지정된 시간 내에 제출을 완료해 주십시오'}
              </p>
            </div>
          </div>

          <div className="text-right">
            <div className={`text-2xl sm:text-3xl font-bold tabular-nums tracking-tighter ${currentStyle.text}`}>
              {formatTime(timeLeft)}
            </div>
          </div>
        </div>
      </div>

      <div className="w-full max-w-2xl px-4 py-8 sm:py-10 animate-fade-in-up">
        <div className="text-center mb-10">
          <p className="text-snu-blue font-bold text-xs uppercase tracking-[0.3em] mb-2">Registration Form</p>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">행사 참가 신청서 작성</h1>
          <p className="text-sm text-gray-400 font-medium">서울대학교 입학본부에서 주관하는 행사의 정보를 정확히 입력해 주세요.</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="bg-white p-6 sm:p-8 rounded-lg shadow-sm border border-gray-100 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-snu-blue"></div>
            <h2 className="text-lg font-bold text-gray-900 flex items-center mb-6">
              <span className="w-6 h-6 rounded-md bg-snu-blue text-white flex items-center justify-center text-[10px] mr-2 shadow-sm uppercase font-bold">01</span>
              신청자 인적사항
            </h2>
            <div className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">신청자(학부모) 성명 <span className="text-red-500 font-normal">*</span></label>
                <input
                  {...register('studentName', { required: true })}
                  className="block w-full border border-gray-100 rounded-md p-3.5 bg-gray-50/50 focus:bg-white focus:ring-1 focus:ring-snu-blue focus:border-snu-blue transition-all font-bold text-gray-900 outline-none placeholder:text-gray-300 placeholder:font-normal"
                  placeholder="신청자 실명 입력"
                  autoFocus
                />
                {errors.studentName && <span className="text-red-500 text-[11px] mt-2 font-bold flex items-center uppercase tracking-tighter"><AlertTriangle className="w-3 h-3 mr-1" />이름은 필수 항목입니다.</span>}
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">휴대폰 번호 <span className="text-red-500 font-normal">*</span></label>
                <input
                  {...register('phone', { 
                    required: true, 
                    pattern: /^010\d{8}$/ 
                  })}
                  className="block w-full border border-gray-100 rounded-md p-3.5 bg-gray-50/50 focus:bg-white focus:ring-1 focus:ring-snu-blue focus:border-snu-blue transition-all font-mono tracking-widest text-gray-900 outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-gray-300 placeholder:font-normal"
                  placeholder="01000000000 (숫자만 입력)"
                />
                {errors.phone && <span className="text-red-500 text-[11px] mt-2 font-bold flex items-center uppercase tracking-tighter"><AlertTriangle className="w-3 h-3 mr-1" />올바른 휴대폰 번호를 입력해주세요 (010으로 시작하는 11자리 숫자).</span>}
              </div>
            </div>
          </div>

          <div className="bg-white p-6 sm:p-8 rounded-lg shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 flex items-center mb-6">
              <span className="w-6 h-6 rounded-md bg-gray-50 text-gray-400 border border-gray-100 flex items-center justify-center text-[10px] mr-2 font-bold uppercase">02</span>
              추가 수집 정보
            </h2>

            <div className="space-y-5">
              {schoolConfig.formFields.collectStudentId && (
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">학번</label>
                  <input {...register('studentId')} className="block w-full border border-gray-100 rounded-md p-3.5 bg-gray-50/50 focus:bg-white focus:ring-1 focus:ring-snu-blue focus:border-snu-blue transition-all font-medium" placeholder="해당 시 입력" />
                </div>
              )}
              {schoolConfig.formFields.collectEmail && (
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">이메일 주소</label>
                  <input {...register('email')} type="email" className="block w-full border border-gray-100 rounded-md p-3.5 bg-gray-50/50 focus:bg-white focus:ring-1 focus:ring-snu-blue focus:border-snu-blue transition-all font-medium" placeholder="example@snu.ac.kr" />
                </div>
              )}
              {schoolConfig.formFields.collectSchoolName && (
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">소속 학교명</label>
                  <input {...register('schoolName')} className="block w-full border border-gray-100 rounded-md p-3.5 bg-gray-50/50 focus:bg-white focus:ring-1 focus:ring-snu-blue focus:border-snu-blue transition-all font-medium" placeholder="재학 중인 학교명" />
                </div>
              )}
              {schoolConfig.formFields.collectGrade && (
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">학년</label>
                  <select {...register('grade')} className="block w-full border border-gray-100 rounded-md p-3.5 bg-gray-50/50 focus:bg-white focus:ring-1 focus:ring-snu-blue focus:border-snu-blue transition-all text-gray-700 outline-none font-medium">
                    <option value="">소속 차시/학년 선택</option>
                    {schoolConfig.formFields.gradeOptions && schoolConfig.formFields.gradeOptions.length > 0 ? (
                      schoolConfig.formFields.gradeOptions.map(option => (
                        <option key={option} value={option}>{option}</option>
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
                  <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-2">거주지 주소</label>
                  <input {...register('address')} className="block w-full border border-gray-100 rounded-md p-3.5 bg-gray-50/50 focus:bg-white focus:ring-1 focus:ring-snu-blue focus:border-snu-blue transition-all font-medium" placeholder="상세 주소 포함" />
                </div>
              )}
              {!schoolConfig.formFields.collectStudentId && !schoolConfig.formFields.collectEmail && !schoolConfig.formFields.collectSchoolName && !schoolConfig.formFields.collectGrade && !schoolConfig.formFields.collectAddress && (
                <p className="text-sm text-gray-400 font-medium py-2">추가로 수집하는 정보가 없습니다.</p>
              )}
            </div>
          </div>

          <div className="bg-white p-6 sm:p-8 rounded-lg shadow-sm border border-gray-100">
            <h2 className="text-lg font-bold text-gray-900 flex items-center mb-6">
              <span className="w-6 h-6 rounded-md bg-gray-50 text-gray-400 border border-gray-100 flex items-center justify-center text-[10px] mr-2 font-bold uppercase">03</span>
              이용 약관 동의
            </h2>

            <div className="flex items-center mb-6 p-4 rounded-lg border border-snu-blue/10 bg-snu-blue/5 cursor-pointer hover:bg-snu-blue/10 transition-colors" onClick={() => handleAllAgree(!isAllAgreed)}>
              <div className="relative flex items-center justify-center rounded-full mr-3">
                <input
                  type="checkbox"
                  checked={isAllAgreed}
                  onChange={(e) => handleAllAgree(e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                  className="peer relative appearance-none w-6 h-6 border-2 border-snu-blue/30 rounded-md cursor-pointer transition-all checked:border-snu-blue checked:bg-snu-blue outline-none"
                />
                <svg className="absolute w-4 h-4 text-white pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity" viewBox="0 0 14 10" fill="none">
                  <path d="M1 5L4.5 8.5L13 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <label className="font-bold text-lg text-snu-blue cursor-pointer select-none">필수 약관 전체 동의</label>
            </div>

            <div className="space-y-0 text-gray-800">
              <TermsAccordion
                title="[필수] 개인정보 수집 및 이용 동의"
                content={schoolConfig.terms.privacy.content}
                isOpen={openTerms === 1}
                onToggle={() => setOpenTerms(openTerms === 1 ? null : 1)}
                isChecked={termsAgreed.privacy}
                onCheck={(value) => setTermsAgreed((prev) => ({ ...prev, privacy: value }))}
              />
              <TermsAccordion
                title="[필수] 개인정보 제3자 제공 동의"
                content={schoolConfig.terms.thirdParty.content}
                isOpen={openTerms === 2}
                onToggle={() => setOpenTerms(openTerms === 2 ? null : 2)}
                isChecked={termsAgreed.thirdParty}
                onCheck={(value) => setTermsAgreed((prev) => ({ ...prev, thirdParty: value }))}
              />
              <TermsAccordion
                title="[필수] 알림 수신 동의"
                content={schoolConfig.terms.sms.content}
                isOpen={openTerms === 3}
                onToggle={() => setOpenTerms(openTerms === 3 ? null : 3)}
                isChecked={termsAgreed.sms}
                onCheck={(value) => setTermsAgreed((prev) => ({ ...prev, sms: value }))}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={`w-full py-5 rounded-md text-white font-bold text-lg sm:text-xl transition-all duration-300 shadow-sm ${
              submitting ? 'bg-gray-300 cursor-not-allowed shadow-none' : 'bg-snu-blue hover:bg-snu-dark hover:shadow-md focus:ring-4 focus:ring-snu-blue/20'
            }`}
          >
            {submitting ? (
              <span className="flex items-center justify-center uppercase tracking-widest text-sm">
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-3"></div>
                Processing...
              </span>
            ) : '참가 신청서 제출'}
          </button>
        </form>
      </div>
    </div>
  );
}
