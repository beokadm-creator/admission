# Queue System Logic Audit - Detailed Analysis

## Executive Summary

트래픽 분산 대기열 시스템에 대한 종합 분석 완료. **Critical** 3건, **Medium** 4건, **Low** 2건의 문제점 발견.

---

## Critical Issues (데이터 손상 가능성)

### 🔴 1. Cross-Store Consistency Risk (Firestore ↔ RTDB)

**Severity**: CRITICAL
**Location**: `functions/src/index.ts`
- Firestore capacity updates: lines 1470-1496, 1517
- RTDB slots/reservation: lines 2710-2721, 2891-2900

**Problem**:
- Firestore의 등록 카운터(`stats.confirmedCount`, `stats.waitlistedCount`)와 RTDB의 슬롯/큐 상태가 별도의 트랜잭션으로 관리됨
- 단일 사용자 여정(RTDB 예약 → Firestore 등록 → 큐 상태)에 대한 교차 DB 트랜잭션이 없음
- 극한 동시성 상황에서 일시적 불일치 발생 가능

**Reproduction Scenario**:
```
Timeline:
T1: RTDB에서 마지막 슬롯 예약 성공
T2: Firestore 등록 진행 중 (트랜잭션 내)
T3: 다른 요청이 RTDB에서 동일 슬롯 예약 시도
T4: Firestore 트랜잭션 완료 전 RTDB와 Firestore 카운터 불일치

Result: 일시적 오버부킹 또는 언더부킹 발생
```

**Impact**:
- 과다 판매 (overselling) - 실제 용량보다 많은 등록 허용
- 사용자 경험 혼란 - confirmed했다가 waitlisted로 변경
- 데이터 무결성 훼손 - 재결 필요

**Recommended Fix**:
```
Option 1: Firestore as source of truth
- RTDB 슬롯을 Firestore 트랜잭션 내에서 업데이트
- RTDB는 읽기 전용 뷰로만 사용

Option 2: Reconciliation job
- Firestore finalize 후 RTDB 슬롯 검증
- 불일치 시 보상 트랜잭션 트리거

Option 3: Distributed transaction pattern
- 두 데이터베이스 업데이트를 순차적이고 원자적으로 수행하는 래퍼 함수
```

---

### 🔴 2. Missing Server-Side Idempotency in joinQueue

**Severity**: CRITICAL
**Location**: `functions/src/index.ts` - joinQueue function (현재 코드에서 누락됨)

**Problem**:
- 프론트엔드는 중복 참여 방지 가드가 있으나 서버 측 idempotency 검증이 누락
- 같은 사용자가 네트워크 오류로 재시도 시 중복 큐 엔트리 생성 가능성
- 현재 joinQueue 함수 정의가 코드에서 확인되지 않음

**Reproduction Scenario**:
```
1. 사용자 A가 큐 참여 버튼 클릭
2. joinQueue callable 호출 (RTDB 트랜잭션 시작)
3. 네트워크 지연 또는 타임아웃 발생
4. 사용자가 다시 버튼 클릭
5. 두 번째 joinQueue 호출이 서버 도달
6. 서버에 idempotency 체크가 없으면 중복 엔트리 생성

Result: 한 사용자가 여러 큐 번호를 소지하게 됨
```

**Impact**:
- 한 사용자가 여러 큐 번호 소지
- 용량 계산 오류 (실제보다 적은 용량으로 표시)
- AlimTalk 중복 발송
- 형평성 문제

**Recommended Fix**:
```typescript
// joinQueue 함수 시작 부분에 추가
async function joinQueue(data) {
  const { schoolId, userId } = data;

  // Idempotency check
  const existingEntryRef = admin.database()
    .ref(`queue/${schoolId}/entries/${userId}`);

  const snapshot = await existingEntryRef.once('value');
  if (snapshot.exists()) {
    const existingData = snapshot.val();
    // 기존 엔트리 반환, 중복 생성 방지
    return {
      success: true,
      queueNumber: existingData.number,
      message: 'Already in queue'
    };
  }

  // ... 기존 로직 계속
}
```

