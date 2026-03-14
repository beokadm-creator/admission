import React from 'react';
import { useParams, Link, useLocation, Navigate } from 'react-router-dom';
import { CheckCircle, Clock } from 'lucide-react';

export default function CompletePage() {
  const { schoolId } = useParams();
  const location = useLocation();
  const { status, rank } = location.state || {};

  if (!status) {
    return <Navigate to={`/${schoolId}`} replace />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-lg shadow-lg text-center max-w-md w-full">
        {status === 'confirmed' ? (
          <>
            <div className="flex justify-center mb-6">
              <CheckCircle className="h-20 w-20 text-green-500" />
            </div>
            <h1 className="text-3xl font-bold mb-4 text-gray-900">신청 완료!</h1>
            <p className="text-lg text-gray-600 mb-8">
              행사 참여 신청이 <span className="font-bold text-green-600">확정</span>되었습니다.
            </p>
          </>
        ) : (
          <>
            <div className="flex justify-center mb-6">
              <Clock className="h-20 w-20 text-yellow-500" />
            </div>
            <h1 className="text-3xl font-bold mb-4 text-gray-900">대기 접수 완료</h1>
            <p className="text-lg text-gray-600 mb-8">
              정원 초과로 <span className="font-bold text-yellow-600">대기열(순번 {rank}번)</span>에 등록되었습니다.<br/>
              취소자 발생 시 순차적으로 연락드립니다.
            </p>
          </>
        )}
        
        <div className="space-y-3">
          <Link to={`/${schoolId}/lookup`} className="block w-full py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors">
            내 신청 내역 확인하기
          </Link>
          <Link to={`/${schoolId}`} className="block w-full py-3 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors">
            메인으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
