import { useState } from 'react';
import { cn } from '../lib/utils';
import {
  Power,
  RefreshCw,
  Download,
  Wifi,
  Keyboard,
  ShieldOff,
  Laptop,
  ChevronDown,
  ExternalLink,
  Video
} from 'lucide-react';

interface GuideItem {
  id: string;
  icon: React.ElementType;
  title: string;
  description: string;
  linkText?: string;
  linkUrl?: string;
}

const TROUBLESHOOTING_GUIDES: GuideItem[] = [
  {
    id: 'restart',
    icon: Power,
    title: '재접속 및 앱 재시작',
    description: '줌(Zoom) 앱을 완전히 종료(작업 관리자에서 줌 종료) 후 다시 실행하거나, 참가 링크를 2~3회 다시 눌러봅니다.',
  },
  {
    id: 'update',
    icon: RefreshCw,
    title: 'Zoom 업데이트',
    description: '앱이 최신 버전인지 확인하고 업데이트합니다. 구버전은 호환성 문제로 접속 오류가 발생할 수 있습니다.',
    linkText: '업데이트 방법 알아보기',
    linkUrl: 'https://support.zoom.com/hc/ko/articles/201362233'
  },
  {
    id: 'reinstall',
    icon: Download,
    title: '앱 재설치',
    description: '기존 앱을 완전히 삭제한 후, 공식 홈페이지의 다운로드 센터에서 최신 클라이언트를 다시 설치합니다.',
    linkText: 'Zoom 다운로드 센터',
    linkUrl: 'https://zoom.us/download'
  },
  {
    id: 'network',
    icon: Wifi,
    title: '네트워크 환경 점검',
    description: '와이파이(Wi-Fi)나 인터넷 연결 상태를 확인하고, 연결이 불안정할 경우 공유기를 껐다 켜서 재부팅합니다.',
    linkText: '네트워크 문제 해결',
    linkUrl: 'https://support.zoom.com/hc/ko/articles/201362463'
  },
  {
    id: 'manual',
    icon: Keyboard,
    title: '수동 접속',
    description: '참가 링크 클릭 시 반응이 없다면, 줌 앱 내 [참가] 버튼을 눌러 회의 ID와 비밀번호를 직접 입력해 보세요.',
    linkText: '회의 참가 방법',
    linkUrl: 'https://support.zoom.com/hc/ko/articles/201362193'
  },
  {
    id: 'firewall',
    icon: ShieldOff,
    title: '방화벽 및 VPN 설정',
    description: '회사/학교 방화벽이나 VPN이 줌 네트워크 접속을 차단할 수 있습니다. 해당 기능을 일시적으로 끄고 다시 시도해 보세요.',
    linkText: '방화벽 설정 가이드',
    linkUrl: 'https://support.zoom.com/hc/ko/articles/201362683'
  },
  {
    id: 'reboot',
    icon: Laptop,
    title: '컴퓨터/기기 재부팅',
    description: '문제가 지속되면 기기(PC, 스마트폰, 태블릿)를 완전히 껐다 켜서 꼬인 네트워크나 캐시 데이터를 정리합니다.',
  }
];

export default function ZoomTroubleshooting() {
  const [openId, setOpenId] = useState<string | null>(null);

  const toggleOpen = (id: string) => {
    setOpenId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="w-full max-w-2xl mx-auto my-8 bg-white/50 backdrop-blur-md rounded-3xl p-6 sm:p-8 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100/50">
      <div className="flex flex-col items-center mb-8 text-center space-y-3">
        <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center shadow-inner mb-2">
          <Video className="w-7 h-7" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 tracking-tight">줌(Zoom) 접속 장애 대처 가이드</h2>
        <p className="text-slate-500 max-w-md leading-relaxed text-sm">
          화상 회의 접속에 문제가 발생하셨나요? 아래의 해결 방법을 순서대로 확인해 보세요.
        </p>
      </div>

      <div className="space-y-3">
        {TROUBLESHOOTING_GUIDES.map((item) => {
          const isOpen = openId === item.id;
          const Icon = item.icon;

          return (
            <div
              key={item.id}
              className={cn(
                "group rounded-2xl border transition-all duration-300 ease-out overflow-hidden bg-white",
                isOpen 
                  ? "border-blue-200 shadow-[0_8px_30px_rgb(59,130,246,0.12)]" 
                  : "border-slate-200/60 hover:border-slate-300 hover:bg-slate-50/50 hover:shadow-sm"
              )}
            >
              <button
                onClick={() => toggleOpen(item.id)}
                className="w-full flex items-center justify-between p-4 sm:px-6 sm:py-5 text-left focus:outline-none"
              >
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-colors duration-300",
                    isOpen ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600"
                  )}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className={cn(
                    "font-semibold transition-colors duration-300",
                    isOpen ? "text-slate-900" : "text-slate-700"
                  )}>
                    {item.title}
                  </span>
                </div>
                <div className={cn(
                  "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300",
                  isOpen ? "bg-blue-50 text-blue-600 rotate-180" : "text-slate-400 group-hover:text-slate-600"
                )}>
                  <ChevronDown className="w-5 h-5" />
                </div>
              </button>

              <div
                className={cn(
                  "grid transition-all duration-300 ease-in-out",
                  isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                )}
              >
                <div className="overflow-hidden">
                  <div className="p-4 sm:px-6 pb-6 pt-0 ml-14">
                    <p className="text-slate-600 leading-relaxed mb-4 text-sm sm:text-base">
                      {item.description}
                    </p>
                    
                    {item.linkUrl && (
                      <a
                        href={item.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:ring-offset-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.linkText || '자세히 보기'}
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      
      <div className="mt-8 text-center bg-slate-50 rounded-2xl p-4 border border-slate-100">
        <p className="text-sm text-slate-500">
          모든 방법을 시도해도 접속이 어렵다면, 행사 주최측 담당자에게 문의해 주세요.
        </p>
      </div>
    </div>
  );
}
