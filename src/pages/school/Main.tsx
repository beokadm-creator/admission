import React from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useSchool } from '../../contexts/SchoolContext';
import ParkingPage from './Parking';
import { isBefore } from 'date-fns';
import { FileEdit, Search, Calendar } from 'lucide-react';

export default function SchoolMain() {
  const { schoolConfig, loading, error } = useSchool();
  const [searchParams] = useSearchParams();
  const previewToken = searchParams.get('preview');

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600">로딩 중...</p>
      </div>
    </div>
  );
  
  if (error || !schoolConfig) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <div className="text-center">
        <div className="text-red-500 text-6xl mb-4">⚠️</div>
        <p className="text-red-600 text-lg font-semibold">{error || '학교 정보를 찾을 수 없습니다.'}</p>
      </div>
    </div>
  );

  // 오픈 시간 체크
  const now = new Date();
  const openTime = new Date(schoolConfig.openDateTime);
  const isOpen = isBefore(openTime, now);
  const isPreview = previewToken === schoolConfig.previewToken;

  // 파킹 페이지 렌더링 조건: 오픈 전이고, 프리뷰 토큰이 일치하지 않을 때
  if (!isOpen && !isPreview) {
    return <ParkingPage />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        {/* 헤더 */}
        <div className="text-center mb-12">
          <div className="inline-block bg-white/80 backdrop-blur-sm rounded-2xl p-8 shadow-xl">
            {schoolConfig.logoUrl && (
              <img src={schoolConfig.logoUrl} alt={schoolConfig.name} className="h-24 mx-auto mb-6 object-contain drop-shadow-lg" />
            )}
            <h1 className="text-3xl md:text-5xl font-bold text-gray-900 mb-3">{schoolConfig.name}</h1>
            <p className="text-lg text-gray-600">행사 신청 시스템</p>
            {isPreview && (
               <div className="mt-4 bg-yellow-100 text-yellow-800 inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold">
                 <span className="mr-2">🔒</span>
                 관리자 미리보기 모드
               </div>
            )}
          </div>
        </div>

        {/* 메인 액션 카드들 */}
        <div className="grid gap-6 md:grid-cols-2 max-w-3xl mx-auto mb-12">
          <Link
            to={`/${schoolConfig.id}/gate`}
            className="group relative overflow-hidden bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 border-2 border-transparent hover:border-blue-500"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500 to-indigo-600 opacity-0 group-hover:opacity-5 transition-opacity"></div>
            <div className="relative p-8 md:p-10">
              <div className="flex items-center justify-center mb-6">
                <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-4 rounded-xl shadow-lg">
                  <FileEdit className="w-8 h-8 text-white" />
                </div>
              </div>
              <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3 text-center group-hover:text-blue-600 transition-colors">
                신청하기
              </h3>
              <p className="text-gray-600 text-center group-hover:text-blue-500 transition-colors">
                행사 참여 신청서 작성
              </p>
              <div className="mt-6 flex justify-center">
                <span className="inline-flex items-center text-blue-600 font-medium group-hover:translate-x-2 transition-transform">
                  시작하기
                  <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </span>
              </div>
            </div>
          </Link>

          {schoolConfig.buttonSettings.showLookupButton && (
            <Link
              to={`/${schoolConfig.id}/lookup`}
              className="group relative overflow-hidden bg-white rounded-2xl shadow-lg hover:shadow-2xl transition-all duration-300 transform hover:-translate-y-1 border-2 border-transparent hover:border-green-500"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-green-500 to-emerald-600 opacity-0 group-hover:opacity-5 transition-opacity"></div>
              <div className="relative p-8 md:p-10">
                <div className="flex items-center justify-center mb-6">
                  <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-4 rounded-xl shadow-lg">
                    <Search className="w-8 h-8 text-white" />
                  </div>
                </div>
                <h3 className="text-2xl md:text-3xl font-bold text-gray-900 mb-3 text-center group-hover:text-green-600 transition-colors">
                  조회하기
                </h3>
                <p className="text-gray-600 text-center group-hover:text-green-500 transition-colors">
                  신청 내역 확인 및 취소
                </p>
                <div className="mt-6 flex justify-center">
                  <span className="inline-flex items-center text-green-600 font-medium group-hover:translate-x-2 transition-transform">
                    조회하러 가기
                    <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </span>
                </div>
              </div>
            </Link>
          )}
        </div>

        {/* 안내 섹션 */}
        <div className="max-w-3xl mx-auto">
          <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-8 shadow-lg border border-white/50">
            <div className="flex items-center mb-4">
              <Calendar className="w-6 h-6 text-blue-600 mr-3" />
              <h3 className="text-xl font-bold text-gray-900">이용 안내</h3>
            </div>
            <ul className="space-y-3 text-gray-700">
              <li className="flex items-start">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm font-bold mr-3 mt-0.5 flex-shrink-0">1</span>
                <span>신청하기 버튼을 클릭하여 신청서를 작성해주세요.</span>
              </li>
              <li className="flex items-start">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm font-bold mr-3 mt-0.5 flex-shrink-0">2</span>
                <span>대기열 시스템이 운영될 수 있으며, 순서가 되면 자동으로 입장됩니다.</span>
              </li>
              <li className="flex items-start">
                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-sm font-bold mr-3 mt-0.5 flex-shrink-0">3</span>
                <span>신청 완료 후 알림톡으로 결과가 발송됩니다.</span>
              </li>
            </ul>
          </div>
        </div>

        {/* 푸터 */}
        <div className="mt-16 text-center">
          <div className="inline-block bg-white/60 backdrop-blur-sm rounded-lg px-6 py-3">
            <p className="text-gray-600 text-sm">
              &copy; {new Date().getFullYear()} {schoolConfig.name}. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
