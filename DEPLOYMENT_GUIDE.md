---
title: Deployment Guide
doc-role: canonical
status: active
precedence: 65
memory-type: operational-runbook
token-estimate: 1300
required-for:
  - production deployment
  - queue live operations
optional-for:
  - local development
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#runbooks]

# Deployment Guide

## Essential (Post-Compact)

- 라이브 전에는 `npm run build`와 `cd functions && npm run build`를 모두 통과시킨다.
- 공개 대기열 운영의 핵심 truth source는 `functions/src/firestoreQueue.ts`와 `src/components/SmartQueueGate.tsx`다.
- 큐 라이브 전에는 Functions 런타임, Firestore 인덱스, 학교별 `admissionRounds`, `queueSettings.maxActiveSessions`를 함께 확인한다.
- 코드 기준으로 4가지 공정성 원칙(서버 수락 순서, 1인 1번호, 상한 도달 시 즉시 마감, 중복 클릭 무영향)은 충족 상태다.
- RTDB는 Admin SDK 경로로만 사용하므로 클라이언트 개방보다 `databaseURL`과 카운터 경로 정상 동작 여부를 우선 확인한다.

<!-- STATIC:START -->
## Fairness Validation

| Principle | Status | Code basis |
| --- | --- | --- |
| 서버 수락 순서 | 충족 | `functions/src/firestoreQueue.ts`의 `counterRef.transaction()`이 RTDB `nextNumber`를 원자적으로 증가시킨다. 동일 ms 요청도 고유 번호를 받는다. |
| 1인 1번호 | 충족 | `queueEntries/{auth.uid}` 단일 entry, `queueIssuer/.../assignments/{userId}` 재사용, `queueIdentityLocks` 중복 차단의 3중 방어를 사용한다. |
| 500번 이후 즉시 마감 | 충족 | `getQueueJoinLimit()`은 `ceil(totalCapacity * 1.5)`를 사용하고, RTDB 발급 시 상한 초과를 `resource-exhausted`로 차단한다. Firestore에서도 `availableCapacity <= 0`를 한 번 더 검사한다. |
| 중복 클릭 무영향 | 충족 | 클라이언트 버튼 잠금과 쿨다운, 서버 request lock, 기존 entry 재사용, 사용자/IP rate limit이 함께 동작한다. |

## User-Facing Closure Behavior

- 마감은 오류 대신 안내 메시지로 보인다. `src/components/SmartQueueGate.tsx`의 `friendlyErrorMessage`는 운영 상한/정원 소진을 마감 문구로 바꿔 보여 준다.
- 마감 시 버튼은 비활성화되고 `접수 마감` 라벨과 설명 텍스트가 함께 노출된다.
- 대기열 진입자는 `schools/{schoolId}/queueEntries/{userId}` 문서로 개별 저장된다.

## Runtime Baseline

현재 코드 기준 런타임 설정은 다음과 같다.

| Function class | Runtime |
| --- | --- |
| `joinQueue` hot path | `minInstances=5`, `maxInstances=200`, `memory=512MB`, `timeout=120s` |
| `heartbeat` | `maxInstances=100`, `memory=256MB`, `timeout=30s` |
| `autoAdvanceQueue` scheduler | `minInstances=1`, `maxInstances=20`, `memory=1GB`, `timeout=300s` |
| standard callables | `minInstances=2`, `maxInstances=80`, `memory=512MB`, `timeout=120s` |

## Preflight

```bash
npm run build
npm run lint
cd functions
npm run build
```

## Firebase Config

```bash
firebase login
firebase functions:config:get
firebase functions:config:set nhn.appkey="YOUR_APP_KEY"
firebase functions:config:set nhn.secretkey="YOUR_SECRET_KEY"
firebase functions:config:set nhn.sender_key="YOUR_SENDER_KEY"
```

## Deployment Commands