---

### 🔴 3. Auto-Advance Queue Race Condition

**Severity**: CRITICAL
**Location**: `functions/src/index.ts`, lines 2024-2097 (`autoAdvanceQueue`)

**Problem**:
- 여러 Cloud Functions 인스턴스에서 `autoAdvanceQueue`가 병렬 실행될 수 있음
- `currentNumber` 업데이트에 교차 인스턴스 트랜잭션 보호가 없음
- `lastAdvancedAt`/`currentNumber`가 race condition 발생 가능

**Reproduction Scenario**:
```
Instance 1: Read queueMeta (currentNumber: 5, lastAssignedNumber: 10)
Instance 2: Read queueMeta (currentNumber: 5, lastAssignedNumber: 10)
Instance 1: Calculate newCurrentNumber = 6
Instance 2: Calculate newCurrentNumber = 6
Instance 1: Write currentNumber = 6, lastAdvancedAt = T1
Instance 2: Write currentNumber = 6, lastAdvancedAt = T2

Result: currentNumber가 제대로 진행되지 않음, 큐가 멈춤
```

**Impact**:
- 큐 진행 중단 - currentNumber가 증가하지 않음
- 사용자 대기 시간 무한 증가
- 시스템 신뢰도 하락
- 수동 개입 필요

**Recommended Fix**:
```typescript
// Option 1: Multi-location transaction
admin.database().ref(`queue/${schoolId}`).transaction((currentData) => {
  // 모든 관련 데이터를 단일 트랜잭션에서 업데이트
  const meta = currentData.meta;
  const slots = currentData.slots;

  const newCurrentNumber = calculateNewCurrent(meta, slots);
  meta.currentNumber = newCurrentNumber;
  meta.lastAdvancedAt = Date.now();

  return currentData;
});

// Option 2: Distributed lock
const lockRef = admin.database().ref(`locks/queue/${schoolId}`);
await lockRef.set(true);
try {
  // auto-advance 로직 수행
} finally {
  await lockRef.remove();
}
```

---

## Medium Risk Issues (고부하 시 발생 가능)

### ⚠️ 4. Orphaned Queue Entries

**Severity**: MEDIUM
**Location**: RTDB `entries/{userId}` - No cleanup mechanism

**Problem**:
- `onDisconnect` 또는 TTL 기반 정리 메커니즘이 없음
- 연결이 끊어지거나 사용자가 이탈한 경우 엔트리가 영구적으로 남음
- 용량 계산 왜곡 가능

**Impact**:
- 실제 용량보다 적게 표시 (orphaned entries가 용량 차지)
- 유효한 사용자가 참여 불가
- 주기적인 수동 정리 필요
- 시스템 관리 오버헤드

**Recommended Fix**:
```typescript
// Option 1: onDisconnect cleanup
admin.database().ref(`queue/${schoolId}/entries/${userId}`)
  .onDisconnect()
  .remove();

// Option 2: TTL-based cleanup (Scheduled function)
exports.cleanupOrphanedEntries = functions.pubsub
  .schedule('every 30 minutes')
  .onRun(async (context) => {
    const cutoff = Date.now() - (60 * 60 * 1000); // 1 hour
    const queueRef = admin.database().ref(`queue/${schoolId}/entries`);

    const snapshot = await queueRef.once('value');
    const entries = snapshot.val();

    for (const [userId, entry] of Object.entries(entries)) {
      if (entry.lastSeenAt < cutoff) {
        await queueRef.child(userId).remove();
      }
    }
  });
```

---

### ⚠️ 5. Fragile Time-Based Expiration

**Severity**: MEDIUM
**Location**: Frontend (5-minute rule) vs Backend timeout enforcement

**Problem**:
- 프론트엔드는 5분 카운트다운 표시
- 백엔드의 명확한 만료/정리 로직이 확인되지 않음
- 두 서비스 간 시간 창 드리프트 가능

