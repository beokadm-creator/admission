/* eslint-disable @typescript-eslint/no-explicit-any */
import * as admin from 'firebase-admin';

export interface AdmissionRoundConfig {
  id: string;
  label: string;
  openDateTime: string;
  maxCapacity: number;
  waitlistCapacity: number;
  enabled: boolean;
}

export interface NormalizedCallableRequest {
  data: any;
  auth: any;
  rawRequest: any;
}

export function normalizeCallableRequest(requestOrData: any, legacyContext?: any): NormalizedCallableRequest {
  if (
    requestOrData &&
    typeof requestOrData === 'object' &&
    ('data' in requestOrData || 'auth' in requestOrData || 'rawRequest' in requestOrData)
  ) {
    return {
      data: requestOrData.data ?? {},
      auth: requestOrData.auth ?? null,
      rawRequest: requestOrData.rawRequest
    };
  }

  if (
    legacyContext &&
    typeof legacyContext === 'object' &&
    ('auth' in legacyContext || 'rawRequest' in legacyContext)
  ) {
    return {
      data: requestOrData?.data ?? requestOrData ?? {},
      auth: legacyContext.auth ?? null,
      rawRequest: legacyContext.rawRequest
    };
  }

  return {
    data: requestOrData ?? {},
    auth: null,
    rawRequest: undefined
  };
}

export function getRateLimitIdentifier(rawRequest: any, fallback: string) {
  const ipAddress =
    rawRequest?.ip ||
    rawRequest?.headers?.['x-forwarded-for'] ||
    rawRequest?.headers?.['fastly-client-ip'];

  if (typeof ipAddress === 'string' && ipAddress.trim()) {
    return `ip_${ipAddress.split(',')[0].trim()}`;
  }

  return fallback;
}

export function normalizeAdmissionRounds(schoolData: any): AdmissionRoundConfig[] {
  const rounds = Array.isArray(schoolData?.admissionRounds) && schoolData.admissionRounds.length > 0
    ? schoolData.admissionRounds
    : [
        {
          id: 'round1',
          label: '1차',
          openDateTime: schoolData?.openDateTime || '',
          maxCapacity: Number(schoolData?.maxCapacity || 0),
          waitlistCapacity: Number(schoolData?.waitlistCapacity || 0),
          enabled: true
        }
      ];

  const fallbackRounds: AdmissionRoundConfig[] = [
    { id: 'round1', label: '1차', openDateTime: '', maxCapacity: 0, waitlistCapacity: 0, enabled: true },
    { id: 'round2', label: '2차', openDateTime: '', maxCapacity: 0, waitlistCapacity: 0, enabled: false }
  ];

  return fallbackRounds.map((fallback, index) => {
    const source = rounds[index] || {};
    return {
      id: String(source.id || fallback.id),
      label: String(source.label || fallback.label),
      openDateTime: String(source.openDateTime || fallback.openDateTime || ''),
      maxCapacity: Math.max(0, Number(source.maxCapacity ?? fallback.maxCapacity)),
      waitlistCapacity: Math.max(0, Number(source.waitlistCapacity ?? fallback.waitlistCapacity)),
      enabled: index === 0 ? true : source.enabled !== false
    };
  }).filter((round) => round.enabled);
}

export function getSchoolRoundCapacity(schoolData: any, roundId?: string | null) {
  const rounds = normalizeAdmissionRounds(schoolData);
  const round = rounds.find((item) => item.id === roundId) || rounds[0];

  return {
    roundId: round.id,
    totalCapacity: Number(round.maxCapacity || 0) + Number(round.waitlistCapacity || 0)
  };
}

export async function checkRateLimit(
  db: admin.firestore.Firestore,
  identifier: string,
  maxRequests = 5,
  windowMs = 60000
): Promise<{ allowed: boolean; retryAfter?: number }> {
  const now = Date.now();
  const rateLimitRef = db.collection('rateLimits').doc(identifier);
  const snapshot = await rateLimitRef.get();

  if (snapshot.exists) {
    const data = snapshot.data()!;
    const elapsed = now - (data.firstRequest || 0);

    if (elapsed <= windowMs && (data.count || 0) >= maxRequests) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((windowMs - elapsed) / 1000))
      };
    }

    if (elapsed > windowMs) {
      await rateLimitRef.set({ count: 1, firstRequest: now, lastRequest: now });
      return { allowed: true };
    }
  }

  await rateLimitRef.set(
    {
      count: admin.firestore.FieldValue.increment(1),
      lastRequest: now,
      ...(snapshot.exists ? {} : { firstRequest: now })
    },
    { merge: true }
  );

  return { allowed: true };
}
