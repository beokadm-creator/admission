import { signInAnonymously } from 'firebase/auth';
import { auth } from '../firebase/config';

/**
 * ??? ??? ID? ?????.
 * Firebase Anonymous Auth? ??? ???? ?? ??? UID? ?????.
 * ?? localStorage ?? userId? ???? ??? ??? ????
 * ??? ?? ??? ?? ?? ??? ?? ? ?? Anonymous Auth? ??????.
 */
export async function getQueueUserId(): Promise<string> {
  if (auth.currentUser) {
    return auth.currentUser.uid;
  }
  const credential = await signInAnonymously(auth);
  return credential.user.uid;
}

export interface QueueIdentityInput {
  studentName: string;
  phone: string;
}

export function normalizeQueuePhone(phone: string) {
  return String(phone || '').replace(/\D/g, '').slice(0, 11);
}

export function getQueueIdentityStorageKey(schoolId: string, roundId: string) {
  return `queueIdentity_${schoolId}_${roundId}`;
}

export function loadStoredQueueIdentity(schoolId: string, roundId: string): QueueIdentityInput | null {
  const raw = localStorage.getItem(getQueueIdentityStorageKey(schoolId, roundId));
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as QueueIdentityInput;
    return {
      studentName: String(parsed.studentName || '').trim(),
      phone: normalizeQueuePhone(parsed.phone || '')
    };
  } catch {
    return null;
  }
}

export function saveStoredQueueIdentity(schoolId: string, roundId: string, identity: QueueIdentityInput) {
  localStorage.setItem(
    getQueueIdentityStorageKey(schoolId, roundId),
    JSON.stringify({
      studentName: String(identity.studentName || '').trim(),
      phone: normalizeQueuePhone(identity.phone || '')
    })
  );
}

export function getRecentQueueExpiryStorageKey(schoolId: string) {
  return `recentQueueExpiry_${schoolId}`;
}

export function markRecentQueueExpiry(schoolId: string, timestamp = Date.now()) {
  localStorage.setItem(getRecentQueueExpiryStorageKey(schoolId), String(timestamp));
}

export function getRecentQueueExpiry(schoolId: string) {
  const raw = localStorage.getItem(getRecentQueueExpiryStorageKey(schoolId));
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function clearRecentQueueExpiry(schoolId: string) {
  localStorage.removeItem(getRecentQueueExpiryStorageKey(schoolId));
}
