import React from 'react';
import { useParams, Link, useLocation, Navigate } from 'react-router-dom';
import { CheckCircle, Clock, ChevronRight, Home, ClipboardList, BellRing } from 'lucide-react';
import { useSchool } from '../../contexts/SchoolContext';

export default function CompletePage() {
  const { schoolId } = useParams();
  const { schoolConfig } = useSchool();
  const location = useLocation();
  const { status, rank } = location.state || {};

  if (!status) {
    return <Navigate to={`/${schoolId}`} replace />;
  }

  const isConfirmed = status === 'confirmed';
  const schoolName = schoolConfig?.name || '행사';
  const schoolBrand = schoolConfig?.name || 'Admission';
  const submittedAt = new Date().toLocaleString('ko-KR');

  return (
    <div className="min-h-screen bg-[#E8E9EA] flex flex-col items-center justify-center p-4 sm:p-6 font-sans tracking-tight">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#003B71]/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#003B71]/5 rounded-full blur-[120px]" />
      </div>

      <div className="max-w-lg w-full relative z-10">
        <div className="text-center mb-8 animate-fade-in-down">
          <div className="inline-flex items-center gap-3 py-2 px-4 bg-white/50 backdrop-blur-sm rounded-full border border-white shadow-sm">
            {schoolConfig?.logoUrl ? (
              <>
                <img src={schoolConfig.logoUrl} alt={`${schoolName} 로고`} className="w-8 h-8 object-contain" />
                <div className="h-4 w-[1px] bg-gray-300" />
              </>
            ) : null}
            <span className="text-[13px] font-bold text-[#003B71] tracking-widest uppercase">{schoolBrand}</span>
          </div>
        </div>

        <div className="bg-white rounded-[32px] shadow-[0_32px_64px_-16px_rgba(0,59,113,0.12)] border border-white p-8 sm:p-10 relative overflow-hidden animate-scale-in">
          <div
            className="absolute inset-0 opacity-[0.03] pointer-events-none"
            style={{ backgroundImage: 'radial-gradient(#003B71 1px, transparent 1px)', backgroundSize: '24px 24px' }}
          />

          <div className="relative z-10 text-center">
            {isConfirmed ? (
              <>
                <div className="w-24 h-24 bg-[#003B71]/5 rounded-[24px] flex items-center justify-center mx-auto mb-8 shadow-inner border border-[#003B71]/10">
                  <div className="w-16 h-16 bg-[#003B71] rounded-full flex items-center justify-center shadow-lg shadow-[#003B71]/30">
                    <CheckCircle className="h-8 w-8 text-white" />
                  </div>
                </div>
                <h1 className="text-[28px] sm:text-[32px] font-black text-gray-900 mb-2 tracking-tighter leading-tight">
                  신청이 완료되었습니다
                </h1>
                <p className="text-gray-500 font-medium mb-8">접수가 정상적으로 반영되었으며, 현재 상태는 최종 확정입니다.</p>

                <div className="bg-[#003B71]/5 border border-[#003B71]/10 rounded-2xl p-6 mb-6 transition-all hover:bg-[#003B71]/8">
                  <p className="text-[17px] font-bold text-[#003B71] leading-relaxed">
                    {schoolName} 참여가 <span className="border-b-2 border-[#003B71]/30 pb-0.5">최종 확정</span>되었습니다.
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <p className="text-[14px] text-gray-600 font-medium tracking-tight">입력한 연락처 기준으로 안내 메시지가 발송됩니다.</p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="w-24 h-24 bg-[#B8860B]/5 rounded-[24px] flex items-center justify-center mx-auto mb-8 shadow-inner border border-[#B8860B]/10">
                  <div className="w-16 h-16 bg-[#B8860B] rounded-full flex items-center justify-center shadow-lg shadow-[#B8860B]/30">
                    <Clock className="h-8 w-8 text-white" />
                  </div>
                </div>
                <h1 className="text-[28px] sm:text-[32px] font-black text-gray-900 mb-2 tracking-tighter leading-tight">
                  예비 접수가 완료되었습니다
                </h1>
                <p className="text-gray-500 font-medium mb-8">현재 상태는 예비 접수이며, 결원이 발생하면 예비 순번대로 순차 안내됩니다.</p>

                <div className="bg-[#B8860B]/5 border border-[#B8860B]/10 rounded-2xl p-6 mb-6 text-center">
                  <p className="text-[17px] font-bold text-[#8B6508] leading-relaxed">
                    현재 <span className="text-[#B8860B] border-b-2 border-[#B8860B]/30 pb-0.5 font-black tracking-wider">예비 {rank ?? '-'}번</span>으로 배정되었습니다.
                  </p>
                  <p className="text-[14px] text-[#8B6508]/70 font-medium mt-3">확정 가능 시 입력한 연락처로 안내 메시지가 발송됩니다.</p>
                </div>
              </>
            )}

            <div className="grid gap-3 text-left sm:grid-cols-2 mb-8">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4">
                <div className="flex items-center gap-2 text-base font-bold text-gray-900">
                  <ClipboardList className="h-5 w-5 text-[#003B71]" />
                  현재 상태
                </div>
                <p className="mt-2 text-base leading-relaxed text-gray-600">
                  {isConfirmed
                    ? '신청이 정상 접수되었으며 추가적인 입장은 필요하지 않습니다.'
                    : '예비 순번은 조회 페이지에서 다시 확인하실 수 있습니다.'}
                </p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4">
                <div className="flex items-center gap-2 text-base font-bold text-gray-900">
                  <BellRing className="h-5 w-5 text-[#003B71]" />
                  다음 안내
                </div>
                <p className="mt-2 text-base leading-relaxed text-gray-600">
                  {isConfirmed
                    ? '행사 관련 후속 안내는 등록하신 연락처와 조회 페이지를 통해 확인해 주십시오.'
                    : '취소나 기한 만료가 발생할 경우 예비 순번 기준으로 자동 승급 안내를 드립니다.'}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-dashed border-gray-200 bg-white/70 px-5 py-4 mb-8 text-left">
              <p className="text-xs font-bold uppercase tracking-[0.24em] text-gray-400">Submission</p>
              <p className="mt-2 text-sm font-semibold text-gray-900">{schoolName}</p>
              <p className="mt-1 text-sm text-gray-500">접수 완료 시각: {submittedAt}</p>
            </div>

            <div className="grid gap-4">
              <Link
                to={`/${schoolId}/lookup`}
                className="group flex items-center min-h-[56px] justify-center w-full py-5 bg-[#003B71] text-white rounded-2xl font-bold text-[17px] shadow-[0_8px_16px_-4px_rgba(0,59,113,0.3)] hover:shadow-[0_12px_24px_-4px_rgba(0,59,113,0.4)] hover:translate-y-[-2px] transition-all duration-300 overflow-hidden relative"
              >
                <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative z-10 flex items-center">
                  신청 내역 조회하기
                  <ChevronRight className="w-5 h-5 ml-1.5 group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>

              <Link
                to={`/${schoolId}`}
                className="flex items-center min-h-[56px] justify-center w-full py-5 bg-gray-50 text-gray-700 rounded-2xl font-bold text-[15px] hover:bg-gray-100 hover:text-gray-900 border border-gray-100 transition-all duration-300"
              >
                <Home className="w-4 h-4 mr-2 opacity-50" />
                메인 게이트로 이동
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-12 text-center animate-fade-in-up">
          <p className="text-[11px] text-gray-400 font-medium tracking-widest uppercase opacity-70">
            &copy; {new Date().getFullYear()} {schoolName}
          </p>
        </div>
      </div>
    </div>
  );
}
