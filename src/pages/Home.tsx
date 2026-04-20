import React, { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { ChevronRight, ExternalLink, Phone, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { db } from '../firebase/config';
import type { SchoolConfig } from '../types/models';

const KAKAO_CHANNEL_URL = 'https://pf.kakao.com/_wxexmxgn/chat';
const PHONE_NUMBER = '02-6959-3872';

export default function Home() {
  const [school, setSchool] = useState<SchoolConfig | null>(null);
  const [showProgramModal, setShowProgramModal] = useState(false);

  useEffect(() => {
    document.title = '서울대학교 입학전형 학부모 교육 프로그램 안내';

    const fetchSchool = async () => {
      try {
        const snapshot = await getDoc(doc(db, 'schools', 'snu'));
        if (snapshot.exists()) {
          setSchool({ id: snapshot.id, ...snapshot.data() } as SchoolConfig);
        }
      } catch (error) {
        console.error('Error fetching SNU school config:', error);
      }
    };

    fetchSchool();
  }, []);

  useEffect(() => {
    if (!showProgramModal) return undefined;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowProgramModal(false);
      }
    };

    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [showProgramModal]);

  return (
    <>
      <div className="min-h-screen bg-snu-gray text-snu-text">
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col justify-center px-4 py-10 sm:px-6 sm:py-14">
          <section className="relative overflow-hidden rounded-[2rem] border border-snu-blue/10 bg-white shadow-[0_24px_80px_rgba(0,59,113,0.12)]">
            <div className="absolute inset-x-0 top-0 h-2 bg-snu-blue" />
            <div className="absolute -right-16 top-12 h-40 w-40 rounded-full bg-snu-blue/10 blur-3xl" />
            <div className="absolute -left-12 bottom-0 h-48 w-48 rounded-full bg-[#B8C7D9]/40 blur-3xl" />

            <div className="relative px-6 py-8 sm:px-10 sm:py-12 lg:px-14 lg:py-14">
              <div className="flex flex-col gap-8 border-b border-gray-100 pb-8 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex items-start gap-4 sm:gap-5">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[1.5rem] border border-snu-blue/10 bg-white p-3 shadow-sm sm:h-24 sm:w-24">
                    <img
                      src={school?.logoUrl || '/logo.png'}
                      alt="서울대학교 로고"
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <div className="pt-1">
                    <p className="text-xs font-bold uppercase tracking-[0.32em] text-snu-blue/70">Seoul National University</p>
                    <h1 className="mt-3 text-3xl font-black tracking-tight text-gray-900 sm:text-4xl lg:text-[2.75rem]">
                      학부모 교육 프로그램 안내
                    </h1>
                  </div>
                </div>
              </div>

              <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
                <aside className="order-1 space-y-4 lg:order-2">
                  <div className="rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm">
                    <div className="space-y-3">
                      <Link
                        to="/snu/lookup"
                        className="flex min-h-[60px] items-center justify-between rounded-2xl border border-snu-blue/10 bg-snu-blue px-5 py-4 text-left text-white transition hover:bg-snu-dark"
                      >
                        <span className="text-base font-bold">신청 내역 조회</span>
                        <ChevronRight className="h-5 w-5" />
                      </Link>

                      <button
                        type="button"
                        onClick={() => setShowProgramModal(true)}
                        className="flex min-h-[60px] w-full items-center justify-between rounded-2xl border border-snu-blue/15 bg-[#F5F8FB] px-5 py-4 text-left text-snu-blue transition hover:border-snu-blue/30 hover:bg-white"
                      >
                        <span className="text-base font-bold">프로그램 보기</span>
                        <ChevronRight className="h-5 w-5" />
                      </button>

                      <a
                        href={KAKAO_CHANNEL_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-h-[60px] items-center justify-between rounded-2xl border border-[#FEE500]/80 bg-[#FEE500] px-5 py-4 text-left text-[#191919] transition hover:brightness-95"
                      >
                        <span className="text-base font-bold">카카오톡문의</span>
                        <ExternalLink className="h-5 w-5" />
                      </a>
                    </div>
                  </div>
                </aside>

                <section className="rounded-[1.75rem] border border-snu-blue/10 bg-[linear-gradient(180deg,rgba(0,59,113,0.04),rgba(255,255,255,0.96))] p-6 sm:p-8">
                  <div className="flex items-center justify-between gap-4 border-b border-snu-blue/10 pb-4">
                    <div>
                      <p className="text-sm font-bold uppercase tracking-[0.28em] text-snu-blue">참가 완료 인원 공지 사항</p>
                      <p className="mt-2 text-sm leading-relaxed text-gray-500">
                        참가 완료 및 확정 대상자는 아래 일정을 반드시 숙지해 주시기 바랍니다.
                      </p>
                    </div>
                    <div className="hidden rounded-full border border-snu-blue/15 bg-white px-4 py-2 text-xs font-bold uppercase tracking-[0.28em] text-snu-blue sm:block">
                      Online Event
                    </div>
                  </div>

                  <div className="mt-6 space-y-4 text-[15px] leading-8 text-gray-700 sm:text-base">
                    <p>
                      2028학년도 서울대학교 입학전형의 안정적 준비를 위한 학부모 교육 프로그램은 <strong className="font-extrabold text-snu-blue">온라인</strong>으로 진행됩니다.
                    </p>
                    <p>
                      행사 전날 <strong className="font-bold text-gray-900">4월 24일(금)</strong> 조회 버튼을 통해 확인하실 수 있습니다.
                    </p>
                    <p>
                      행사는 <strong className="font-bold text-gray-900">4월 25일(토) 13:00</strong>부터 온라인으로 진행됩니다.
                    </p>
                    <p>
                      <strong className="font-bold text-gray-900">4월 24일 18:00 이전</strong>에 확인하실 수 있습니다.
                    </p>
                    <p>
                      참가 완료하시고 확정되신 분들께서는 반드시 해당 내용을 숙지하시기 바랍니다.
                    </p>
                    <p className="pt-2 font-semibold text-gray-900">감사합니다.</p>
                  </div>
                </section>
              </div>

              <div className="mt-6 rounded-[1.5rem] border border-gray-100 bg-[#FBFCFE] p-6">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-snu-blue/10 text-snu-blue">
                    <Phone className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-lg font-bold text-gray-900">문의 안내</p>
                    <p className="mt-2 text-sm leading-7 text-gray-600">
                      02-6959-3872
                      <br />
                      카카오톡 문의를 권장합니다.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {showProgramModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-6 backdrop-blur-[2px]"
          onClick={() => setShowProgramModal(false)}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-[1.75rem] bg-white shadow-[0_28px_90px_rgba(15,23,42,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 sm:px-6">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.28em] text-snu-blue">프로그램 보기</p>
                <h2 className="mt-1 text-xl font-bold text-gray-900">서울대학교 학부모 교육 프로그램</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowProgramModal(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-500 transition hover:border-snu-blue/30 hover:text-snu-blue"
                aria-label="프로그램 팝업 닫기"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[calc(90vh-88px)] overflow-y-auto bg-[#F7F9FC] p-4 sm:p-6">
              {school?.programImageUrl ? (
                <img
                  src={school.programImageUrl}
                  alt="서울대학교 학부모 교육 프로그램 안내"
                  className="w-full rounded-[1.25rem] border border-gray-200 bg-white object-contain shadow-sm"
                />
              ) : (
                <div className="rounded-[1.5rem] border border-snu-blue/10 bg-white p-6 sm:p-8">
                  <p className="text-sm font-bold uppercase tracking-[0.28em] text-snu-blue">프로그램 안내</p>
                  <div className="mt-4 space-y-3 text-sm leading-7 text-gray-600 sm:text-base">
                    <p>2028학년도 서울대학교 입학전형의 안정적 준비를 위한 학부모 교육 프로그램은 온라인으로 진행됩니다.</p>
                    <p>행사 전날 4월 24일(금) 조회 버튼을 통해 확인하실 수 있습니다.</p>
                    <p>행사는 4월 25일(토) 13:00부터 온라인으로 진행됩니다.</p>
                    <p>4월 24일 18:00 이전에 확인하실 수 있습니다.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
