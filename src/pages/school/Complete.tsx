import React from 'react';
import { useParams, Link, useLocation, Navigate } from 'react-router-dom';
import { CheckCircle, Clock, ChevronRight, Home } from 'lucide-react';
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
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col items-center justify-center p-4 font-sans tracking-tight">
      <div className="bg-white p-8 sm:p-12 rounded-[2rem] shadow-xl shadow-gray-200/50 border border-gray-100 max-w-md w-full relative overflow-hidden animate-fade-in-up">
        {/* 장식 배경 */}
        <div className={`absolute top-0 right-0 w-64 h-64 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 opacity-50 ${isConfirmed ? 'bg-emerald-50' : 'bg-amber-50'}`}></div>
        
        <div className="relative z-10 text-center">
          {isConfirmed ? (
            <>
              <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-emerald-100/50 animate-bounce-soft">
                <CheckCircle className="h-12 w-12 text-emerald-500" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-4 tracking-tight">신청이 완료되었습니다</h1>
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 mb-8">
                <p className="text-[15px] font-medium text-emerald-800 leading-relaxed">
                  행사 참여 신청이 <span className="font-bold underline decoration-emerald-300 underline-offset-4 decoration-2">정상적으로 확정</span>되었습니다.
                </p>
                <p className="text-[13px] text-emerald-600/80 font-medium mt-1">곧 카카오톡 알림톡으로 안내 메시지가 발송됩니다.</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-24 h-24 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-amber-100/50 animate-bounce-soft">
                <Clock className="h-12 w-12 text-amber-500" />
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-4 tracking-tight">대기 접수 완료</h1>
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 mb-8 text-left">
                <p className="text-[15px] font-medium text-amber-800 leading-relaxed mb-1">
                  정원 초과로 인해 현재 <span className="font-bold underline decoration-amber-300 underline-offset-4 decoration-2">대기 {rank}번</span>으로 등록되었습니다.
                </p>
                <p className="text-[13px] text-amber-600/90 font-medium">취소자가 발생하면 순차적으로 연락을 드릴 예정입니다.</p>
              </div>
            </>
          )}

          <div className="space-y-3">
            <Link
              to={`/${schoolId}/lookup`}
              className="group flex items-center justify-center w-full py-4 bg-gray-900 text-white rounded-2xl font-bold text-lg hover:bg-gray-800 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300 overflow-hidden relative"
            >
              내 신청 내역 확인
              <ChevronRight className="w-5 h-5 ml-1 group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              to={`/${schoolId}`}
              className="flex items-center justify-center w-full py-4 bg-gray-50 text-gray-700 rounded-2xl font-bold hover:bg-gray-100 transition-colors duration-300"
            >
              <Home className="w-4 h-4 mr-2" />
              메인으로 돌아가기
            </Link>
          </div>
        </div>
      </div>
      
      <div className="mt-8 text-center pb-8 animate-fade-in-up">
        <p className="text-sm font-semibold text-gray-400">
          &copy; {new Date().getFullYear()} {schoolConfig?.name}. All rights reserved.
        </p>
      </div>
    </div>
  );
}
