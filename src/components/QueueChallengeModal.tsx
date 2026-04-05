import React, { useEffect } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import type { QueueChallengeState } from '../hooks/useQueueChallenge';

type QueueChallengeModalProps = Pick<
  QueueChallengeState,
  | 'isOpen'
  | 'challengeDigits'
  | 'userDigits'
  | 'isShaking'
  | 'hasError'
  | 'handleDigitInput'
  | 'handleBackspace'
  | 'handlePaste'
  | 'submitChallenge'
  | 'closeChallenge'
>;

// 숫자 입력만 허용하는 키 목록 (PC)
const ALLOWED_KEYS = new Set([
  '0','1','2','3','4','5','6','7','8','9',
  'Backspace','Delete','ArrowLeft','ArrowRight','Tab','Enter','Escape'
]);

export default function QueueChallengeModal({
  isOpen,
  challengeDigits,
  userDigits,
  isShaking,
  hasError,
  handleDigitInput,
  handleBackspace,
  handlePaste,
  submitChallenge,
  closeChallenge
}: QueueChallengeModalProps) {
  // ESC / Enter 전역 처리
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeChallenge();
      if (e.key === 'Enter') submitChallenge();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeChallenge, submitChallenge]);

  // 열릴 때 첫 번째 칸 자동 포커스
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => {
      (document.getElementById('challenge-digit-0') as HTMLInputElement | null)?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [isOpen]);

  // 스크롤 잠금
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  if (!isOpen) return null;

  const allFilled = userDigits.every(Boolean);

  return (
    <div
      className="fixed inset-0 z-[150] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={closeChallenge}
    >
      {/* 모달 카드 — 모바일은 하단 시트로 표시 */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="자동 매크로 방지 확인"
        className="w-full max-w-sm rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: 'slideUp 0.22s cubic-bezier(0.16,1,0.3,1)' }}
      >
        {/* 상단 강조 배너 */}
        <div className="flex items-center gap-3 rounded-t-3xl bg-amber-500 px-6 py-4 sm:rounded-t-3xl">
          <ShieldCheck className="h-6 w-6 shrink-0 text-white" />
          <div className="flex-1">
            <p className="text-sm font-black uppercase tracking-widest text-white/80">Anti-Macro</p>
            <p className="text-base font-bold text-white">자동 매크로 방지 인증</p>
          </div>
          <button
            type="button"
            onClick={closeChallenge}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white transition hover:bg-white/30"
            aria-label="닫기 (입장 취소)"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pb-8 pt-6">
          {/* 안내 문구 */}
          <p className="text-center text-sm leading-relaxed text-gray-600">
            아래 <span className="font-bold text-amber-600">노란 숫자</span>를 순서대로 입력하면<br />
            대기번호가 부여됩니다.
          </p>

          {/* 표시 숫자 — 크고 명확하게 */}
          <div className="mt-5 flex justify-center gap-2.5">
            {challengeDigits.map((digit, i) => (
              <div
                key={i}
                className="flex h-16 w-14 items-center justify-center rounded-2xl border-2 border-amber-300 bg-amber-50 text-4xl font-black tracking-tight text-amber-600 shadow-sm"
              >
                {digit}
              </div>
            ))}
          </div>

          {/* 화살표 */}
          <div className="mt-3 flex justify-center">
            <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>

          {/* 입력 박스 */}
          <div
            className={`mt-1 flex justify-center gap-2.5 ${isShaking ? 'animate-shake' : ''}`}
          >
            {userDigits.map((digit, i) => (
              <input
                key={i}
                id={`challenge-digit-${i}`}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                maxLength={1}
                value={digit}
                placeholder="·"
                onChange={(e) => handleDigitInput(i, e.target.value)}
                onKeyDown={(e) => {
                  // PC에서 숫자 이외 모든 키 차단
                  if (!ALLOWED_KEYS.has(e.key)) {
                    e.preventDefault();
                    return;
                  }
                  if (e.key === 'Backspace') {
                    e.preventDefault();
                    handleBackspace(i);
                  }
                }}
                onPaste={(e) => {
                  e.preventDefault();
                  handlePaste(e.clipboardData.getData('text'));
                }}
                onCompositionStart={(e) => {
                  // 한글 IME 조합 즉시 차단
                  (e.currentTarget as HTMLInputElement).value = '';
                }}
                className={`h-16 w-14 rounded-2xl border-2 text-center text-3xl font-black outline-none transition
                  ${hasError
                    ? 'border-rose-400 bg-rose-50 text-rose-600 placeholder-rose-300'
                    : digit
                      ? 'border-snu-blue bg-snu-blue/5 text-snu-blue placeholder-transparent'
                      : 'border-gray-300 bg-white text-gray-900 placeholder-gray-300 focus:border-amber-400 focus:ring-2 focus:ring-amber-200'
                  }`}
                aria-label={`${i + 1}번째 자리 숫자 입력`}
              />
            ))}
          </div>

          {/* 에러 메시지 */}
          <div className="mt-3 h-5 text-center">
            {hasError && (
              <p className="text-sm font-semibold text-rose-600">
                ✗ 번호가 일치하지 않습니다. 새 번호를 확인해 주세요.
              </p>
            )}
          </div>

          {/* 확인 버튼 */}
          <button
            type="button"
            onClick={submitChallenge}
            disabled={!allFilled || isShaking}
            className={`mt-4 flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-4 text-base font-bold text-white transition
              ${allFilled && !isShaking
                ? 'bg-snu-blue hover:bg-snu-dark active:scale-[0.98]'
                : 'bg-gray-300 cursor-not-allowed'
              }`}
          >
            <ShieldCheck className="h-5 w-5" />
            인증 후 대기열 입장
          </button>

          {/* 하단 안내 */}
          <p className="mt-4 text-center text-xs leading-relaxed text-gray-400">
            숫자를 입력한 순서대로 대기번호가 부여됩니다.
            <br className="sm:hidden" />
            <span className="hidden sm:inline"> · </span>
            X 또는 화면 밖을 누르면 입장이 취소됩니다.
          </p>
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shake {
          0%, 100% { transform: translate3d(0,0,0); }
          18%  { transform: translate3d(-6px,0,0); }
          36%  { transform: translate3d(6px,0,0); }
          54%  { transform: translate3d(-6px,0,0); }
          72%  { transform: translate3d(6px,0,0); }
        }
        .animate-shake { animation: shake 0.45s ease-in-out; }
      `}</style>
    </div>
  );
}
