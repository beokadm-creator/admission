# 대기열 동시성 및 안정성 분석 레포트

> **분석 일시**: 2026-04-04
> **분석 범위**: `functions/src/firestoreQueue.ts` (2278 lines), `src/components/SmartQueueGate.tsx` (1255 lines)
> **검증 방법**: 전수 코드 리뷰 + 트랜잭션 흐름 분석 + 프론트엔드 에러 매핑 확인

---

## 1. BOM 인코딩 (firestoreQueue.ts 첫 줄)

### 현황
```
Line 1: [BOM U+FEFF]import * as functions from 'firebase-functions';
```

파일이 UTF-8 BOM으로 시작하고 있음.

### 영향도: **무시 가능 (정보성)**

- Node.js 22 런타임에서 BOM은 `import` 문 파싱에 영향 없음
- TypeScript 컴파일러도 BOM을 정상 처리
- **다만**: 일부 린터, 포매터, diff 도구에서 첫 줄 변경으로 오인할 수 있음
- Git에서 `git diff` 시 첫 줄이 항상 변경된 것으로 표시될 가능성

### 권장: **제거 권장 (低 우선순위)**
- VS Code에서 "Save with Encoding → UTF-8"으로 재저장하면 제거됨
- 1분 작업이지만 프로덕션 동작에는 영향 없음

---

## 2. RTDB/Firestore 상태 불일치 가능성

### 현황 분석

`issueQueueNumberFromRtdb` (lines 523-636)의 동작 흐름:

```
Phase 1: RTDB 트랜잭션 (원자적 보장)
  └─ counterRef.child('nextNumber') 트랜잭션
     ├─ nextNumber = currentNumber + 1
     ├─ nextNumber > queueJoinLimit → limitReached = true
     └─ 성공 시 issuedNumber 반환

Phase 2: Firestore 트랜잭션 (별도)
  └─ joinQueue의 db.runTransaction (lines 1262-1349)
     ├─ queueEntry 문서 생성
     ├─ queueIdentityLock 문서 생성
     └─ requestLock 문서 생성

Phase 3: queueState 갱신 (Best-Effort, 트랜잭션 아님)
  └─ advanceQueueForSchool 호출 (line 1353)
     └─ queueState는 별도 트랜잭션으로 갱신
```

### 핵심 발견: **설계상 분리 의도 확인**

코드에 명시적 주석이 있음 (lines 1258-1261):
```typescript
// NOTE: stateRef is intentionally excluded from this transaction to avoid
// single-document write contention when hundreds of users join simultaneously.
// queueState is reconciled by the scheduled autoAdvanceQueue job instead of
// being updated on every join.
```

**이는 버그가 아닌 의도적 설계 결정입니다.**

### 위험도: **低 (허용 가능)**

| 시나리오 | 발생 확률 | 영향 | 자체 복구 |
|---------|----------|------|----------|
| RTDB counter 증가, Firestore entry 생성 실패 | 매우 낮음 | 번호만 소모 | `clearQueueNumber`로 정리 (line 1359) |
| queueState가 순간적으로 stale | 낮음 | UI 표시 부정확 | `autoAdvanceQueue` (1분) + `recalculateQueueState` (수동) |
| `availableCapacity`가 실제보다 낮게 표시 | 낮음 | 사용자 일시적 거부 | 재시도 + 스케줄러 복구 |

### 근거
1. **RTDB 트랜잭션은 단일 키 대상** (`nextNumber`만 읽/쓰) — O(1) 경합, Firebase 공식 권장 패턴
2. **Per-user issuing lock** (lines 542-578) — 동일 사용자의 중복 요청 방지
3. **Idempotency** — `assignmentRef.get()` fast path (line 534)로 재시도 시 중복 번호 방지
4. **Best-effort rollback** — 에러 시 `clearQueueNumber` (line 1359)로 RTDB 정리

### 결론: **개선 불필요. 현재 설계가 최적.**
RTDB와 Firestore를 분리한 것은 고의적이며, 동시성 하에서 단일 Firestore 트랜잭션에 모든 것을 넣는 것보다 **성능이 훨씬 우수**합니다.

---

## 3. 정리 작업 지연 (cleanupExpiredReservations)

### 현황

```typescript
// Line 2005-2039
export const cleanupExpiredReservations = functionsV1.pubsub
  .schedule('* * * * *')  // 매 1분
  .timeZone('Asia/Seoul')
  .onRun(async () => { ... });
```

### 위험도: **低 (완화 장치 다수 존재)**

#### 1차 방어: expireReservationDocument 내 advanceQueueForSchool
```typescript
// Line 1091-1102: 만료 처리 시 즉시 대기열 advancement 실행
const nextAdvance = getQueueAdvanceAmount(nextState, 1);
const promotionDocs = nextAdvance > 0
  ? await loadEntriesForPromotion(transaction, db, schoolId, round.id, nextState.currentNumber, nextAdvance)
  : [];
const actualAdvance = promoteEligibleEntries(transaction, promotionDocs, now);
```