**Impact**:
- 사용자가 5분 내에 완료하지 못해도 세션이 유지될 수 있음
- 다른 사용자의 기회 박탈
- 형평성 문제
- 시스템 정책과 실제 동작 불일치

**Recommended Fix**:
```typescript
// Backend에 명확한 만료 로직 추가
exports.expireStaleReservations = functions.pubsub
  .schedule('every 1 minute')
  .onRun(async (context) => {
    const expirationWindow = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    const reservationsRef = admin.database()
      .ref(`reservations/${schoolId}`);

    const snapshot = await reservationsRef.once('value');
    const reservations = snapshot.val() || {};

    for (const [reservationId, reservation] of Object.entries(reservations)) {
      if (reservation.status === 'reserved' &&
          (now - reservation.reservedAt) > expirationWindow) {
        // 만료된 예약 취소
        await cancelReservation(reservationId, 'expired');
      }
    }
  });
```

---

### ⚠️ 6. RTDB Error Handling Gaps

**Severity**: MEDIUM
**Location**: `src/components/SmartQueueGate.tsx` - RTDB listeners

**Problem**:
- `onValue` subscriptions에 명시적 에러 핸들러 부족
- RTDB 연결 실패 시 UI가 loading 상태에 멈출 수 있음
- 복구 경로가 불분명

**Impact**:
- 사용자 경험 악화
- 시스템 상태 불확실
- 지원 티켓 증가
- 사용자 이탈

**Recommended Fix**:
```typescript
// RTDB listener에 에러 핸들러 추가
const metaRef = ref(database, `queue/${schoolId}/meta`);

onValue(metaRef, (snapshot) => {
  setQueueMeta(snapshot.val());
}, (error) => {
  console.error('RTDB meta listener error:', error);
  setErrorMessage('대기열 정보를 불러올 수 없습니다. 다시 시도해주세요.');
  setRetryAvailable(true);

  // Exponential backoff로 재시도
  setTimeout(() => {
    // 재연결 로직
  }, 1000);
});
```

---

### ⚠️ 7. Capacity Edge Case - Exact Threshold Race

**Severity**: MEDIUM
**Location**: `functions/src/index.ts` - `registerRegistration`

**Problem**:
- 용량이 정확히 임계값일 때 여러 요청이 동시에 도달 가능
- 트랜잭션 내에서 확인하지만 UI의 `remainingCapacity` 계산과 서버 상태 간 차이
- 지연 시 인한 불일치

**Impact**:
- 일시적 오버부킹 가능성
- 사용자 혼란 (confirmed 표시되었다가 waitlisted로 변경)
- 불만 제기
- 신뢰도 하락

**Recommended Fix**:
```typescript
// 프론트엔드에서 계산하지 않고 서버에서 확인
const result = await httpsCallable(functions, 'checkCapacity')({ schoolId });
if (!result.canJoin) {
  showErrorMessage('죄송합니다. 모집이 마감되었습니다.');
  return;
}

// 또는 Optimistic UI 대신 Server-First 패턴 사용
// 서버 응답 후에만 상태 업데이트
```

---

## Low Risk Issues (이론적 가능성)

### ⚡ 8. Negative Queue Position Guarding

**Severity**: LOW
**Location**: `src/components/SmartQueueGate.tsx`

**Problem**:
- 프론트엔드는 `max(0, ...)`으로 음수 방지
- 서버 측 명시적 불변성 강제가 없음
- RTDB 업데이트가 음수 생성 가능성 (이론적)

**Impact**:
- UI 깨짐 (음수 표시)
- 혼란 발생
- 실제 발생 가능성 낮음 (RTDB 트랜잭션이 보호)

**Recommended Fix**:
```typescript
// 서버 측에 불변성 검증 추가
admin.database().ref(`queue/${schoolId}`).transaction((data) => {
  if (data.meta.currentNumber < 0) {
    throw new Error('Invalid state: currentNumber cannot be negative');
  }
  return data;
});
```

---

### ⚡ 9. Missing Empty Queue UX State

**Severity**: LOW
**Location**: Frontend queue state management

