import { SchoolConfig } from '../types/models';

export interface AdmissionRoundView {
  id: string;
  label: string;
  openDateTime: string;
  maxCapacity: number;
  waitlistCapacity: number;
  enabled: boolean;
}

const DEFAULT_ROUNDS: AdmissionRoundView[] = [
  {
    id: 'round1',
    label: '1차',
    openDateTime: '',
    maxCapacity: 0,
    waitlistCapacity: 0,
    enabled: true
  },
  {
    id: 'round2',
    label: '2차',
    openDateTime: '',
    maxCapacity: 0,
    waitlistCapacity: 0,
    enabled: false
  }
];

export function normalizeAdmissionRounds(schoolConfig?: Partial<SchoolConfig> | null): AdmissionRoundView[] {
  if (!schoolConfig) {
    return DEFAULT_ROUNDS;
  }

  const sourceRounds =
    Array.isArray(schoolConfig.admissionRounds) && schoolConfig.admissionRounds.length > 0
      ? schoolConfig.admissionRounds
      : [
          {
            id: 'round1',
            label: '1차',
            openDateTime: schoolConfig.openDateTime || '',
            maxCapacity: Number(schoolConfig.maxCapacity || 0),
            waitlistCapacity: Number(schoolConfig.waitlistCapacity || 0),
            enabled: true
          }
        ];

  return DEFAULT_ROUNDS.map((fallbackRound, index) => {
    const sourceRound = sourceRounds[index];
    if (!sourceRound) {
      return fallbackRound;
    }

    return {
      id: sourceRound.id || fallbackRound.id,
      label: sourceRound.label || fallbackRound.label,
      openDateTime: sourceRound.openDateTime || '',
      maxCapacity: Math.max(0, Number(sourceRound.maxCapacity || 0)),
      waitlistCapacity: Math.max(0, Number(sourceRound.waitlistCapacity || 0)),
      enabled: index === 0 ? true : sourceRound.enabled !== false
    };
  });
}

export function getEnabledAdmissionRounds(schoolConfig?: Partial<SchoolConfig> | null) {
  return normalizeAdmissionRounds(schoolConfig).filter((round) => round.enabled);
}

export function getCurrentAdmissionRound(schoolConfig?: Partial<SchoolConfig> | null, now = Date.now()) {
  const rounds = getEnabledAdmissionRounds(schoolConfig);
  if (rounds.length === 0) {
    return null;
  }

  const openedRounds = rounds.filter((round) => {
    const openTime = new Date(round.openDateTime || 0).getTime();
    return openTime && !Number.isNaN(openTime) && now >= openTime;
  });

  if (openedRounds.length > 0) {
    return openedRounds[openedRounds.length - 1];
  }

  return rounds[0];
}

export function getAdmissionRoundById(schoolConfig: Partial<SchoolConfig> | null | undefined, roundId?: string | null) {
  if (!roundId) {
    return null;
  }

  return normalizeAdmissionRounds(schoolConfig).find((round) => round.id === roundId) || null;
}

export function getAdmissionRoundTotal(round: Pick<AdmissionRoundView, 'maxCapacity' | 'waitlistCapacity'> | null | undefined) {
  if (!round) {
    return 0;
  }

  return Math.max(0, Number(round.maxCapacity || 0)) + Math.max(0, Number(round.waitlistCapacity || 0));
}
