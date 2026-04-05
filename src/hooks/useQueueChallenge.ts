import { useCallback, useRef, useState } from 'react';

interface UseQueueChallengeOptions {
  onSuccess: () => void;
}

export interface QueueChallengeState {
  isOpen: boolean;
  challengeDigits: string[];
  userDigits: string[];
  isShaking: boolean;
  hasError: boolean;
  openChallenge: () => void;
  handleDigitInput: (index: number, value: string) => void;
  handleBackspace: (index: number) => void;
  handlePaste: (text: string) => void;
  submitChallenge: () => void;
  closeChallenge: () => void;
}

function generateCode(): string[] {
  return String(Math.floor(Math.random() * 10000))
    .padStart(4, '0')
    .split('');
}

export function useQueueChallenge({ onSuccess }: UseQueueChallengeOptions): QueueChallengeState {
  const [isOpen, setIsOpen] = useState(false);
  const [challengeDigits, setChallengeDigits] = useState<string[]>(['0', '0', '0', '0']);
  const [userDigits, setUserDigits] = useState<string[]>(['', '', '', '']);
  const [isShaking, setIsShaking] = useState(false);
  const [hasError, setHasError] = useState(false);
  const shakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openChallenge = useCallback(() => {
    if (isOpen) return;
    setChallengeDigits(generateCode());
    setUserDigits(['', '', '', '']);
    setIsShaking(false);
    setHasError(false);
    setIsOpen(true);
  }, [isOpen]);

  const closeChallenge = useCallback(() => {
    if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    setIsOpen(false);
    setUserDigits(['', '', '', '']);
    setIsShaking(false);
    setHasError(false);
  }, []);

  const triggerError = useCallback(() => {
    setIsShaking(true);
    setHasError(true);
    shakeTimerRef.current = setTimeout(() => {
      setIsShaking(false);
      setUserDigits(['', '', '', '']);
      setChallengeDigits(generateCode());
      setHasError(false);
    }, 600);
  }, []);

  const submitChallenge = useCallback(() => {
    const entered = userDigits.join('');
    const correct = challengeDigits.join('');
    if (entered === correct) {
      setIsOpen(false);
      setUserDigits(['', '', '', '']);
      setHasError(false);
      onSuccess();
    } else {
      triggerError();
    }
  }, [userDigits, challengeDigits, onSuccess, triggerError]);

  const handleDigitInput = useCallback(
    (index: number, value: string) => {
      // 숫자만 허용
      const digit = value.replace(/[^0-9]/g, '').slice(-1);
      if (!digit) return;

      const next = [...userDigits];
      next[index] = digit;
      setUserDigits(next);
      setHasError(false);

      // 마지막 칸이면 자동 제출
      if (index === 3) {
        const entered = next.join('');
        const correct = challengeDigits.join('');
        if (entered === correct) {
          setIsOpen(false);
          setHasError(false);
          onSuccess();
        } else {
          triggerError();
        }
        return;
      }

      // 다음 칸으로 포커스 이동
      const nextInput = document.getElementById(`challenge-digit-${index + 1}`);
      if (nextInput) (nextInput as HTMLInputElement).focus();
    },
    [userDigits, challengeDigits, onSuccess, triggerError]
  );

  const handleBackspace = useCallback(
    (index: number) => {
      const next = [...userDigits];
      if (next[index]) {
        next[index] = '';
        setUserDigits(next);
      } else if (index > 0) {
        next[index - 1] = '';
        setUserDigits(next);
        const prevInput = document.getElementById(`challenge-digit-${index - 1}`);
        if (prevInput) (prevInput as HTMLInputElement).focus();
      }
    },
    [userDigits]
  );

  const handlePaste = useCallback(
    (text: string) => {
      const digits = text.replace(/[^0-9]/g, '').slice(0, 4).split('');
      if (digits.length !== 4) return;
      setUserDigits(digits);
      setHasError(false);

      const entered = digits.join('');
      const correct = challengeDigits.join('');
      if (entered === correct) {
        setIsOpen(false);
        onSuccess();
      } else {
        triggerError();
      }
    },
    [challengeDigits, onSuccess, triggerError]
  );

  return {
    isOpen,
    challengeDigits,
    userDigits,
    isShaking,
    hasError,
    openChallenge,
    handleDigitInput,
    handleBackspace,
    handlePaste,
    submitChallenge,
    closeChallenge
  };
}