**Problem**:
- 큐가 비었을 때 명시적 상태 표시가 없음
- `meta/entries` 데이터에만 의존
- 사용자에게 명확한 피드백 부족

**Impact**:
- 사용자 경험 미흡
- "내가 제일 먼저인가?" 혼란
- 기능적 문제 아님

**Recommended Fix**:
```typescript
// 빈 큐 상태에 대한 명시적 UI 추가
if (queueMeta.currentNumber === 0 && queueMeta.lastAssignedNumber === 0) {
  return (
    <EmptyQueueState>
      <h2>대기열이 비어있습니다</h2>
      <p>지금 바로 참여하여 첫 번째로 입장하세요!</p>
    </EmptyQueueState>
  );
}
```

---

## Edge Case Coverage Summary

### ✅ Handled
- **Capacity checks**: UI에서 `remainingCapacity` 계산 후 버튼 비활성화
- **Error recovery**: Cloud Functions 호출에 try/catch, 사용자 친화적 메시지
- **Per-user identity**: Firebase Anonymous Auth로 안정적인 사용자 ID 생성

### ⚠️ Partial
- **Empty queue scenarios**: RTDB `meta/entries`로 상태 파악하나 명시적 UX 부족
- **Invalid operations**: 프론트엔드 가드 존재, 서버 측 idempotency 미확실
- **Time-based scenarios**: 프론트엔드 카운트다운, 백엔드 만료 로직 불확실

### ❌ Missing
- **Orphaned entry cleanup**: `onDisconnect` 또는 TTL 기반 정리 없음
- **Negative position invariants**: 서버 측 명시적 불변성 강제 없음
- **Cross-store consistency**: Firestore ↔ RTDB 일관성 보장 없음

---

## Concurrency Risk Analysis

### Atomic Operations Present ✅

1. **Firestore registration creation** (lines 1449-1527)
   - 학교 문서 읽기, 중복 확인, 용량 확인, 카운터 증가, 등록 문서 생성
   - 모두 단일 트랜잭션 내에서 원자적 수행
   - Race condition safe within Firestore

2. **RTDB queue join** (lines 912-970)
   - `currentData`, `meta`, `entries` 읽기
   - `lastAssignedNumber` 증가, `entries` 업데이트
   - RTDB 트랜잭션으로 보호
   - Optimistic locking with retries

### Non-Atomic/Separated ⚠️

1. **Cross-store operations**
   - Firestore 등록 + RTDB 슬롯 업데이트가 별도 연산
   - 취소: Firestore 트랜잭션 후 RTDB 슬롯 업데이트 분리
   - **일관성 보장 없음**

2. **Auto-advance**
   - 스케줄된 실행 간 경합 조건 가능성
   - Multi-location 트랜잭션 사용하지 않음
   - **인스턴스 간 경합 가능**

### No Dedicated Promotion Transaction

- `waitlisted` → `confirmed` 승격이 별도 트랜잭션이 아님
- `onUpdate` 트리거가 AlimTalk만 발송
- 실제 상태 변경은 다른 흐름에서 처리
- **승격 원자성 없음**

---

## Recommendations

### 🚨 Immediate Actions (0-1 week)

1. **Implement server-side idempotency in joinQueue**
   - `userId + schoolId`로 기존 엔트리 확인
   - 존재하면 기존 번호 반환, 중복 생성 방지
   - **Estimated effort**: 2-3 hours

2. **Add cross-store reconciliation**
   - Firestore finalize 후 RTDB 슬롯 검증
   - 불일치 시 보상 트랜잭션 트리거
   - **Estimated effort**: 4-6 hours

3. **Implement orphaned entry cleanup**
   - `onDisconnect` 또는 스케줄된 cleanup job
   - TTL 설정 (예: 30-60분 비활동)
   - **Estimated effort**: 2-4 hours

### 📅 Short-term (1-4 weeks)

4. **Harden auto-advance concurrency**
   - Multi-location RTDB 트랜잭션으로 전환
   - 또는 deterministic single-writer 접근
   - **Estimated effort**: 6-8 hours

