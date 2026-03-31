import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Clock, FileEdit, Search } from 'lucide-react';
import { useSchool } from '../../contexts/SchoolContext';

const dateOptions: Intl.DateTimeFormatOptions = {
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Seoul'
};

const formatDateLabel = (value?: string) => {
  if (!value) return '추후 공지';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '추후 공지';
  return date.toLocaleString('ko-KR', dateOptions);
};

const pad = (value: number) => value.toString().padStart(2, '0');

export default function SchoolMain() {
  const { schoolConfig, loading, error } = useSchool();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC]">
        <div className="flex flex-col items-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-600" />
          <p className="text-lg font-medium text-gray-500">학교 정보를 불러오는 중입니다.</p>
        </div>
      </div>
    );
  }

  if (error || !schoolConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F8FAFC] p-4">
        <div className="w-full max-w-sm rounded-[1.75rem] border border-gray-100 bg-white p-8 text-center shadow-sm">
          <div className="mb-4 flex items-center justify-center">
            <span className="text-3xl font-bold text-rose-500">!</span>
          </div>
          <p className="text-lg font-semibold text-gray-900">{error || '학교 정보를 표시할 수 없습니다.'}</p>
          <p className="mt-2 text-sm text-gray-500">잠시 후 다시 시도하거나 관리자에게 문의해 주세요.</p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const openTime = new Date(schoolConfig.openDateTime);
  const openTimestamp = openTime.getTime();
  const isValidOpenTime = !Number.isNaN(openTimestamp);
  const isOpen = isValidOpenTime ? now.getTime() >= openTimestamp : false;
  const countdownMs = isValidOpenTime ? Math.max(0, openTimestamp - now.getTime()) : 0;
  const countdown = {
    days: Math.floor(countdownMs / (1000 * 60 * 60 * 24)),
    hours: Math.floor((countdownMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    minutes: Math.floor((countdownMs % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((countdownMs % (1000 * 60)) / 1000)
  };

  const openDateLabel = formatDateLabel(schoolConfig.openDateTime);
  const heroMessage =
    schoolConfig.heroMessage?.trim() ||
    schoolConfig.parkingMessage?.trim() ||
    '오픈 시각이 되면 버튼이 활성화되며, 클릭 순서대로 대기열 번호가 부여됩니다.';
  const programInfo = schoolConfig.programInfo?.trim();

  const badges = [
    schoolConfig.eventDate &&
      `행사일 ${new Date(schoolConfig.eventDate).toLocaleDateString('ko-KR', {
        month: 'short',
        day: 'numeric',
        weekday: 'short',
        timeZone: 'Asia/Seoul'
      })}`,
    `정규 신청 ${schoolConfig.maxCapacity || 0}명`,
    `예비 접수 ${schoolConfig.waitlistCapacity || 0}명`
  ].filter(Boolean) as string[];

  const steps = [
    {
      label: 'STEP 1',
      title: '오픈 시각 확인',
      detail: '카운트다운이 끝나면 게이트 버튼이 열리고, 그때부터 클릭 순서가 기록됩니다.'
    },
    {
      label: 'STEP 2',
      title: '대기열 순차 입장',
      detail: '동시 작성 가능 인원을 기준으로 운영되며, 제출 또는 만료로 자리가 생기면 다음 순번이 즉시 입장합니다.'
    },
    {
      label: 'STEP 3',
      title: '신청 완료',
      detail: '입장 후 3분 안에 신청서를 제출하면 확정 또는 예비 접수 결과가 안내됩니다.'
    }
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] px-4 py-8 font-sans tracking-tight sm:py-16">
      <div className="mx-auto max-w-5xl space-y-10">
        <section className="relative overflow-hidden rounded-[2rem] border border-gray-100 bg-white p-8 shadow-xl sm:p-12">
          <div className="pointer-events-none absolute -left-6 -top-6 h-32 w-32 rounded-full bg-indigo-100 opacity-70 blur-2xl" />
          <div className="pointer-events-none absolute -right-8 bottom-[-20px] h-32 w-32 rounded-full bg-emerald-100 opacity-70 blur-2xl" />
          <div className="relative space-y-6">
            <div className="flex flex-col items-center gap-4 text-center md:flex-row md:items-center md:justify-between md:text-left">
              <div className="flex flex-col items-center gap-4 md:flex-row md:items-center">
                {schoolConfig.logoUrl && (
                  <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-white/80 p-3 shadow-inner">
                    <img src={schoolConfig.logoUrl} alt={schoolConfig.name} className="h-full w-full object-contain" />
                  </div>
                )}
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.4em] text-gray-400">Admission Gate</p>
                  <h1 className="text-3xl font-black text-gray-900 sm:text-4xl">{schoolConfig.name}</h1>
                  <p className="text-sm leading-relaxed text-gray-500">{heroMessage}</p>
                </div>
              </div>
              <div className="grid gap-2 text-sm text-gray-500 md:text-right">
                <p className="font-semibold text-gray-900">{isOpen ? '현재 게이트가 열려 있습니다' : '게이트 오픈 대기 중'}</p>
                <p>{openDateLabel}</p>
              </div>
            </div>

            <div className="flex flex-wrap justify-center gap-2 text-xs font-semibold text-gray-500">
              {badges.map((badge) => (
                <span key={badge} className="rounded-full border border-gray-200 px-3 py-1">
                  {badge}
                </span>
              ))}
            </div>

            {programInfo && (
              <div className="rounded-[1.5rem] border border-gray-200 bg-gray-50 px-5 py-4 text-sm text-gray-600">
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-gray-500">프로그램 안내</p>
                <p className="mt-2 leading-relaxed text-gray-700">{programInfo}</p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 text-center">
                <p className="text-xs uppercase tracking-[0.3em] text-gray-500">게이트 상태</p>
                <p className="text-2xl font-black text-gray-900">{isOpen ? '오픈됨' : '오픈 예정'}</p>
                {!isOpen && (
                  <p className="text-xs text-gray-500">
                    {pad(countdown.days)}일 {pad(countdown.hours)}:{pad(countdown.minutes)}:{pad(countdown.seconds)}
                  </p>
                )}
                <p className="text-xs text-gray-500">{isOpen ? '지금 대기열 입장이 가능합니다' : '카운트다운이 진행 중입니다'}</p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-4 text-center">
                <p className="text-xs uppercase tracking-[0.3em] text-gray-500">정규 신청</p>
                <p className="text-2xl font-black text-gray-900">{schoolConfig.maxCapacity || 0}</p>
                <p className="text-xs text-gray-500">모집 인원</p>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-white p-4 text-center">
                <p className="text-xs uppercase tracking-[0.3em] text-gray-500">예비 접수</p>
                <p className="text-2xl font-black text-gray-900">{schoolConfig.waitlistCapacity || 0}</p>
                <p className="text-xs text-gray-500">추가 인원</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <Link
            to={`/${schoolConfig.id}/gate`}
            className="group flex flex-col justify-between gap-6 rounded-[1.5rem] border border-gray-100 bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:border-indigo-200 sm:p-10"
          >
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
                <FileEdit className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-semibold text-indigo-600">게이트 입장</p>
                <h3 className="text-2xl font-bold text-gray-900">대기열 순번 받기</h3>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-gray-500">
              {isOpen
                ? '게이트가 열려 있습니다. 클릭 즉시 본인 순번과 전체 현황을 확인할 수 있습니다.'
                : '오픈 시간이 되면 버튼이 활성화됩니다. 활성화 전에는 순번이 부여되지 않습니다.'}
            </p>
            <div className="flex items-center font-semibold text-indigo-600">
              게이트로 이동
              <ChevronRight className="ml-2 h-4 w-4" />
            </div>
          </Link>

          {schoolConfig.buttonSettings.showLookupButton ? (
            <Link
              to={`/${schoolConfig.id}/lookup`}
              className="group flex flex-col justify-between gap-6 rounded-[1.5rem] border border-gray-100 bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:border-emerald-200 sm:p-10"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                  <Search className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-emerald-600">신청 조회</p>
                  <h3 className="text-2xl font-bold text-gray-900">등록 상태 확인</h3>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-gray-500">
                신청 이후 본인의 상태를 확인하거나 후속 안내를 다시 확인할 수 있습니다.
              </p>
              <div className="flex items-center font-semibold text-emerald-600">
                조회 페이지로 이동
                <ChevronRight className="ml-2 h-4 w-4" />
              </div>
            </Link>
          ) : (
            <div className="flex flex-col items-center justify-center gap-4 rounded-[1.5rem] border border-gray-100 bg-gray-50 p-8 text-center text-sm font-medium text-gray-400">
              <Search className="h-6 w-6" />
              조회 기능이 현재 비활성화되어 있습니다.
            </div>
          )}
        </div>

        <section className="rounded-[2rem] border border-gray-100 bg-white p-8 shadow-lg">
          <div className="flex items-center gap-3 border-b border-gray-100 pb-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-gray-200 bg-gray-50">
              <Clock className="h-6 w-6 text-gray-600" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-gray-500">이용 절차</p>
              <h3 className="text-2xl font-bold text-gray-900">스마트 대기열 이용 방법</h3>
            </div>
          </div>
          <div className="mt-6 grid gap-6 sm:grid-cols-3">
            {steps.map((step) => (
              <div key={step.title} className="rounded-2xl border border-gray-100 bg-gray-50 p-6 text-sm text-gray-600">
                <p className="text-xs font-semibold uppercase tracking-[0.3em] text-gray-500">{step.label}</p>
                <h4 className="mt-3 text-lg font-semibold text-gray-900">{step.title}</h4>
                <p className="mt-2 leading-relaxed text-gray-500">{step.detail}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
