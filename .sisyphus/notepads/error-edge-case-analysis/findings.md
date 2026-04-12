# Error Handling & Edge Case Analysis — Findings

## 1. 네트워크 실패 (사용자 제출 중 네트워크 끊김)

### 현재 처리
- 프런트: `callCallableWithRetry`가 transient error (aborted, unavailable, deadline-exceeded, internal, unknown)를 최대 5회 재시도 (confirmReservation), 지수 백오프
- `requestId` 기반 idempotency: 서버가 `requestLocks/{requestId}`에 결과를 기록하므로 재시도 시 동일 결과 반환
- `beforeunload` 이벤트로 브라우저 닫기 방지 (SmartQueueGate, Register 모두)

### 사용자 복구 가능성
- **낮음**: confirmReservation 제출 중 네트워크 끊기면 클라이언트는 결과를 모름
- requestId는 ref에 저장되지만, 페이지 리로드 시 requestId가 새로 생성됨 (confirmRequestIdRef 초기값 null)
- Register.tsx `validateSession`은 세션 유효성만 확인하지, 제출 성공 여부를 확인하지 않음

### 리스크: CRITICAL
- **사용자가 제출을 눌렀으나 네트워크 응답을 받지 못한 상태에서 페이지를 새로고침하면**: 
  - 서버에 이미 registration이 생성되어 있을 수 있음
  - 하지만 클라이언트는 이를 모르고 세션 만료 처리됨
  - 이후 재입장 시 confirmReservation 트랜잭션에서 `registrationSnapshot.exists` 체크로 이중 등록은 방지됨
  - **하지만 사용자에게 "이미 제출되었습니다" 안내가 없고, 그냥 새로 작성하게 됨**

### 개선 필요
1. Register.tsx mount 시 registration 존재 여부 확인 로직 추가 (sessionId로 registrations/{sessionId} 조회)
2. confirmReservation 성공 시 localStorage에 제출 완료 마커 저장
3. requestId를 sessionStorage가 아닌 localStorage에 유지하여 재시도 시 재사용

---

## 2. 동시성 (여러 사용자가 동시에 같은 작업)

### 현재 처리
- RTDB transaction 기반 대기번호 발급: per-user lock + global counter 트랜잭션
- Firestore transaction: joinQueue, startRegistration, confirmReservation 모두 트랜잭션 내에서 상태 검증 후 쓰기
- `queueIdentityLocks` 컬렉션: 이름+전화번호 해시 기반 중복 방지
- `requestLocks`: requestId 기반 멱등성 보장

### 사용자 복구 가능성
- **높음**: 트랜잭션이 원자성 보장. 실패 시 적절한 에러 메시지 반환

### 리스크: LOW-MEDIUM
- **RTDB counter 트랜잭션**: `issueQueueNumberFromRtdb`에서 per-user assignment lock 트랜잭션 후 global counter 트랜잭션이 순차적. 두 단계 사이에 race 가능하나, counter 트랜잭션이 번호 초과 시 abort 처리
- **Rate limit 비원자적**: `checkRateLimit`이 read-then-write이지만 트랜잭션이 아님. 극단적 동시에 제한 초과 가능. 의도적 trade-off (주석 명시)
- **queueState 분리 쓰기**: joinQueue에서 queueState 업데이트를 트랜잭션에서 제외 (주석: "single-document write contention 방지"). autoAdvanceQueue가 1분마다 재조정

---

## 3. 타임아웃 및 세션 만료

### 현재 처리
- 서버: `DEFAULT_SESSION_MS = 3분`, `SESSION_SUBMIT_GRACE_MS = 90초`
- 프런트: 1초 간격 카운트다운, `submitting && now <= expiresAt + SUBMIT_GRACE_MS` 그레이스 기간
- 세션 만료 시 `forceExpireSession` callable 호출 후 gate로 리다이렉트
- Heartbeat: 30초 간격, `WAITING_PRESENCE_TIMEOUT_MS = 90초`, `ELIGIBLE_PRESENCE_TIMEOUT_MS = 60초`
- Scheduled cleanup: 1분마다 `cleanupExpiredReservations` 실행

### 사용자 복구 가능성
- **중간**: 만료 후 gate로 돌아가서 다시 대기번호를 받아야 함
- `RECENT_EXPIRY_SUPPRESSION_MS = 15초`로 만료 직후 자동입장 억제 (순환 방지)
- 하지만 대기번호가 소멸되므로 다시 줄을 서야 함

### 리스크: MEDIUM
- **클라이언트 시계와 서버 시계 불일치**: 프런트가 Date.now() 기준으로 타이머를 관리. 서버보다 클라이언트 시계가 빠르면 사용자가 더 일찍 만료된 것으로 인식
- **그레이스 기간 내 제출 성공 후 리다이렉트 실패**: confirmReservation 성공 응답을 받았으나 navigate() 전에 네트워크 끊기면 완료 화면 못 봄
- **Heartbeat 최적화 영향**: heartbeat에서 queueState 쓰기를 제거하여 cleanup이 1분마다 실행되도록 의존. heartbeat 실패는 silently 무시 (UI 블록 방지)
- **visible 상태에서만 heartbeat**: 탭 백그라운드 시 heartbeat 전송 안 함. 정책적 의도이나, cleanup 타이머(90초 waiting, 60초 eligible)와 상호작용 시 edge case 존재
  - 예: 사용자가 60초 eligible 상태에서 탭 백그라운드 → 60초 후 cleanup이 eligible entry를 만료 → 복귀 시 "expired"