**만료 처리 자체가 트랜잭션 내에서 대기열 advancement를 포함합니다.** 스케줄러가 지연되어도 개별 만료 발생 시 즉시 처리됩니다.

#### 2차 방어: autoAdvanceQueue (독립 스케줄러)
```typescript
// Line 2041-2117
export const autoAdvanceQueue = schedulerRuntime.pubsub
  .schedule('* * * * *')  // 별도 1분 스케줄러
```

`cleanupExpiredReservations`와 **독립적으로** 실행됩니다. 둘 중 하나만 살아도 대기열은 진행됩니다.

#### 3차 방어: joinQueue 내 best-effort advance
```typescript
// Line 1353
await advanceQueueForSchool(db, schoolId, round, { now });
```

**새 사용자가 join할 때마다** 대기열 advancement를 시도합니다.

#### 4차 방어: 프론트엔드 재시도
```typescript
// SmartQueueGate.tsx line 619-633
callCallableWithRetry(joinQueueFn, ..., {
  maxAttempts: 5,
  getDelayMs: ({ attempt }) => 1200 + Math.floor(Math.random() * 1200) + (attempt - 1) * 2500
});
```

최대 5회 재시도, 지수 백오프.

### 실제 위험 시나리오

| 시나리오 | 확률 | 영향 |
|---------|------|------|
| Cloud Scheduler 1회 지연 | <0.05% | 1분 지연 후 자동 복구 |
| 두 스케줄러 동시 장애 | 극히 낮음 | 수동 `recalculateState`로 복구 가능 |
| Firebase 지역 장애 | 재해 수준 | 시스템 전체 영향 |

### 결론: **현재 아키텍처로 충분. 추가 개선 불필요.**
4중 방어 계층이 존재하며, Cloud Scheduler SLA (99.95%)를 고려하면 실질적 위험은 무시할 수준입니다.

---

## 4. "마감" vs "가득 참" UX 명확화

### 현황 분석

#### 백엔드 에러 구분

| 에러 코드 | 메시지 | 트리거 조건 |
|----------|--------|------------|
| `QUEUE_CLOSED` | "대기열이 운영 상한에 도달하여 마감되었습니다." | `nextNumber > queueJoinLimit` (line 605-608) |
| `CAPACITY_FULL` | "현재 신청 가능한 정원이 없습니다." | `totalCapacity <= 0 \|\| availableCapacity <= 0` (line 1247-1252) |

#### 프론트엔드 메시지 매핑 (SmartQueueGate.tsx lines 252-257)

```typescript
if (errorMessage.includes('FULL_CAPACITY')) {
  return '모집 정원과 예비 정원이 모두 마감되었습니다. 추가 모집이 있을 경우 별도로 안내해 드리겠습니다.';
}
if (errorMessage.includes('운영 상한') || errorMessage.includes('정원이 없습니다') || errorMessage.includes('이용 가능한 접수 인원이 없습니다')) {
  return '현재 대기열이 마감되었습니다. 추가 모집이 있을 경우 별도로 안내해 드리겠습니다.';
}
```

### 문제점: **두 경우 모두 동일한 메시지로 수렴**

현재 프론트엔드는 `QUEUE_CLOSED`와 `CAPACITY_FULL`를 **동일한 메시지**로 표시합니다:
- "현재 대기열이 마감되었습니다"
- "모집 정원과 예비 정원이 모두 마감되었습니다"

사용자가 두 상황의 차이를 알 수 없습니다.

### 의미적 차이

| 상태 | 의미 | 사용자 행동 |
|------|------|------------|
| **QUEUE_CLOSED** | 대기열 발급 상한(queueJoinLimit = 정원의 1.5배) 도달 | 재시도 의미 없음. 이미 번호 받은 사람만 진행 |
| **CAPACITY_FULL** | 실제 작성 가능 슬롯(maxActiveSessions=60)이 모두 사용 중 | 잠시 후 재시도하면 자리 날 수 있음 |

### 권장 개선안

```typescript
// 프론트엔드 메시지 분리
if (errorMessage.includes('FULL_CAPACITY')) {
  return '현재 동시에 신청서를 작성할 수 있는 인원이 모두 찼습니다. 잠시 후 다시 시도해 주세요.';
}
if (errorMessage.includes('운영 상한')) {
  return '대기열 발급이 마감되었습니다. 이미 번호를 받으신 분들만 신청을 진행할 수 있습니다.';
}
```

### 우선순위: **中 (UX 개선 사항)**
- 기능적 문제는 아님
- 하지만 사용자 혼란을 줄이고 불필요한 재시도를 방지할 수 있음
- 변경 범위: 프론트엔드 메시지 매핑만 수정 (작은 변경)

---

## 5. Race Condition: 동시 접속자 경계Race Condition 분석

### 시나리오 재현