```bash
firebase deploy
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

## Queue Readiness Inputs

Firestore `schools/{schoolId}` 문서에서 아래 값을 점검한다.

- `admissionRounds[].maxCapacity`: 정규 정원
- `admissionRounds[].waitlistCapacity`: 예비 정원
- `admissionRounds[].openDateTime`: ISO 문자열
- `admissionRounds[].enabled`: `true`
- `queueSettings.maxActiveSessions`: 동시 작성 인원
- `isActive`: `true`

`queueJoinLimit`은 `ceil((maxCapacity + waitlistCapacity) * 1.5)`다. 예를 들어 총 정원 350명이면 대기번호는 525번까지 발급된다.

## Live Runbook

### Phase 1: One Week Before

1. Functions 런타임 반영 여부 확인

```bash
firebase functions:list
```

`joinQueue`의 `minInstances=5`, `memory=512MB`가 실제 배포 값과 일치하는지 확인한다.

2. Firestore 인덱스 배포

```bash
firebase deploy --only firestore:indexes
```

`queueEntries`의 `(roundId, status, number)` 인덱스가 있어야 `loadEntriesForPromotion()`이 정상 동작한다.

3. RTDB 연결값 확인

Admin SDK는 rules를 우회하므로 핵심은 공개 read/write가 아니라 올바른 RTDB URL과 카운터 경로다. 현재 코드 기본값은 아래 URL이다.

```text
https://admission-477e5-default-rtdb.asia-southeast1.firebasedatabase.app
```

4. 학교 설정 데이터 검증

실운영 학교 문서에서 정원, 예비정원, 오픈 시각, queue 설정이 모두 채워졌는지 확인한다.

### Phase 2: One Day Before

5. Functions 배포

```bash
cd functions && npm run build && cd ..
firebase deploy --only functions
```

6. Warm-up 대기

배포 후 최소 10분 기다려 `minInstances`가 프로비저닝되도록 한다. GCP Console에서 `joinQueue` 활성 인스턴스가 5개 이상 유지되는지 확인한다.

7. 스모크 테스트

- 오픈 전: 버튼 비활성화와 카운트다운 표시 확인
- 테스트 라운드 오픈 후: 번호 정상 발급 확인
- 같은 계정 재클릭: 동일 번호 재반환 확인
- 다른 계정 + 다른 이름/폰: 새 번호 발급 확인

### Phase 3: Day Of, 30 Minutes Before Open

8. 모니터링 화면 준비

- Firebase Console Functions Logs: `joinQueue` 필터
- Firebase RTDB: `queueIssuer/{schoolId}/{roundId}/nextNumber`
- Firestore: `schools/{schoolId}/queueState/{roundId}`
- GCP Console: `joinQueue` 인스턴스 수, 지연 시간, 에러율

9. 오픈 직후 체크

| Window | Check | Healthy signal |
| --- | --- | --- |
| 0-10초 | RTDB `nextNumber` 증가 | 초당 수십 건 이상 증가 |
| 0-30초 | `joinQueue` 에러율 | 5% 미만, 주로 재시도/빈도 제한 |
| 30초-1분 | `nextNumber`가 `queueJoinLimit` 도달 시 | 마감 메시지와 버튼 비활성화로 전환 |
| 1분 | `autoAdvanceQueue` 첫 실행 | `currentNumber` 증가, `eligible` 전환 시작 |
| 1-3분 | `activeReservationCount` | `maxActiveSessions` 근처 |
| 3분 이후 | `confirmedCount` | 제출 완료 인원 누적 |

### Phase 4: Incident Response

#### 서버가 느리다는 신고

- RTDB 번호 발급은 원자 카운터이므로 병목은 주로 Functions 대기나 네트워크 재시도 구간이다.
- 클라이언트는 장시간 처리 시 `서버가 처리 중입니다 (Xs)... 화면을 닫지 마세요` 안내를 이미 노출한다.
- 자동 재시도는 최대 5회 백오프로 동작한다.

#### 마감인데 오류 아니냐는 문의

- 화면은 `현재 대기열이 마감되었습니다` 문구를 gray 톤으로 노출한다.
- 버튼은 비활성화되고 `접수 마감` 라벨이 표시된다.
- 운영상 정상 마감 상태로 안내한다.

#### 특정 사용자가 번호를 못 받은 경우

- `queueJoinLimit` 초과면 정상 마감이다.
- `availableCapacity <= 0`면 정원 소진 마감이다.
- `already-exists` 메시지면 같은 이름+폰 조합이 기존 대기열 또는 신청서에 묶여 있다.

#### `autoAdvanceQueue`가 돌지 않는 경우

- Cloud Scheduler의 `firebase-schedule-autoAdvanceQueue` 1분 주기 실행 여부를 확인한다.
- 필요 시 Firebase Console에서 `autoAdvanceQueue`를 수동 실행한다.

## Minimum Checks

- 관리자 로그인 가능 여부
- 학교 공개 페이지 진입 가능 여부
- 대기열 입장과 신청서 작성 가능 여부
- 조회 및 취소 callable 정상 동작 여부
- AlimTalk 실패 시 graceful degradation 유지 여부

## Key Numbers

| Item | Value | Basis |
| --- | --- | --- |
| 대기번호 상한 | `totalCapacity * 1.5` 올림 | `getQueueJoinLimit()` |
| 동시 작성 인원 | 학교별 `maxActiveSessions` | `queueSettings.maxActiveSessions` |
| 작성 시간 | 3분 | `DEFAULT_SESSION_MS` |
| 제출 유예 | 90초 | `SESSION_SUBMIT_GRACE_MS` |
| 큐 진행 주기 | 1분 | `autoAdvanceQueue` 스케줄 |
| 만료 정리 주기 | 1분 | `cleanupExpiredReservations` 스케줄 |
| 클라이언트 재시도 | 최대 5회 백오프 | `SmartQueueGate` callable retry |

<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- Functions 런타임은 현재 Node.js 22 기준이다.
- `firestore.indexes.json`에는 `queueEntries`용 `(roundId, status, number)` 및 관련 인덱스가 포함되어 있다.
- `database.rules.json`은 기본적으로 closed 상태이며, RTDB 큐 카운터는 Functions Admin SDK 경로로만 사용한다.
- 2026-04-03 검증 기준으로 프런트/Functions 빌드는 통과했다.
- 저장소 전체 ESLint는 큐 변경과 무관한 기존 `any`/unused 규칙 위반까지 포함해 아직 fail 상태다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-03: 큐 공정성 검증 결과와 라이브 운영 Phase 1-4 runbook을 배포 가이드에 통합.
- 2026-04-02: 기존 테스트 중복 체크리스트를 제거하고 runbook 형태로 재작성.
