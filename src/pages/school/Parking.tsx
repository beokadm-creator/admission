import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSchool } from '../../contexts/SchoolContext';
import { differenceInSeconds } from 'date-fns';
import { Clock } from 'lucide-react';

export default function ParkingPage() {
  const { schoolConfig } = useSchool();
  const [timeLeft, setTimeLeft] = useState<string>('');
  
  useEffect(() => {
    if (!schoolConfig?.openDateTime) return;
    
    const target = new Date(schoolConfig.openDateTime);
    
    const updateTimer = () => {
      const now = new Date();
      const diff = differenceInSeconds(target, now);
      
      if (diff <= 0) {
        window.location.reload();
        return;
      }

      const days = Math.floor(diff / (3600 * 24));
      const hours = Math.floor((diff % (3600 * 24)) / 3600);
      const minutes = Math.floor((diff % 3600) / 60);
      const seconds = diff % 60;
      
      setTimeLeft(`${days}일 ${hours}시간 ${minutes}분 ${seconds}초`);
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);

    return () => clearInterval(timer);
  }, [schoolConfig]);

  if (!schoolConfig) return null;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 p-4">
      <div className="w-full max-w-2xl mx-auto">
        {schoolConfig.logoUrl && (
          <div className="text-center mb-8">
            <img src={schoolConfig.logoUrl} alt={schoolConfig.name} className="h-24 mx-auto object-contain drop-shadow-lg" />
          </div>
        )}
        
        <div className="bg-white/80 backdrop-blur-sm p-10 rounded-2xl shadow-2xl border border-white/50">
          <div className="text-center mb-8">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">{schoolConfig.name}</h1>
            <p className="text-gray-600">신청 접수 오픈 카운트다운</p>
          </div>

          <div className="flex justify-center mb-8">
            <div className="bg-gradient-to-r from-blue-500 to-indigo-600 p-6 rounded-xl shadow-lg">
              <Clock className="w-8 h-8 text-white mb-2" />
              <div className="text-center">
                <p className="text-blue-100 text-sm font-medium mb-1">오픈까지 남은 시간</p>
                <div className="text-3xl md:text-5xl font-bold text-white tabular-nums tracking-tight">
                  {timeLeft || '계산 중...'}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 rounded-lg p-6 mb-8">
            <p className="text-gray-700 text-center whitespace-pre-wrap leading-relaxed">
              {schoolConfig.parkingMessage || '잠시만 기다려주세요.\n정시에 오픈됩니다.'}
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link 
              to={`/${schoolConfig.id}/lookup`} 
              className="inline-flex items-center justify-center px-8 py-4 bg-white border-2 border-blue-600 text-blue-600 rounded-xl hover:bg-blue-600 hover:text-white transition-all font-semibold shadow-md"
            >
              나의 신청 내역 조회하기
            </Link>
          </div>
        </div>

        <div className="mt-8 text-center">
          <p className="text-gray-500 text-sm">
            오픈 시간이 되면 페이지가 자동으로 새로고침됩니다
          </p>
        </div>
      </div>
    </div>
  );
}
