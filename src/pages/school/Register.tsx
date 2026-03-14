import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { doc, runTransaction, collection, query, where, getDocs } from 'firebase/firestore';
import { ref, onValue, set } from 'firebase/database';
import { db, rtdb } from '../../firebase/config';
import { useSchool } from '../../contexts/SchoolContext';
import { Registration } from '../../types/models';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';

interface TermsAccordionProps {
  title: string;
  content: string;
  isOpen: boolean;
  onToggle: () => void;
  isChecked: boolean;
  onCheck: (checked: boolean) => void;
}

const TermsAccordion = ({ title, content, isOpen, onToggle, isChecked, onCheck }: TermsAccordionProps) => (
  <div className="border rounded mb-2">
    <div className="flex items-center p-3 bg-gray-50 cursor-pointer" onClick={onToggle}>
      <input 
        type="checkbox" 
        checked={isChecked} 
        onChange={(e) => { e.stopPropagation(); onCheck(e.target.checked); }}
        className="mr-3 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
      />
      <span className="font-medium flex-1 text-gray-700">{title}</span>
      <span className="text-gray-500">{isOpen ? '▲' : '▼'}</span>
    </div>
    {isOpen && <div className="p-3 text-sm text-gray-600 whitespace-pre-wrap border-t bg-white">{content || '내용이 없습니다.'}</div>}
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
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState(300); // 5분
  const [slotReserved, setSlotReserved] = useState(false);
  const [reservingSlot, setReservingSlot] = useState(true);
  const [openTerms, setOpenTerms] = useState<number | null>(null);
  const [termsAgreed, setTermsAgreed] = useState({ privacy: false, thirdParty: false, sms: false });
  const [submitting, setSubmitting] = useState(false);

  const { register, handleSubmit, formState: { errors } } = useForm<RegisterFormInputs>();

  // 1. 슬롯 예약 (페이지 진입 시)
  useEffect(() => {
    if (!schoolId) return;

    const reserveSlot = async () => {
      try {
        const functions = getFunctions();
        const reserveSlotFn = httpsCallable(functions, 'reserveSlot');

        // Generate userId from session token
        const token = localStorage.getItem(`sessionToken_${schoolId}`);
        if (!token) {
          alert("잘못된 접근입니다. 대기열부터 다시 시작해주세요.");
          navigate(`/${schoolId}/queue`);
          return;
        }

        const userId = `user_${token}`;
        const result: any = await reserveSlotFn({ schoolId, userId });

        if (result.data.success) {
          setSessionId(result.data.sessionId);
          setExpiresAt(result.data.expiresAt);
          setSlotReserved(true);
          setReservingSlot(false);

          // Calculate initial time left
          const initialTimeLeft = Math.max(0, Math.floor((result.data.expiresAt - Date.now()) / 1000));
          setTimeLeft(initialTimeLeft);
        } else {
          throw new Error('Slot reservation failed');
        }
      } catch (error: any) {
        console.error('[SlotReservation] Error:', error);
        setReservingSlot(false);

        const errorCode = error?.code || '';
        const errorMessage = error?.message || '';

        if (errorCode === 'functions/resource-exhausted') {
          alert(errorMessage || "죄송합니다. 정원이 마감되었습니다.");
          navigate(`/${schoolId}`);
        } else {
          alert("슬롯 예약 중 오류가 발생했습니다. 다시 시도해주세요.");
          navigate(`/${schoolId}/queue`);
        }
      }
    };

    reserveSlot();
  }, [schoolId, navigate]);

  // 2. 카운트다운 타이머
  useEffect(() => {
    if (!slotReserved || !sessionId) return;

    const timer = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));

      setTimeLeft(remaining);

      if (remaining <= 0) {
        clearInterval(timer);
        alert("입력 시간이 초과되었습니다. 대기열로 이동합니다.");
        localStorage.removeItem(`sessionToken_${schoolId}`);
        localStorage.removeItem(`sessionTokenExpires_${schoolId}`);
        navigate(`/${schoolId}/queue`);
      }
    }, 1000);

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(timer);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [slotReserved, sessionId, expiresAt, schoolId, navigate]);

  const handleAllAgree = (checked: boolean) => {
    setTermsAgreed({ privacy: checked, thirdParty: checked, sms: checked });
  };

  const onSubmit = async (data: RegisterFormInputs) => {
    if (!schoolConfig || !schoolId || !sessionId) return;

    if (!termsAgreed.privacy || !termsAgreed.thirdParty || !termsAgreed.sms) {
      alert("모든 약관에 동의해야 합니다.");
      return;
    }

    setSubmitting(true);

    try {
      const functions = getFunctions();
      const confirmReservationFn = httpsCallable(functions, 'confirmReservation');

      // Prepare registration data
      const formData = {
        schoolId,
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

      // Call confirmReservation (100% success since slot is reserved)
      const result: any = await confirmReservationFn({
        schoolId,
        sessionId,
        formData
      });

      if (result.data.success) {
        // Clean up session tokens after successful submission
        localStorage.removeItem(`sessionToken_${schoolId}`);
        localStorage.removeItem(`sessionTokenExpires_${schoolId}`);

        navigate(`/${schoolId}/complete`, { state: { status: 'confirmed' } });
      } else {
        throw new Error('Confirmation failed');
      }

    } catch (error: any) {
      console.error('[Registration] Error:', error);

      const errorCode = error?.code || '';
      const errorMessage = error?.message || '';

      if (errorCode === 'functions/deadline-exceeded') {
        alert(errorMessage || "세션이 만료되었습니다. 다시 시도해주세요.");
        localStorage.removeItem(`sessionToken_${schoolId}`);
        localStorage.removeItem(`sessionTokenExpires_${schoolId}`);
        navigate(`/${schoolId}/queue`);
      } else if (errorCode === 'functions/failed-precondition') {
        alert(errorMessage || "유효하지 않은 세션입니다.");
        navigate(`/${schoolId}/queue`);
      } else {
        alert("신청 처리 중 오류가 발생했습니다. 다시 시도해주세요.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // 시간에 따른 색상 반환
  const getTimeColor = () => {
    if (timeLeft > 180) return 'green'; // 3분 이상: 녹색
    if (timeLeft > 60) return 'yellow';  // 1~3분: 노란색
    return 'red'; // 1분 미만: 빨간색
  };

  // 로딩 상태
  if (reservingSlot) {
    return (
      <div className="max-w-2xl mx-auto p-4 md:p-8">
        <div className="bg-white p-8 rounded-lg shadow-lg border border-gray-200 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-lg font-semibold text-gray-700">슬롯을 예약하는 중입니다...</p>
          <p className="text-sm text-gray-500 mt-2">잠시만 기다려주세요.</p>
        </div>
      </div>
    );
  }

  if (!schoolConfig) return <div>Loading...</div>;

  const isAllAgreed = termsAgreed.privacy && termsAgreed.thirdParty && termsAgreed.sms;
  const timeColor = getTimeColor();

  const colorStyles = {
    green: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      text: 'text-green-700',
      bar: 'bg-green-500',
      icon: <CheckCircle2 className="w-6 h-6 text-green-600" />
    },
    yellow: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      text: 'text-yellow-700',
      bar: 'bg-yellow-500',
      icon: <Clock className="w-6 h-6 text-yellow-600" />
    },
    red: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-700',
      bar: 'bg-red-500',
      icon: <AlertTriangle className="w-6 h-6 text-red-600" />
    }
  };

  const currentStyle = colorStyles[timeColor];
  const progressPercent = (timeLeft / 300) * 100; // 5분 = 300초

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-8">
      {/* 상단 고정 카운트다운 바 */}
      <div className={`sticky top-0 z-50 ${currentStyle.bg} border-b-4 ${currentStyle.border} shadow-lg`}>
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-3">
              {currentStyle.icon}
              <div>
                <p className="text-sm font-semibold text-gray-700">남은 시간</p>
                <p className="text-xs text-gray-500">입력을 완료해주세요</p>
              </div>
            </div>
            <div className="text-right">
              <p className={`text-4xl font-bold ${currentStyle.text}`}>{formatTime(timeLeft)}</p>
              <p className="text-xs text-gray-500">5분 내 입력 필요</p>
            </div>
          </div>

          {/* 진행 바 */}
          <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
            <div
              className={`${currentStyle.bar} h-full transition-all duration-1000 ease-in-out`}
              style={{ width: `${progressPercent}%` }}
            ></div>
          </div>

          {/* 경고 메시지 */}
          {timeLeft <= 60 && (
            <div className="mt-2 flex items-center justify-center space-x-2 text-red-600">
              <AlertTriangle className="w-4 h-4" />
              <p className="text-sm font-semibold">1분 미만 남았습니다! 빨리 입력해주세요.</p>
            </div>
          )}
        </div>
      </div>

      <h1 className="text-2xl font-bold mb-2 text-center">신청 정보 입력</h1>
      <p className="text-center text-sm text-gray-600 mb-6">
        <span className="font-semibold text-blue-600">5분 내</span>에 입력을 �료해주세요
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* 필수 정보 - 최상단 배치 */}
        <div className="space-y-4 bg-white p-6 rounded-lg shadow-lg border-2 border-blue-200">
          <h2 className="text-lg font-semibold border-b-2 border-blue-200 pb-2 mb-4 text-blue-800">
            ⚡ 필수 정보 (먼저 입력하세요)
          </h2>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              이름 <span className="text-red-500">*</span>
            </label>
            <input
              {...register('studentName', { required: true })}
              className="block w-full border-2 border-gray-300 rounded-md p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
              placeholder="홍길동"
              autoFocus
            />
            {errors.studentName && <span className="text-red-500 text-sm mt-1 font-semibold">필수 입력입니다.</span>}
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">
              전화번호 <span className="text-red-500">*</span>
            </label>
            <input
              {...register('phone', { required: true, pattern: /^010-\d{4}-\d{4}$/ })}
              className="block w-full border-2 border-gray-300 rounded-md p-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-lg"
              placeholder="010-1234-5678"
            />
            {errors.phone && <span className="text-red-500 text-sm mt-1 font-semibold">010-0000-0000 형식을 지켜주세요.</span>}
            <p className="text-xs text-gray-500 mt-1">예: 010-1234-5678</p>
          </div>
        </div>

        <div className="space-y-4 bg-white p-6 rounded-lg shadow border border-gray-200">
          <h2 className="text-lg font-semibold border-b pb-2 mb-4 text-gray-800">
            추가 정보 (선택)
          </h2>
          
          {schoolConfig.formFields.collectStudentId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">학번</label>
              <input {...register('studentId')} className="block w-full border border-gray-300 rounded-md p-2.5 focus:ring-blue-500 focus:border-blue-500" placeholder="학번 (선택)" />
            </div>
          )}
          {schoolConfig.formFields.collectEmail && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">이메일</label>
              <input {...register('email')} type="email" className="block w-full border border-gray-300 rounded-md p-2.5 focus:ring-blue-500 focus:border-blue-500" placeholder="example@email.com" />
            </div>
          )}
          {schoolConfig.formFields.collectSchoolName && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">학교명</label>
              <input {...register('schoolName')} className="block w-full border border-gray-300 rounded-md p-2.5 focus:ring-blue-500 focus:border-blue-500" placeholder="재학 중인 학교" />
            </div>
          )}
          {schoolConfig.formFields.collectGrade && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">학년</label>
              <select {...register('grade')} className="block w-full border border-gray-300 rounded-md p-2.5 focus:ring-blue-500 focus:border-blue-500">
                <option value="">학년 선택</option>
                <option value="1">1학년</option>
                <option value="2">2학년</option>
                <option value="3">3학년</option>
                <option value="4">4학년</option>
              </select>
            </div>
          )}
          {schoolConfig.formFields.collectAddress && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">주소</label>
              <input {...register('address')} className="block w-full border border-gray-300 rounded-md p-2.5 focus:ring-blue-500 focus:border-blue-500" placeholder="기본 주소" />
            </div>
          )}
        </div>

        <div className="bg-white p-6 rounded-lg shadow border border-gray-200">
          <div className="flex items-center mb-4 border-b-2 border-gray-200 pb-3">
            <input
              type="checkbox"
              checked={isAllAgreed}
              onChange={(e) => handleAllAgree(e.target.checked)}
              className="h-5 w-5 text-blue-600 rounded border-gray-300 focus:ring-blue-500 mr-2"
            />
            <label className="font-bold text-lg text-gray-900 cursor-pointer" onClick={() => handleAllAgree(!isAllAgreed)}>
              약관 전체 동의
            </label>
          </div>

          <TermsAccordion 
            title="[필수] 개인정보 수집 및 이용 동의" 
            content={schoolConfig.terms.privacy.content} 
            isOpen={openTerms === 1}
            onToggle={() => setOpenTerms(openTerms === 1 ? null : 1)}
            isChecked={termsAgreed.privacy}
            onCheck={(val) => setTermsAgreed(prev => ({ ...prev, privacy: val }))}
          />
          <TermsAccordion 
            title="[필수] 개인정보 제3자 제공 동의" 
            content={schoolConfig.terms.thirdParty.content} 
            isOpen={openTerms === 2}
            onToggle={() => setOpenTerms(openTerms === 2 ? null : 2)}
            isChecked={termsAgreed.thirdParty}
            onCheck={(val) => setTermsAgreed(prev => ({ ...prev, thirdParty: val }))}
          />
          <TermsAccordion 
            title="[필수] 수신 동의" 
            content={schoolConfig.terms.sms.content} 
            isOpen={openTerms === 3}
            onToggle={() => setOpenTerms(openTerms === 3 ? null : 3)}
            isChecked={termsAgreed.sms}
            onCheck={(val) => setTermsAgreed(prev => ({ ...prev, sms: val }))}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className={`w-full py-4 rounded-lg text-white font-bold text-xl shadow-lg transition-all transform hover:scale-[1.01] active:scale-[0.99] ${
            submitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {submitting ? '처리 중...' : '신청하기'}
        </button>

        {/* 하단 안내 메시지 */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
          <p className="text-sm text-blue-800">
            <span className="font-semibold">💡 팁:</span> 이름과 전화번호를 먼저 입력한 후,
            나머지 정보는 빠르게 작성하실 수 있습니다.
          </p>
        </div>
      </form>
    </div>
  );
}