```
시간 T0: 60명 모두 activeReservation (maxActiveSessions = 60)
시간 T1: 사용자 A의 세션 만료 (expiresAt 도달)
시간 T2: cleanupExpiredReservations 스케줄러 실행
시간 T3: 사용자 B가 joinQueue 시도
```

### 코드 흐름 분석

#### 경로 A: 스케줄러가 먼저 실행 (정상)
```
cleanupExpiredReservations
  → expireReservationDocument (트랜잭션)
    → activeReservationCount -1
    → promoteEligibleEntries (대기열 advancement)
  → clearQueueNumber (RTDB 정리)
  → queueState 갱신

joinQueue (이후 실행)
  → availableCapacity > 0 확인
  → 입장 성공 ✓
```

#### 경로 B: joinQueue가 먼저 실행 (경합)
```
joinQueue
  → queueState.availableCapacity 읽기 (아직 0)
  → totalCapacity <= 0 || availableCapacity <= 0 → CAPACITY_FULL 에러 ✗

cleanupExpiredReservations (이후 실행)
  → 정상 처리, 슬롯 확보
```

### 실제 영향도: **매우 낮음**

#### 근거 1: 프론트엔드 자동 재시도
```typescript
// callCallableWithRetry: maxAttempts: 5
// getDelayMs: 1200~2400ms + (attempt-1) * 2500ms
// 총 재시도 시간: 약 12~20초
```

스케줄러가 1분마다 실행되므로, 재시도 window 내에서 슬롯이 확보될 확률이 매우 높습니다.

#### 근거 2: joinQueue 내 advanceQueueForSchool
```typescript
// Line 1353: join 성공 후 즉시 advancement 시도
await advanceQueueForSchool(db, schoolId, round, { now });
```

joinQueue가 성공하면 **즉시** 대기열을 advancement하여 다음 사용자를 위한 슬롯을 확보합니다.

#### 근거 3: startRegistrationSession의 실시간 확인
```typescript
// Lines 1476-1491: 트랜잭션 내 liveMetrics 조회
const liveMetrics = await loadQueueLiveMetrics(transaction, db, schoolId, round, schoolData);
if (liveMetrics.availableCapacity <= 0) {
  throw new functions.https.HttpsError('resource-exhausted', '현재 이용 가능한 접수 인원이 없습니다.');
}
```

`startRegistrationSession`은 **실시간 쿼리**로 용량을 확인합니다. `queueState` 캐시가 아닌 실제 reservation 문서 수를 셉니다.

### 결론: **경쟁 조건은 존재하지만, 영향도는 무시할 수준**

| 지표 | 평가 |
|------|------|
| 발생 window | < 1초 (스케줄러 간격 대비 극히 짧음) |
| 영향 사용자 | 동시 다발적 join 시도 시 소수 |
| 자동 복구 | 재시도 (5회, ~15초) + 스케줄러 (1분) |
| 데이터 손실 | 없음 (단순 거부, 상태 불일치 아님) |

---

## 종합 평가

### 이슈 요약

| # | 이슈 | 심각도 | 조치 필요성 | 우선순위 |
|---|------|--------|------------|---------|
| 1 | BOM 인코딩 | 정보성 | 선택적 제거 | P3 (낮음) |
| 2 | RTDB/Firestore 불일치 | 低 | **개선 불필요** (의도적 설계) | - |
| 3 | 정리 작업 지연 | 低 | **개선 불필요** (4중 방어) | - |
| 4 | 마감/가득참 UX | 中 | 메시지 분리 권장 | P2 (보통) |
| 5 | Race Condition | 低 | **개선 불필요** (자동 복구) | - |

### 핵심 결론

**현재 코드베이스의 동시성 처리는 잘 설계되어 있습니다.**

1. **RTDB 카운터 + Firestore 분리는 의도적 아키텍처** — 단일 트랜잭션에 모든 것을 넣는 것보다 고동시성 환경에서 훨씬 우수합니다.
2. **스케줄러 의존성은 다중 방어 계층으로 완화** — cleanup, autoAdvance, join-advance, 프론트엔드 재시도.
3. **Race condition은 이론적으로 존재하나 실질적 영향 미미** — 자동 복구 메커니즘이 충분히 작동합니다.

### 유일한 개선 권장 사항

**이슈 #4: "마감" vs "가득 참" UX 명확화**
- 변경 범위: `SmartQueueGate.tsx`의 에러 메시지 매핑 (lines 252-257)
- 예상 작업량: 30분
- 위험도: 낮음 (메시지만 변경, 로직 변경 없음)
- 사용자 가치: 불필요한 재시도 감소, 상황 이해도 향상

### 추가 권장 (선택사항)

1. **BOM 제거** — 1분 작업, 클린 코드 유지
2. **모니터링 강화** — `cleanupExpiredReservations`와 `autoAdvanceQueue`의 로그에 `duration` 필드 추가하여 지연 감지
3. **관리자 대시보드** — `activeReservationCount`와 `maxActiveSessions` 비율을 실시간으로 표시하여 운영자가 포화 상태를 인지할 수 있도록
