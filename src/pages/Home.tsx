import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase/config';
import { SchoolConfig } from '../types/models';
import { Clock, Smartphone, ArrowRight, Building2, CheckCircle2, ChevronRight, Users, MousePointer2, ClipboardCheck, LayoutPanelLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Home() {
  const [schools, setSchools] = useState<SchoolConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = '홍커뮤니케이션 예약시스템';
    const fetchSchools = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, 'schools'));
        const schoolList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as SchoolConfig));
        setSchools(schoolList);
        setLoading(false);
      } catch (error) {
        console.error('Error fetching schools:', error);
        setLoading(false);
      }
    };

    fetchSchools();
  }, []);

  const activeSchools = schools.filter(s => s.isActive);
  const upcomingSchools = schools.filter(s => !s.isActive && s.openDateTime);

  return (
    <div className="min-h-screen bg-[#fafafa] font-sans text-[#111111] flex flex-col">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-[#003B71] rounded flex items-center justify-center">
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-bold tracking-tight text-[#111111]">
              홍커뮤니케이션 <span className="font-medium text-gray-500 ml-1">참가접수 시스템</span>
            </span>
          </div>
          <div className="flex items-center space-x-6 text-[15px] font-medium text-gray-600">
            <a href="#active-schools" className="hover:text-[#111111] transition-colors hidden sm:block">진행중인 접수</a>
            <a href="#how-it-works" className="hover:text-[#111111] transition-colors hidden sm:block">이용 안내</a>
            <Link to="/admin/login" className="flex items-center text-sm font-semibold px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-[#111111] rounded-md transition-colors h-[48px] sm:h-[56px]">
              관리자 모드
            </Link>
          </div>
        </div>
      </nav>

      <main className="flex-1">
        {/* Simple Hero Section */}
        <section className="pt-24 pb-20 px-6 max-w-7xl mx-auto flex flex-col items-center">
          <div className="text-center max-w-3xl mb-16">
            <h1 className="text-[40px] sm:text-[56px] lg:text-[64px] font-bold tracking-[-0.03em] text-[#111111] mb-8 leading-[1.2]">
              지정된 시간에 맞춰 <br />
              <span className="text-[#003B71]">공정한 신청 기회 부여</span>
            </h1>
            <p className="text-lg sm:text-xl text-[#555555] font-medium tracking-tight leading-relaxed mx-auto max-w-2xl px-4 sm:px-0">
              순간 트래픽 분산 제어 로직을 통해 <br className="hidden md:block" />
              오픈시작 시간에 참여하신 분들께 최대한 기회를 제공합니다.
            </p>
            <p className="mt-4 text-[13px] font-bold text-[#e11d48]">
              * 과도한 트래픽이나 서버 장애 발생 시 최대한 빠르게 복구됩니다.
            </p>
          </div>

          {/* Priority 1: Active Schools */}
          <div className="w-full scroll-mt-24" id="active-schools">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between mb-8 pb-4 border-b-2 border-[#111111]">
              <h2 className="text-2xl sm:text-[28px] font-bold tracking-tight text-[#111111] mb-2 sm:mb-0">
                진행 중인 참가접수
              </h2>
              <div className="text-[#555555] text-base font-medium">
                현재 <span className="text-[#003B71] font-bold text-lg">{activeSchools.length}</span>개의 기관이 접수를 진행하고 있습니다
              </div>
            </div>
            
            {loading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-white rounded-2xl h-[280px] animate-pulse border border-gray-200"></div>
                ))}
              </div>
            ) : activeSchools.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeSchools.map(school => (
                  <Link 
                    key={school.id}
                    to={`/${school.id}/gate`}
                    className="group flex flex-col justify-between bg-white rounded-2xl p-8 border border-gray-200 hover:border-[#003B71] transition-colors shadow-sm hover:shadow-md"
                  >
                    <div>
                      <div className="flex justify-between items-start mb-8">
                        <div className="w-16 h-16 rounded-xl bg-[#fafafa] border border-gray-200 flex items-center justify-center p-2">
                          {school.logoUrl ? (
                            <img src={school.logoUrl} alt={school.name} className="w-full h-full object-contain" />
                          ) : (
                            <Building2 className="w-8 h-8 text-gray-300" />
                          )}
                        </div>
                        <div className="flex items-center space-x-1.5 px-3 py-1.5 bg-green-50 rounded text-green-700 text-sm font-bold tracking-tight border border-green-100">
                          <span className="w-2 h-2 bg-green-600 rounded-full animate-pulse"></span>
                          <span>접수중</span>
                        </div>
                      </div>
                      <h3 className="text-[22px] sm:text-2xl font-bold text-[#111111] mb-3 tracking-tight leading-tight">{school.name}</h3>
                      <p className="text-[#555555] text-base leading-relaxed line-clamp-2">
                        {school.heroMessage || '지정된 시간에 맞춰 공정하게 접수가 진행될 수 있도록 대기열 시스템이 가동되고 있습니다.'}
                      </p>
                    </div>
                    
                    <div className="mt-10 pt-6 border-t border-gray-100 flex items-center justify-between">
                      <span className="text-[#003B71] font-bold text-[17px] tracking-tight">
                        접수 페이지 진입
                      </span>
                      <ArrowRight className="w-5 h-5 text-[#003B71] group-hover:translate-x-1 transition-transform" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl p-16 sm:p-24 text-center border border-gray-200">
                <CheckCircle2 className="w-16 h-16 text-gray-300 mx-auto mb-6" strokeWidth={1.5} />
                <p className="text-[#111111] font-bold text-xl sm:text-2xl tracking-tight mb-3">현재 진행 중인 접수가 없습니다</p>
                <p className="text-[#555555] text-base font-medium">하단의 오픈 예정 리스트에서 일정을 확인하실 수 있습니다.</p>
              </div>
            )}
          </div>
        </section>

        {/* System Diagram Section */}
        <section id="how-it-works" className="py-24 sm:py-32 bg-white border-t border-gray-200">
          <div className="max-w-7xl mx-auto px-6">
            <div className="mb-20 text-center">
              <h2 className="text-[32px] sm:text-[40px] font-bold tracking-tight text-[#111111] mb-4">
                참가접수 시스템 안내
              </h2>
              <p className="text-lg text-[#555555] font-medium tracking-tight">
                다수의 사용자가 동시 접속할 경우 아래와 같은 절차로 진행됩니다.
              </p>
            </div>

            {/* Visualized Diagram / Flow */}
            <div className="relative max-w-5xl mx-auto">
              {/* Horizontal line for desktop */}
              <div className="hidden md:block absolute top-[60px] left-0 right-0 h-[2px] bg-gray-100 -z-0"></div>
              
              <div className="grid grid-cols-1 md:grid-cols-4 gap-12 relative z-10">
                <div className="flex flex-col items-center text-center">
                  <div className="w-[120px] h-[120px] rounded-full bg-white border-2 border-gray-200 shadow-sm flex items-center justify-center mb-6 relative group-hover:border-[#003B71] transition-colors bg-[#fafafa]">
                    <MousePointer2 className="w-10 h-10 text-[#003B71]" />
                    <span className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-[#111111] text-white text-sm font-bold flex items-center justify-center">1</span>
                  </div>
                  <h4 className="text-lg font-bold mb-3 text-[#111111]">접수 페이지 접속</h4>
                  <p className="text-sm text-[#555555] leading-relaxed font-medium">
                    지정된 접수 시간에 <br/> 접수 버튼을 클릭합니다.
                  </p>
                </div>

                <div className="flex flex-col items-center text-center">
                  <div className="w-[120px] h-[120px] rounded-full bg-white border-2 border-gray-200 shadow-sm flex items-center justify-center mb-6 relative bg-[#fafafa]">
                    <Clock className="w-10 h-10 text-[#003B71]" />
                    <span className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-[#111111] text-white text-sm font-bold flex items-center justify-center">2</span>
                  </div>
                  <h4 className="text-lg font-bold mb-3 text-[#111111]">스마트 대기열 진입</h4>
                  <p className="text-sm text-[#555555] leading-relaxed font-medium">
                    접속자가 많을 경우 <br/> 공식 대기번호를 발급받습니다.
                  </p>
                </div>

                <div className="flex flex-col items-center text-center">
                  <div className="w-[120px] h-[120px] rounded-full bg-white border-2 border-gray-200 shadow-sm flex items-center justify-center mb-6 relative bg-[#fafafa]">
                    <Users className="w-10 h-10 text-[#003B71]" />
                    <span className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-[#111111] text-white text-sm font-bold flex items-center justify-center">3</span>
                  </div>
                  <h4 className="text-lg font-bold mb-3 text-[#111111]">실시간 순번 확인</h4>
                  <p className="text-sm text-[#555555] leading-relaxed font-medium">
                    내 순서가 올 때까지 <br/> 화면을 유지하며 대기합니다.
                  </p>
                </div>

                <div className="flex flex-col items-center text-center">
                  <div className="w-[120px] h-[120px] rounded-full bg-white border-2 border-gray-200 shadow-sm flex items-center justify-center mb-6 relative bg-[#fafafa]">
                    <ClipboardCheck className="w-10 h-10 text-[#003B71]" />
                    <span className="absolute -top-1 -right-1 w-8 h-8 rounded-full bg-[#111111] text-white text-sm font-bold flex items-center justify-center">4</span>
                  </div>
                  <h4 className="text-lg font-bold mb-3 text-[#111111]">참가접수 작성</h4>
                  <p className="text-sm text-[#555555] leading-relaxed font-medium">
                    순서가 되면 신청 페이지로 <br/> 이동하여 정보를 입력합니다.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-20 max-w-3xl mx-auto bg-[#fafafa] p-8 rounded-2xl border border-gray-100 flex items-start space-x-5">
              <div className="bg-white p-3 rounded-xl border border-gray-200 shrink-0">
                <Smartphone className="w-6 h-6 text-[#003B71]" />
              </div>
              <div>
                <h5 className="text-[17px] font-bold mb-2 text-[#111111]">안정적인 신청을 위한 Tip</h5>
                <ul className="text-sm text-[#555555] leading-relaxed space-y-1.5 font-medium list-disc pl-4">
                  <li>대기 중 화면을 새로고침하거나 종료하면 순번이 밀릴 수 있습니다.</li>
                  <li>모바일 환경에서도 동일하게 대기열이 가동되니 화면을 그대로 유지해 주세요.</li>
                  <li>지정된 예약 시간 정각에 맞춰 버튼이 활성화됩니다.</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Upcoming Schools */}
        {upcomingSchools.length > 0 && (
          <section className="py-24 bg-[#fafafa] border-t border-gray-200">
            <div className="max-w-7xl mx-auto px-6">
              <div className="flex items-center justify-between mb-10 pb-4 border-b border-gray-300">
                <h2 className="text-2xl font-bold tracking-tight text-[#111111] mb-2 sm:mb-0">오픈 예정 기관</h2>
                <span className="text-[#555555] text-base font-medium">총 {upcomingSchools.length}건</span>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {upcomingSchools.map(school => (
                  <div key={school.id} className="flex items-center p-6 bg-white border border-gray-200 rounded-xl">
                    <div className="w-14 h-14 bg-[#fafafa] border border-gray-100 rounded-lg flex items-center justify-center mr-5 shrink-0">
                      {school.logoUrl ? (
                        <img src={school.logoUrl} alt={school.name} className="w-8 h-8 object-contain" />
                      ) : (
                        <Clock className="w-6 h-6 text-gray-300" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-lg font-bold text-[#111111] mb-1 truncate tracking-tight">{school.name}</h4>
                      <p className="text-sm text-[#b45309] font-bold tracking-tight bg-amber-50 inline-block px-1.5 py-0.5 rounded">
                        {new Date(school.openDateTime).toLocaleDateString()} {new Date(school.openDateTime).getHours()}시 오픈 예정
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="bg-white pt-16 pb-20 border-t border-gray-200 text-[#555555]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-start mb-16">
            <div>
              <div className="flex items-center space-x-3 mb-4">
                <Building2 className="w-5 h-5 text-[#111111]" />
                <h2 className="text-lg font-bold text-[#111111] tracking-tight">(주)홍커뮤니케이션 참가접수 솔루션</h2>
              </div>
              <p className="text-base tracking-tight max-w-md">
                대량 접속 상황에서도 공정한 기회를 보장하는 통합 참가접수 시스템입니다.
              </p>
            </div>
            <div className="flex items-center mt-6 md:mt-0">
              <a href="https://hongcomm.kr" target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-[#111111] hover:underline underline-offset-4 flex items-center">
                <LayoutPanelLeft className="w-4 h-4 mr-2" />
                회사 홈페이지 방문
              </a>
            </div>
          </div>
          
          <div className="border-t border-gray-200 pt-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-8">
            <div className="text-sm font-medium leading-relaxed space-y-1">
              <p className="font-bold text-[#111111] mb-2 text-[15px]">(주)홍커뮤니케이션</p>
              <div className="flex flex-col sm:flex-row sm:space-x-3 space-y-1 sm:space-y-0 text-sm">
                <p>대표이사 : 이혜정</p>
                <div className="w-px h-3.5 bg-gray-300 hidden sm:block self-center"></div>
                <p>사업자등록번호 : 264-81-48344</p>
              </div>
              <p className="text-sm">주소 : 서울특별시 송파구 송파대로 167, B동 319호 (문정동, 문정역테라타워)</p>
            </div>
            <div className="text-xs sm:text-sm text-right space-y-1 font-medium text-[#aaaaaa]">
              <p>Copyright © {new Date().getFullYear()} HONG COMMUNICATION INC. All rights reserved.</p>
              <p className="font-bold">VER 2.2.0-STABLE</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
