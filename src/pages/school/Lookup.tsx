import React, { useState } from 'react';
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

export default function LookupPage() {
  const { schoolConfig } = useSchool();
  const navigate = useNavigate();
  const [applicantName, setApplicantName] = useState('');
  const [phoneLast4, setPhoneLast4] = useState('');
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const handleLookup = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!schoolConfig) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const lookupFn = httpsCallable(functions, 'lookupRegistration');
      const response: any = await lookupFn({
        schoolId: schoolConfig.id,
        studentName: applicantName.trim(),
        phoneLast4: phoneLast4.trim()
      });

      if (response.data?.registration) {
        setResult(response.data.registration);
      } else {
        setError('일치하는 신청 내역이 없습니다.');
      }
    } catch (lookupError: any) {
      console.error(lookupError);
      if (lookupError?.code === 'functions/not-found') {
        setError('일치하는 신청 내역이 없습니다.');
      } else {
        setError(lookupError?.message || '조회 중 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!result || !schoolConfig) return;

    const confirmed = window.confirm(
      '정말로 신청을 취소하시겠습니까?\n취소 후에는 되돌릴 수 없으며, 다음 대기자에게 기회가 넘어갈 수 있습니다.'
    );
    if (!confirmed) return;

    setCanceling(true);
    try {
      const cancelFn = httpsCallable(functions, 'cancelRegistration');
      await cancelFn({
        schoolId: schoolConfig.id,
        registrationId: result.id,
        studentName: applicantName.trim(),
        phoneLast4: phoneLast4.trim()
      });

      setResult((previous) => (previous ? { ...previous, status: 'canceled' } : null));
      window.alert('신청이 정상적으로 취소되었습니다.');
    } catch (cancelError: any) {
      console.error(cancelError);
      window.alert(cancelError?.message || '취소 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setCanceling(false);
    }
  };

  if (!schoolConfig) return null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-8 font-sans tracking-tight sm:py-12">
      <div className="mx-auto w-full max-w-lg">
        <button
          onClick={() => navigate(`/${schoolConfig.id}/gate`)}
          className="mb-6 inline-flex items-center text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          대기열 페이지로 돌아가기
        </button>

        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-gray-100 bg-white shadow-sm">
            <Search className="h-7 w-7 text-indigo-600" />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 sm:text-3xl">신청 내역 조회</h1>
          <p className="mt-2 text-sm leading-relaxed text-gray-500">
            신청 시 입력한 신청자명과 전화번호 뒤 4자리를 입력해 현재 상태를 확인해 주세요.
          </p>
        </div>

        <div className="mb-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
          <form onSubmit={handleLookup} className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">신청자명</label>
              <input
                type="text"
                value={applicantName}
                onChange={(event) => setApplicantName(event.target.value)}
                className="block w-full rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-base transition-all focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                placeholder="예: 홍길동"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-gray-700">전화번호 뒤 4자리</label>
              <input
                type="text"
                value={phoneLast4}
                onChange={(event) => setPhoneLast4(event.target.value.replace(/\D/g, '').slice(0, 4))}
                className="block w-full rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-base tracking-[0.3em] transition-all focus:border-indigo-500 focus:bg-white focus:ring-2 focus:ring-indigo-500"
                placeholder="5678"
                inputMode="numeric"
                maxLength={4}
                pattern="\d{4}"
                required
              />
              <p className="mt-2 text-[13px] text-gray-500">
                예: `010-1234-5678`이라면 <span className="font-semibold text-indigo-600">5678</span>을 입력합니다.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gray-900 py-4 text-base font-bold text-white shadow-md transition-all hover:bg-gray-800 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? '조회 중입니다...' : '신청 내역 조회하기'}
            </button>
          </form>
        </div>

        {error && (
          <div className="mb-6 flex items-start rounded-xl border border-red-100 bg-red-50 p-4">
            <AlertCircle className="mr-3 mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            <p className="text-sm font-medium leading-relaxed text-red-800">{error}</p>
          </div>
        )}

        {result && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-lg sm:p-8">
            <h2 className="mb-5 flex items-center justify-between border-b border-gray-100 pb-4 text-lg font-bold text-gray-900">
              <span>조회 결과</span>
              {result.status === 'confirmed' && (
                <span className="inline-flex items-center rounded-full border border-green-200 bg-green-50 px-3 py-1 text-sm font-bold text-green-700">
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  확정
                </span>
              )}
              {result.status === 'waitlisted' && (
                <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm font-bold text-amber-700">
                  <Clock className="mr-1.5 h-4 w-4" />
                  예비 접수
                </span>
              )}
              {result.status === 'canceled' && (
                <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-sm font-bold text-gray-600">
                  <XCircle className="mr-1.5 h-4 w-4" />
                  취소됨
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
                <div className="mt-8 border-t border-gray-100 pt-6">
                  <button
                    onClick={handleCancel}
                    disabled={canceling}
                    className="w-full rounded-xl border-2 border-gray-200 bg-white py-3.5 font-bold text-gray-600 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {canceling ? '취소 처리 중입니다...' : '신청 취소하기'}
                  </button>
                  <p className="mt-3 flex items-center justify-center text-center text-xs text-gray-400">
                    <AlertCircle className="mr-1 h-3 w-3" />
                    취소 후에는 즉시 반영되며 되돌릴 수 없습니다.
                  </p>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
