import React from 'react';
import { useParams, Link, useLocation, Navigate } from 'react-router-dom';
import { CheckCircle, Clock, ChevronRight, Home, ArrowLeft } from 'lucide-react';
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

  return (
    <div className="min-h-screen bg-[#E8E9EA] flex flex-col items-center justify-center p-4 sm:p-6 font-sans tracking-tight">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#003B71]/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#003B71]/5 rounded-full blur-[120px]" />
      </div>

      <div className="max-w-md w-full relative z-10">
        {/* Logo Container */}
        <div className="text-center mb-8 animate-fade-in-down">
          <div className="inline-flex items-center gap-3 py-2 px-4 bg-white/50 backdrop-blur-sm rounded-full border border-white shadow-sm">
            <img src="/snu_logo.svg" alt="SNU Logo" className="w-8 h-8 object-contain" />
            <div className="h-4 w-[1px] bg-gray-300" />
            <span className="text-[13px] font-bold text-[#003B71] tracking-widest uppercase">Seoul National University</span>
          </div>
        </div>

        {/* Main Card */}
        <div className="bg-white rounded-[32px] shadow-[0_32px_64px_-16px_rgba(0,59,113,0.12)] border border-white p-8 sm:p-10 text-center relative overflow-hidden animate-scale-in">
          {/* Subtle pattern background */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
            style={{ backgroundImage: 'radial-gradient(#003B71 1px, transparent 1px)', backgroundSize: '24px 24px' }} 
          />

          <div className="relative z-10">
            {isConfirmed ? (
              <>
                <div className="w-24 h-24 bg-[#003B71]/5 rounded-[24px] flex items-center justify-center mx-auto mb-8 shadow-inner border border-[#003B71]/10">
                  <div className="w-16 h-16 bg-[#003B71] rounded-full flex items-center justify-center shadow-lg shadow-[#003B71]/30">
                    <CheckCircle className="h-8 w-8 text-white" />
                  </div>
                </div>
                
                <h1 className="text-[28px] sm:text-[32px] font-black text-gray-900 mb-2 tracking-tighter leading-tight">
                  참가 신청 완료
                </h1>
                <p className="text-gray-500 font-medium mb-8">신청이 정상적으로 접수되었습니다.</p>

                <div className="bg-[#003B71]/5 border border-[#003B71]/10 rounded-2xl p-6 mb-10 transition-all hover:bg-[#003B71]/8">
                  <p className="text-[17px] font-bold text-[#003B71] leading-relaxed">
                    행사 참여가 <span className="text-[#003B71] border-b-2 border-[#003B71]/30 pb-0.5">최종 확정</span>되었습니다
                  </p>
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <p className="text-[13px] text-gray-600 font-medium tracking-tight">잠시 후 기재하신 번호로 카카오 알림톡이 발송됩니다.</p>
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
                  대기 접수 완료
                </h1>
                <p className="text-gray-500 font-medium mb-8">신청이 대기 상태로 접수되었습니다.</p>

                <div className="bg-[#B8860B]/5 border border-[#B8860B]/10 rounded-2xl p-6 mb-10 text-center">
                  <p className="text-[17px] font-bold text-[#8B6508] leading-relaxed">
                    현재 <span className="text-[#B8860B] border-b-2 border-[#B8860B]/30 pb-0.5 font-black uppercase tracking-wider">대기 {rank}번</span>으로 배정되었습니다
                  </p>
                  <p className="text-[13px] text-[#8B6508]/70 font-medium mt-3">취소자가 발생하면 순차적으로 확정 안내를 드립니다.</p>
                </div>
              </>
            )}

            <div className="grid gap-4">
              <Link
                to={`/${schoolId}/lookup`}
                className="group flex items-center justify-center w-full py-5 bg-[#003B71] text-white rounded-2xl font-bold text-[17px] shadow-[0_8px_16px_-4px_rgba(0,59,113,0.3)] hover:shadow-[0_12px_24px_-4px_rgba(0,59,113,0.4)] hover:translate-y-[-2px] transition-all duration-300 overflow-hidden relative"
              >
                <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative z-10 flex items-center">
                  내 신청 내역 조회
                  <ChevronRight className="w-5 h-5 ml-1.5 group-hover:translate-x-1 transition-transform" />
                </span>
              </Link>
              
              <Link
                to={`/${schoolId}`}
                className="flex items-center justify-center w-full py-5 bg-gray-50 text-gray-700 rounded-2xl font-bold text-[15px] hover:bg-gray-100 hover:text-gray-900 border border-gray-100 transition-all duration-300"
              >
                <Home className="w-4 h-4 mr-2 opacity-50" />
                메인 게이트로 이동
              </Link>
            </div>
          </div>
        </div>

        {/* Footer Info */}
        <div className="mt-12 text-center animate-fade-in-up">
          <p className="text-[14px] font-bold text-gray-900 mb-1">입학본부 문의: 02-880-5114</p>
          <p className="text-[11px] text-gray-400 font-medium tracking-widest uppercase opacity-70">
            &copy; {new Date().getFullYear()} Seoul National University Admissions
          </p>
        </div>
      </div>
    </div>
  );
}
