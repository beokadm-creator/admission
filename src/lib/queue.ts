import { signInAnonymously } from 'firebase/auth';
import { auth } from '../firebase/config';

/**
 * 대기열 사용자 ID를 반환합니다.
 * Firebase Anonymous Auth를 사용하여 서버에서 검증 가능한 UID를 발급합니다.
 * 기존 localStorage 기반의 userId는 서버에서 신원 확인이 불가능하여
 * 대기열 번호 위조 및 세션 탈취가 가능했으므로 Anonymous Auth로 대체합니다.
 */
export async function getQueueUserId(): Promise<string> {
  if (auth.currentUser) {
    return auth.currentUser.uid;
  }
  const credential = await signInAnonymously(auth);
  return credential.user.uid;
}
