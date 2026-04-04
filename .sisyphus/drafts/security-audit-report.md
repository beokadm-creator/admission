# 보안 취약점 전수 분석 레포트

> **분석 일시**: 2026-04-04
> **분석 범위**: functions/src/ (3개 파일, ~2,920줄), src/ (30개 파일), firestore.rules
> **탐색 영역**: Admin 접근제어, 입력검증, Idempotency, 트랜잭션 일관성, 프론트엔드 노출, Credential 보안

---

## 🔴 Critical (즉시 수정 필요)

### C1. `lookupRegistration` — 인증 없는 개인정보 조회

| 항목 | 내용 |
|------|------|
| **위치** | `functions/src/index.ts:271-317` |
| **문제** | `auth` 체크 없음. `schoolId + studentName + phoneLast4`만 알면 **누구나** 타인의 신청 내역 조회 가능 |
| **노출 정보** | 신청자명, 전화번호(마스킹), 상태(confirmed/waitlisted), 등수, 제출시각 |
| **공격 시나리오** | 학생 이름 + 휴대폰 뒤 4자리(10,000 조합 브루트포스 가능)로 타인 신청 내역 대량 조회 |
| **수정** | `auth` 체크 추가 + 본인 소유 확인 또는 admin 전용으로 변경 |

---

### C2. `dangerouslySetInnerHTML` — XSS 취약점

| 항목 | 내용 |
|------|------|
| **위치** | `src/components/SchoolPopup.tsx:39` |
| **문제** | `schoolConfig.popupContent`를 **무검증** HTML로 렌더링 |
| **공격 시나리오** | 관리자 계정이 탈취되거나 악의적 관리자가 `<script>` 태그 포함 popupContent 저장 → 모든 방문자 브라우저에서 스크립트 실행 → localStorage의 PII(이름, 전화번호) 탈취 |
| **수정** | DOMPurify 도입 또는 admin 입력 시 서버 측 sanitization |

---

### C3. AlimTalk Credential 로그 유출

| 항목 | 내용 |
|------|------|
| **위치** | `functions/src/index.ts:151-157` |
| **문제** | `sendAlimTalk` 실패 시 `senderKey`가 로그에 평문으로 기록됨 |
| **코드** | `functions.logger.error('[AlimTalk] Send failed', { senderKey, ... })` |
| **공격 시나리오** | 로그 수집 시스템 접근자가 senderKey 탈취 → NHN AlimTalk 계정 도용 → 피싱 문자 대량 발송 |
| **수정** | 로그에서 `senderKey` 제거 또는 마스킹 |

---

### C4. PII localStorage 저장

| 항목 | 내용 |
|------|------|
| **위치** | `src/lib/queue.ts:57-65, 75-83` |
| **문제** | 학생 이름 + 전화번호가 localStorage에 평문 저장 |
| **공격 시나리오** | C2(XSS) 성공 시 localStorage 전체 읽기 → 학생 이름+전화번호 대량 탈취 |
| **저장 데이터** | `queueIdentity_{schoolId}_{roundId}`: `{studentName, phone}`, `recentCompletion_{schoolId}`: `{studentName, phone, status, completedAt}` |
| **수정** | PII 해싱/토큰화 또는 서버 세션으로 이전 |

---

## 🟡 High (중요하지만 즉시 치명적이지 않음)

### H1. 스케줄러 루프 — 미처리 예외로 전체 중단

| 항목 | 내용 |
|------|------|
| **위치** | `firestoreQueue.ts:1975-1995` (cleanupExpiredReservations), `firestoreQueue.ts:2009-2068` (autoAdvanceQueue) |
| **문제** | per-school `try/catch` 없음. 한 학교에서 예외 발생 시 **나머지 학교 전부 스킵** |
| **영향** | 일부 학교의 예약 만료/대기열 진행이 최대 1분 지연 |
| **수정** | per-school `try/catch` 래핑 |

---

### H2. `checkRateLimit` — Race Condition

| 항목 | 내용 |
|------|------|
| **위치** | `functions/src/shared/queueShared.ts:106-143` |
| **문제** | `get()` → 조건 확인 → `set()` 패턴. **non-transactional** |
| **공격 시나리오** | 100명이 동시 요청하면 모두 `count < maxRequests`를 보고 **모두 통과**. Rate limit이 고동시성에서 무효화 |
| **수정** | Firestore transaction 또는 RTDB atomic increment로 변경 |

---

### H3. `forceExpireSession` — Admin 체크 부재

| 항목 | 내용 |
|------|------|
| **위치** | `functions/src/firestoreQueue.ts:1593-1616` |
| **문제** | `auth`만 확인, admin 권한 확인 없음 |
| **완화 장치** | `expireReservationDocument` 내부에서 `reservation.userId === auth.uid` 확인 → 자신의 세션만 만료 가능 |
| **잔여 리스크** | admin이 타인 세션 강제 만료 불가능 (의도된 설계일 수 있음) |
| **수정** | 설계 의도 확인. admin 강제 만료가 필요하면 admin 체크 추가 |

---

### H4. `setQueueStateBestEffort` — 트랜잭션 후 쓰기

| 항목 | 내용 |
|------|------|
| **위치** | `firestoreQueue.ts:1521-1526`, `firestoreQueue.ts:1950-1954` |
| **문제** | 트랜잭션 성공 후 queueState 갱신이 best-effort. 실패 시 queueState가 stale해짐 |
| **영향** | `availableCapacity`, `currentNumber` 등 지표가 일시적으로 부정확. `autoAdvanceQueue`가 다음 틱에서 복구 |
| **수정** | 실패 시 재시도 또는 reconciliation 플래그 설정 |