---

## 4. 정원 초과 (마지막 순간 정원 찼을 때)

### 현재 처리
- `confirmReservation` 트랜잭션 내에서 `loadQueueLiveMetrics`로 실시간 정원 확인
- 정원 초과 시 `FULL_CAPACITY` 에러 반환
- Waitlist 슬롯이 있으면 waitlisted 처리 (rank 부여)
- 프런트에서 `queueState.availableCapacity`와 `queueLimitReached`로 사전 차단
- 소프트 한도: `queueJoinLimit * 1.5` 초과 시 프런트에서 진입 차단

### 사용자 복구 가능성
- **중간**: 정원 초과 에러 메시지 표시, 메인으로 이동 버튼 제공
- 하지만 대기 중이던 사용자에게 갑작스러운 실패 경험

### 리스크: LOW
- **경합 가능성**: N명이 동시에 confirmReservation 시 모두 liveMetrics 기준으로 정원 확인 → 트랜잭션 직렬화로 해결. Firestore 트랜잭션이 재시도 시 최신 상태 재읽
- **queueState 불일치**: joinQueue에서 queueState를 업데이트하지 않으므로, 프런트에 표시되는 `availableCapacity`가 부정확할 수 있음. autoAdvanceQueue가 1분마다 재조정

---

## 5. 중복 제출 (같은 사용자가 여러 번 제출)

### 현재 처리
- **requestId idempotency**: `requestLocks/{requestId}`에 결과 기록 → 동일 requestId 재요청 시 캐시된 결과 반환
- **registration 문서 ID = sessionId**: `registrations/{sessionId}`에 write. 동일 sessionId로 재시도 시 `registrationSnapshot.exists` 체크로 기존 결과 반환
- **Identity lock**: `queueIdentityLocks/{hash}`로 이름+전화번호 기반 중복 방지. round1에서 confirmed되면 round2 진입 차단
- **Queue entry**: `queueEntries/{userId}` 단일 문서. 동일 uid로 재입장 시 기존 번호 재사용

### 사용자 복구 가능성
- **높음**: idempotency가 여러 계층에서 보장

### 리스크: LOW
- **requestId 재생성 문제**: confirmRequestIdRef는 null 초기화 후 에러 시 null로 리셋. 재시도 시 새 requestId 생성 → 서버에서 새 요청으로 처리 → 하지만 registrationSnapshot.exists 체크가 있어 실제 중복 등록은 방지
- **다른 기기/브라우저**: 익명 Auth uid가 다르면 다른 사용자로 인식. identity lock이 이름+전화 해시 기반이므로 최종 방어선은 유효

---

## 6. 서버 오류 (Cloud Functions 실패)

### 현재 처리
- `callCallableWithRetry`: transient error 자동 재시도 (최대 4-5회)
- `setQueueStateBestEffort`: queueState 업데이트 실패를 warn 로그만 남기고 무시
- Heartbeat 실패 silently 무시 (UI 블록 방지)
- `clearQueueNumber` 실패 `.catch(() => undefined)`로 무시
- AlimTalk 발송 실패가 전체 흐름을 막지 않음 (try-catch + 로그)

### 사용자 복구 가능성
- **높음**: 재시도 메커니즘이 잘 갖춰짐

### 리스크: MEDIUM
- **Functions 타임아웃**: hotPath 120초, standard 120초. 트랜잭션 내에서 다중 쿼리 실행 시 Firestore 트랜잭션 타임아웃(60초) 위험
- **트랜잭션 재시도 한계**: `confirmReservation` 트랜잭션 내에서 loadQueueLiveMetrics(3개 병렬 쿼리) + promotionDocs 로드. 경합 심하면 트랜잭션 5회 재시도 후 실패 가능
- **setQueueStateBestEffort 실패 누적**: queueState가 부정확해지면 availableCapacity 표시 오류 → 사용자가 잘못된 정보로 판단
- **autoAdvanceQueue 실패**: scheduler가 실패하면 큐 진행이 멈출 수 있음. 1분마다 실행되나, 연속 실패 시 대기자 영원히 대기

---

## 요약 위험 매트릭스

| 위험 요소 | 등급 | 사용자 영향 | 개선 시급성 |
|-----------|------|------------|------------|
| 네트워크 실패 시 제출 상태 불명확 | **CRITICAL** | 제출 성공 여부 모름, 재제출 불가 | 높음 |
| 타임아웃/세션 만료 | MEDIUM | 대기번호 소멸, 재입장 필요 | 중간 |
| 서버 오류/queueState 불일치 | MEDIUM | 부정확한 대기 정보 표시 | 중간 |
| 동시성 | LOW-MEDIUM | 시스템이 자동 복구 | 낮음 |
| 정원 초과 | LOW | 갑작스러운 실패 경험 | 낮음 |
| 중복 제출 | LOW | 다중 방어선으로 보호 | 낮음 |
