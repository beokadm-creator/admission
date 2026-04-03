import React, { useState } from 'react';
import type { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { AlertCircle, CheckCircle2, ChevronLeft, Clock, Search, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { functions } from '../../firebase/config';
import { useSchool } from '../../contexts/SchoolContext';

interface RegistrationResult {
  id: string;
  studentName: string;
  phone: string;
  status: 'confirmed' | 'waitlisted' | 'canceled';
  rank?: number | null;
  submittedAt: number;
  updatedAt: number;
}

interface LookupRegistrationResponse {
  registration?: RegistrationResult | null;
}

interface ServiceAccessResponse {
  accessUrl?: string;
}

function getErrorDetails(error: unknown) {
  return error as FirebaseError | undefined;
}

export default function LookupPage() {
  const { schoolConfig } = useSchool();
  const navigate = useNavigate();
  const [applicantName, setApplicantName] = useState('');
  const [phoneLast4, setPhoneLast4] = useState('');
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<'success' | 'error'>('success');

  const handleLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!schoolConfig) return;

    setLoading(true);
    setError('');
    setFeedbackMessage(null);
    setResult(null);

    try {
      const lookupFn = httpsCallable<
        { schoolId: string; studentName: string; phoneLast4: string },
        LookupRegistrationResponse
      >(functions, 'lookupRegistration');
      const response = await lookupFn({
        schoolId: schoolConfig.id,
        studentName: applicantName.trim(),
        phoneLast4: phoneLast4.trim()
      });

      if (response.data?.registration) {
        setResult(response.data.registration);
      } else {
        setError('일치하는 신청 내역이 없습니다. 입력하신 정보를 다시 확인해 주십시오.');
      }
    } catch (lookupError: unknown) {
      console.error(lookupError);
      if (getErrorDetails(lookupError)?.code === 'functions/not-found') {
        setError('일치하는 신청 내역이 없습니다. 입력하신 정보를 다시 확인해 주십시오.');
      } else {
        setError(getErrorDetails(lookupError)?.message || '조회 중 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!result || !schoolConfig) return;

    const confirmed = window.confirm(
      '정말로 신청을 취소하시겠습니까?\n취소 후에는 되돌릴 수 없으며, 다음 대기자에게 기회가 양보됩니다.'
    );
    if (!confirmed) return;

    setCanceling(true);
    try {
      const cancelFn = httpsCallable<
        { schoolId: string; registrationId: string; studentName: string; phoneLast4: string },
        { success?: boolean }
      >(functions, 'cancelRegistration');
      await cancelFn({
        schoolId: schoolConfig.id,
        registrationId: result.id,
        studentName: applicantName.trim(),
        phoneLast4: phoneLast4.trim()
      });

      setResult((previous) => (previous ? { ...previous, status: 'canceled' } : null));
      setFeedbackTone('success');
      setFeedbackMessage('신청이 정상적으로 취소되었습니다.');
    } catch (cancelError: unknown) {
      console.error(cancelError);
      setFeedbackTone('error');
      setFeedbackMessage(getErrorDetails(cancelError)?.message || '취소 처리 중 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setCanceling(false);
    }
  };

  const handleServiceAccess = async () => {
    if (!result || !schoolConfig) return;

    setServiceLoading(true);
    try {
      const accessFn = httpsCallable<
        { schoolId: string; registrationId: string; studentName: string; phoneLast4: string },
        ServiceAccessResponse
      >(functions, 'getServiceAccessLink');
      const response = await accessFn({
        schoolId: schoolConfig.id,
        registrationId: result.id,
        studentName: applicantName.trim(),
        phoneLast4: phoneLast4.trim()
      });

      const accessUrl = response.data?.accessUrl;
      if (!accessUrl) {
        throw new Error('이동할 서비스 URL이 설정되지 않았습니다.');
      }

      window.location.href = accessUrl;
    } catch (serviceError: unknown) {
      console.error(serviceError);
      setFeedbackTone('error');
      setFeedbackMessage(getErrorDetails(serviceError)?.message || '서비스 이동 중 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setServiceLoading(false);
    }
  };

  if (!schoolConfig) return null;

  return (
    <div className="min-h-screen bg-snu-gray px-4 py-8 font-sans tracking-tight sm:py-12">
      <div className="mx-auto w-full max-w-lg">
        <button
          onClick={() => navigate(`/${schoolConfig.id}/gate`)}
          className="mb-8 inline-flex items-center text-xs font-bold text-gray-400 transition-colors hover:text-snu-blue uppercase tracking-widest"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back to Gate
        </button>

        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-lg border border-gray-100 bg-white shadow-sm">
            <Search className="h-7 w-7 text-snu-blue" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">신청 내역 조회</h1>
          <p className="mt-3 text-base leading-relaxed text-gray-500 font-medium">
            신청 시 입력한 정확한 정보로 현재 상태를 확인하실 수 있습니다.
          </p>
        </div>

        <div className="mb-6 rounded-lg border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
          <form onSubmit={handleLookup} className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-bold text-gray-500 uppercase tracking-wider">신청자 성명</label>
              <input
                type="text"
                value={applicantName}
                onChange={(event) => setApplicantName(event.target.value)}
                className="block w-full rounded-md border border-gray-100 bg-gray-50/50 p-3.5 text-base font-bold transition-all focus:border-snu-blue focus:bg-white focus:ring-1 focus:ring-snu-blue outline-none"
                placeholder="홍길동"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-bold text-gray-500 uppercase tracking-wider">휴대폰 번호 뒤 4자리</label>
              <input
                type="text"
                value={phoneLast4}
                onChange={(event) => setPhoneLast4(event.target.value.replace(/\D/g, '').slice(0, 4))}
                className="block w-full rounded-md border border-gray-100 bg-gray-50/50 p-3.5 text-base tracking-[0.4em] font-bold transition-all focus:border-snu-blue focus:bg-white focus:ring-1 focus:ring-snu-blue outline-none"
                placeholder="0000"
                inputMode="numeric"
                maxLength={4}
                pattern="\d{4}"
                required
              />
              <p className="mt-2 text-[13px] text-gray-400 font-medium">
                예: 010-0000-<span className="text-snu-blue font-bold">5678</span>인 경우 5678을 입력해 주십시오.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[56px] rounded-md bg-snu-blue py-4 text-base font-bold text-white shadow-sm transition-all hover:bg-snu-dark disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {loading ? '검색 중입니다...' : '신청 내역 조회'}
            </button>
          </form>
        </div>

        {error && (
          <div className="mb-6 flex items-start rounded-xl border border-red-100 bg-red-50 p-4">
            <AlertCircle className="mr-3 mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm font-medium leading-relaxed text-red-800">{error}</p>
          </div>
        )}

        {feedbackMessage && (
          <div
            className={`mb-6 flex items-start rounded-xl border p-4 ${
              feedbackTone === 'success' ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50'
            }`}
          >
            <AlertCircle
              className={`mr-3 mt-0.5 h-5 w-5 shrink-0 ${
                feedbackTone === 'success' ? 'text-emerald-600' : 'text-amber-600'
              }`}
            />
            <p
              className={`text-sm font-medium leading-relaxed ${
                feedbackTone === 'success' ? 'text-emerald-800' : 'text-amber-800'
              }`}
            >
              {feedbackMessage}
            </p>
          </div>
        )}

        {result && (
          <div className="rounded-lg border border-gray-100 bg-white p-6 shadow-md sm:p-8">
            <h2 className="mb-6 flex items-center justify-between border-b border-gray-100 pb-4 text-xs font-bold text-gray-400 uppercase tracking-widest">
              <span>Result Found</span>
              {result.status === 'confirmed' && (
                <span className="inline-flex items-center rounded border border-snu-blue/20 bg-snu-blue/5 px-3 py-1 text-[10px] font-bold text-snu-blue">
                  <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                  CONFIRMED
                </span>
              )}
              {result.status === 'waitlisted' && (
                <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-bold text-amber-600">
                  <Clock className="mr-1.5 h-3.5 w-3.5" />
                  WAITLISTED
                </span>
              )}
              {result.status === 'canceled' && (
                <span className="inline-flex items-center rounded border border-gray-200 bg-gray-50 px-3 py-1 text-[10px] font-bold text-gray-400">
                  <XCircle className="mr-1.5 h-3.5 w-3.5" />
                  CANCELED
                </span>
              )}
            </h2>

            <dl className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-sm text-gray-500">신청자명</dt>
                <dd className="text-base font-semibold text-gray-900">{result.studentName}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-sm text-gray-500">연락처</dt>
                <dd className="text-base font-semibold text-gray-900">{result.phone}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-sm text-gray-500">신청 일시</dt>
                <dd className="text-sm font-medium text-gray-900">
                  {format(result.submittedAt, 'yyyy. MM. dd. a hh:mm')
                    .replace('AM', '오전')
                    .replace('PM', '오후')}
                </dd>
              </div>

              {result.status === 'waitlisted' && (
                <div className="mt-6 flex items-center justify-between rounded-xl border border-amber-100 bg-amber-50 p-4">
                  <div>
                    <dt className="text-sm font-semibold text-amber-800">현재 예비 순번</dt>
                    <p className="mt-1 text-xs text-amber-600">취소 또는 만료가 발생하면 순차적으로 승급됩니다.</p>
                  </div>
                  <dd className="text-2xl font-black text-amber-600">
                    {result.rank ?? '-'}
                    {result.rank ? <span className="ml-1 text-lg font-bold">번</span> : null}
                  </dd>
                </div>
              )}
            </dl>

            {schoolConfig.buttonSettings.showCancelButton &&
              (result.status === 'confirmed' || result.status === 'waitlisted') && (
                <div className="mt-8 border-t border-gray-50 pt-6">
                  <button
                    onClick={handleCancel}
                    disabled={canceling}
                    className="w-full min-h-[56px] rounded-md border border-gray-200 bg-white py-3.5 text-base font-bold text-gray-500 transition-all hover:border-red-100 hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {canceling ? '처리 중입니다...' : '신청 내역 취소'}
                  </button>
                  <p className="mt-3 flex items-center justify-center text-center text-[13px] font-bold text-gray-400 uppercase tracking-tighter">
                    <AlertCircle className="mr-1 h-3.5 w-3.5" />
                    취소 처리 시 해당 대기 순번은 영구적으로 소멸됩니다.
                  </p>
                </div>
              )}

            {result.status === 'confirmed' && schoolConfig.serviceAccess?.enabled === true && (
              <div className="mt-4 rounded-lg border border-snu-blue/10 bg-snu-blue/5 p-5">
                <p className="text-xs font-bold text-snu-blue uppercase tracking-widest">
                  {schoolConfig.serviceAccess.buttonLabel || 'SERVICE ACCESS'}
                </p>
                {schoolConfig.serviceAccess.description && (
                  <p className="mt-2 text-sm leading-relaxed text-gray-600 font-medium">{schoolConfig.serviceAccess.description}</p>
                )}
                <button
                  onClick={handleServiceAccess}
                  disabled={serviceLoading}
                  className="mt-4 w-full min-h-[56px] rounded-md bg-snu-blue py-3.5 text-base font-bold text-white shadow-sm transition hover:bg-snu-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {serviceLoading
                    ? '이동 중입니다...'
                    : schoolConfig.serviceAccess.buttonLabel || '서비스 시작하기'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="mt-12 text-center pb-8 uppercase tracking-[0.2em] font-bold">
          <p className="text-[10px] text-gray-300">
            &copy; {new Date().getFullYear()} SEOUL NATIONAL UNIVERSITY ADMISSIONS
          </p>
        </div>
      </div>
    </div>
  );
}