---

### H5. `clearQueueNumber` — 일관성 없는 에러 처리

| 항목 | 내용 |
|------|------|
| **위치** | `firestoreQueue.ts:1296-1300` (catch 있음), `firestoreQueue.ts:1063-1065` (catch 없음), `firestoreQueue.ts:1960-1961` (catch 없음) |
| **문제** | joinQueue는 `.catch(() => undefined)`로 안전하지만, expireReservationDocument와 confirmReservation은 예외 전파 가능 |
| **수정** | 모든 호출부에 `.catch(() => undefined)` 통일 |

---

### H6. `loadQueueLiveMetrics` — 트랜잭션 내 3개 서브쿼리

| 항목 | 내용 |
|------|------|
| **위치** | `firestoreQueue.ts:328-376` |
| **문제** | reservations + queueEntries + registrations 3개 컬렉션을 `Promise.all`로 동시 읽기 |
| **영향** | 고동시성에서 트랜잭션 크기 증가 → contention 증가 → abort rate 상승 |
| **완화** | 현재 학교 1개 + 문서 수 제한 → 실질적 영향 낮음 |
| **수정** | 학교 증가 시 denormalized metrics doc 도입 고려 |

---

## 🟢 Medium (개선 권장)

### M1. 중복 `assertAdminAccessToSchool` 구현

| 항목 | 내용 |
|------|------|
| **위치** | `index.ts` (db 파라미터 없음), `firestoreQueue.ts` (db 파라미터 있음) |
| **문제** | 로직은 동일하지만 시그니처 다름. future drift 위험 |
| **수정** | `functions/src/adminAccess.ts`로 통합 |

---

### M2. 에러 메시지 내부 정보 노출

| 항목 | 내용 |
|------|------|
| **위치** | `src/lib/callable.ts` + 각 컴포넌트 catch 블록 |
| **문제** | `error.message`가 내부 경로/ID를 포함할 수 있음 |
| **수정** | 에러 매핑 테이블로 내부 메시지 → 사용자 친화적 메시지 변환 |

---

### M3. Console 로깅 프로덕션 노출

| 항목 | 내용 |
|------|------|
| **위치** | Dashboard.tsx, Login.tsx, AuthContext.tsx, AdminLayout.tsx 등 11개 파일 |
| **문제** | `console.error`에 error 객체 전체 로깅 |
| **수정** | 프로덕션에서 console 비활성화 또는 중앙 로거 도입 |

---

### M4. Firestore path injection 잠재적 위험

| 항목 | 내용 |
|------|------|
| **위치** | 전역 — `schools/${schoolId}/...` 패턴 |
| **문제** | schoolId에 `/` 포함 시 의도치 않은 중첩 경로 생성 가능 |
| **완화** | 현재 schoolId는 Firebase UID 기반 (알파뉴메릭) |
| **수정** | schoolId regex 검증 추가 (`/^[A-Za-z0-9_-]{1,64}$/`) |

---

## 요약

| # | 항목 | 심각도 | 위치 | 수정 우선순위 |
|---|------|--------|------|-------------|
| C1 | `lookupRegistration` 인증 없음 | 🔴 Critical | `index.ts:271` | **즉시** |
| C2 | `dangerouslySetInnerHTML` XSS | 🔴 Critical | `SchoolPopup.tsx:39` | **즉시** |
| C3 | AlimTalk Credential 로그 유출 | 🔴 Critical | `index.ts:151` | **즉시** |
| C4 | PII localStorage 평문 저장 | 🔴 Critical | `queue.ts:57-83` | **즉시** |
| H1 | 스케줄러 루프 예외 전파 | 🟡 High | `firestoreQueue.ts:1975,2009` | 높음 |
| H2 | `checkRateLimit` Race Condition | 🟡 High | `queueShared.ts:106` | 높음 |
| H3 | `forceExpireSession` admin 체크 부재 | 🟡 High | `firestoreQueue.ts:1593` | 높음 (설계 확인 후) |
| H4 | `setQueueStateBestEffort` stale state | 🟡 High | `firestoreQueue.ts:1521,1950` | 높음 |
| H5 | `clearQueueNumber` 일관성 없는 에러 처리 | 🟡 High | `firestoreQueue.ts:1063,1960` | 높음 |
| H6 | `loadQueueLiveMetrics` 트랜잭션 과부하 | 🟡 High | `firestoreQueue.ts:328` | 중 (학교 증가 시) |
| M1 | 중복 `assertAdminAccessToSchool` | 🟢 Medium | `index.ts`, `firestoreQueue.ts` | 낮음 |
| M2 | 에러 메시지 내부 정보 노출 | 🟢 Medium | `callable.ts` + 컴포넌트 | 낮음 |
| M3 | Console 로깅 프로덕션 노출 | 🟢 Medium | 11개 파일 | 낮음 |
| M4 | Firestore path injection 잠재적 위험 | 🟢 Medium | 전역 | 낮음 |

---

## 가장 시급한 4가지

1. **`lookupRegistration`에 auth 체크 추가** — 5분 수정. 인증 없는 개인정보 조회 차단.
2. **`SchoolPopup.tsx`에 DOMPurify 도입** — 30분 수정. XSS 벡터 제거.
3. **AlimTalk 로그에서 `senderKey` 제거** — 1분 수정. Credential 유출 차단.
4. **localStorage PII 해싱** — 1시간 수정. XSS 성공 시에도 PII 보호.