5. **Add explicit empty-queue signaling**
   - 백엔드에서 명확한 "큐 비어있음" 상태 노출
   - 프론트엔드에서 명시적 UX 상태 렌더링
   - **Estimated effort**: 2-3 hours

6. **Improve RTDB error resilience**
   - `onValue` listeners에 명시적 에러 핸들러
   - 재시도/백오프 전략
   - **Estimated effort**: 3-4 hours

### 🔮 Medium-term (1-3 months)

7. **Unify capacity tracking source of truth**
   - Firestore와 RTDB 중 단일 용량 소스 선택
   - 다른 하나는 동기화된 뷰로만 사용
   - **Estimated effort**: 16-24 hours (architectural change)

8. **Add comprehensive observability**
   - 트랜잭션 재시도 메트릭
   - 교차 store 작업 로깅
   - 경합 조건 이벤트 알림
   - **Estimated effort**: 8-12 hours

9. **Expand edge-case testing**
   - 고부하 동시성 시뮬레이션
   - 경계 조건 (마지막 슬롯, 정확한 용량 임계값)
   - 시간 기반 만료 시나리오
   - **Estimated effort**: 12-16 hours

---

## Test Plan Recommendations

### Concurrency Tests

1. **Last-slot reservation race**
   - N개의 동시 요청이 마지막 슬롯 시도
   - 정확히 1개만 성공하는지 확인
   - 도구: Artillery, k6

2. **Simultaneous cancellation+registration**
   - 취소와 등록이 동시에 발생
   - 카운터 일관성 검증
   - 재현 가능한 시나리오 작성

3. **Auto-advance stress test**
   - 여러 인스턴스에서 동시 실행
   - `currentNumber` 정확성 확인
   - 장시간 실행 테스트

### Edge Case Tests

1. **Empty queue → first join**
2. **Exact capacity threshold transitions**
3. **Re-join attempts by same user**
4. **Timeout expiration scenarios**
5. **Orphaned entry cleanup**

---

## Files Requiring Changes

### Backend
**File**: `functions/src/index.ts`

- **joinQueue**: Idempotency 추가 (lines 912-970)
- **autoAdvanceQueue**: 경합 조건 보호 (lines 2024-2097)
- **cancelRegistration**: RTDB 슬롯 업데이트를 트랜잭션 내로 이동 고려 (lines 2815-2910)
- **New**: Orphaned entry cleanup function
- **New**: Cross-store reconciliation job
- **New**: Time-based expiration job

### Frontend
**File**: `src/components/SmartQueueGate.tsx`

- RTDB listeners에 에러 핸들러 추가
- 빈 큐 상태에 대한 명시적 UI 추가
- 재시도/백오프 로직 강화
- Server-First 패턴 고려

### Infrastructure
- **Firestore/RTDB 규칙**: 불변성 강대 추가
- **모니터링**: 알림 설정
- **로그**: 집계 및 분석

---

## Summary Statistics

| Severity | Count | Impact | Effort to Fix | Priority |
|----------|-------|--------|---------------|----------|
| 🔴 Critical | 3 | Data corruption, system reliability | High (16-24h) | **P0** |
| ⚠️ Medium | 4 | User experience, data consistency | Medium (12-20h) | P1 |
| ⚡ Low | 2 | UX polish | Low (4-6h) | P2 |
| **Total** | **9** | | **32-50 hours** | |

---

## Next Steps

이 보고서를 바탕으로 다음 중 하나를 선택할 수 있습니다:

1. **즉시 수정 계획 수립** - Critical 3건에 대한 수정 작업을 워크 플랜으로 생성
2. **상세 구현 가이드** - 특정 이슈에 대한 구체적인 코드 수정 가이드 작성
3. **테스트 전략 수립** - 동시성 테스트를 위한 테스트 계획 작성
4. **아키텍처 재검토** - Firestore/RTDB 이중 저장소 구조 재평가

어떤 방향으로 진행하시겠습니까?
