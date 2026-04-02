# Firestore 큐 시스템 부하/정합성 테스트 스크립트

## TL;DR

> **Quick Summary**: Firebase Emulator 환경에서 Firestore 큐 시스템의 동시성, 멱등성, 만료/경합을 검증하는 단일 Node.js 테스트 스크립트를 생성합니다.
>
> **Deliverables**:
> - `scripts/load-test-firestore-queue.mjs` — 3가지 시나리오 내장의 자족 테스트 스크립트
> - `scripts/README.md` — 실행 방법, 전제 조건, 검증 체크리스트
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 (순차 의존)

---

## Context

### Original Request
Firebase Emulator + Node.js 스크립트로 Firestore 단일 저장소 큐/예약/확정 흐름의 정합성을 부하 조건에서 검증하라. 테스트 시나리오 3종(동시성, 멱등성, 만료/경합)을 포함하고, 테스트 후 6개 컬렉션에 대한 자동 검증까지 수행해야 한다.

### Interview Summary
**Key Discussions**:
- Node.js 스크립트(k6/Artillery 대비)로 결정 — 프로젝트 환경과 호환성 최우선
- 익명 로그인으로 테스트 사용자 생성 — 별도 Auth 설정 불필요
- 테스트 학교 자동 생성 — 스크립트가 self-contained
- Firestore Admin SDK로 사후 검증 — callable 결과뿐 아니라 DB 상태까지 직접 확인

**Research Findings**:
- `normalizeCallableRequest` 래퍼가 있어 `functionsV1.https.onCall` 호출 시 `{ data, auth }` 구조 사용
- `assertSchoolOpen`이 `openDateTime` 과거, `isActive: true`를 검사하므로 테스트 학교에 반드시 필요
- Rate limit 5req/60s는 requestLock idempotency 체크 이후에 실행되므로 멱등성 테스트에 영향 없음
- `expireReservationDocument`이 transaction 기반이므로 만료/경합 시나리오에서 Firestore가 직렬화 보장

### Metis Review
Metis 타임아웃으로 skip. 직접 gap analysis로 대체.

---

## Work Objectives

### Core Objective
`scripts/load-test-firestore-queue.mjs`에 3가지 테스트 시나리오를 구현하여 Firebase Emulator에서 실행 가능한 자족 검증 스크립트를 만든다.

### Concrete Deliverables
- `scripts/load-test-firestore-queue.mjs`
- `scripts/README.md`

### Definition of Done
- [ ] `npm run test:load` (또는 `node scripts/load-test-firestore-queue.mjs`)로 에뮬레이터 환경에서 3시나리오 모두 PASS
- [ ] 6개 검증 포인트 전부 통과 (availableCapacity >= 0, lastAssignedNumber >= currentNumber, activeReservationCount 일치, 중복 활성 예약 없음, requestId 중복 처리 없음, 등록 수와 stats 일치)

### Must Have
- 3가지 시나리오: 동시성(100명 joinQueue), 멱등성(동일 requestId 10회), 만료/경합(confirm + expire 동시)
- 익명 로그인 기반 테스트 사용자 생성
- 테스트 학교 자동 생성 (openDateTime 과거, isActive: true, queueSettings.enabled: true)
- 테스트 후 Firestore Admin SDK로 6개 컬렉션 자동 검증
- 콘솔에 PASS/FAIL 결과 출력
- 에뮬레이터 주소 자동 감지 (FIRESTORE_EMULATOR_HOST, FUNCTIONS_EMULATOR_HOST)

### Must NOT Have (Guardrails)
- 프로덕션 Firestore/Firebase에 접근하는 코드 절대 포함 금지
- k6, Artillery 등 외부 도구 의존성 추가 금지
- Firebase Functions 소스 코드 수정 금지 — 스크립트는 호출자 역할만
- UI 변경, 프론트엔드 파일 수정 금지
- 테스트용 스크립트를 `src/`에 배치 금지

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO — 테스트 인프라가 본 플랜의 산출물
- **Automated tests**: YES (Tests-after) — 스크립트 자체가 테스트
- **Framework**: Node.js built-in (assert) + Firebase Admin SDK (사후 검증용)
- 에뮬레이터 실행 전제: `firebase emulators:start` 가 실행 중이어야 함

### QA Policy
에이전트는 스크립트 작성 후 다음을 실행하여 검증:
1. 에뮬레이터 환경에서 `node scripts/load-test-firestore-queue.mjs` 실행
2. 콘솔 출력에서 각 시나리오 PASS/FAIL 확인
3. 실패 시 로그 분석 후 수정

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — scaffolding):
├── Task 1: 에뮬레이터 전제 조건 확인 + 스크립트 골격 [quick]

Wave 2 (After Wave 1 — 시나리오 구현, MAX PARALLEL):
├── Task 2: 동시성 테스트 시나리오 구현 [unspecified-high]
├── Task 3: 멱등성 테스트 시나리오 구현 [unspecified-high]
└── Task 4: 만료/경합 테스트 시나리오 구현 [deep]

Wave 3 (After Wave 2 — 검증 + 문서):
├── Task 5: 사후 검증 로직 + 통합 [unspecified-high]
└── Task 6: README + 실행 명령 정리 [quick]

Wave FINAL (After ALL tasks):
├── F1: 에뮬레이터에서 3시나리오 전체 실행 검증 [deep]
└── F2: 결과 로그 + 검증 포인트 확인 [unspecified-high]

Critical Path: Task 1 → Task 2,3,4 → Task 5,6 → F1,F2
Max Concurrent: 3 (Wave 2)
```

### Agent Dispatch Summary
- **Wave 1**: 1 — Task 1 → `quick`
- **Wave 2**: 3 — Task 2 → `unspecified-high`, Task 3 → `unspecified-high`, Task 4 → `deep`
- **Wave 3**: 2 — Task 5 → `unspecified-high`, Task 6 → `quick`
- **FINAL**: 2 — F1 → `deep`, F2 → `unspecified-high`

---

## TODOs

- [ ] 1. 에뮬레이터 전제 조건 확인 및 스크립트 골격 생성

  **What to do**:
  - `scripts/load-test-firestore-queue.mjs` 파일 생성
  - Firebase Admin SDK (`firebase-admin`)을 사용하여 에뮬레이터에 연결하는 설정 코드
  - 익명 사용자 생성 헬퍼 (`admin.auth().createUser()`)
  - 테스트 학교 자동 생성 함수 — 필드: `isActive: true`, `openDateTime: 과거 ISO 문자열`, `maxCapacity: 30`, `waitlistCapacity: 10`, `queueSettings: { enabled: true, batchSize: 10, batchInterval: 5000 }`
  - callable 함수 호출 헬퍼 — HTTP POST to `http://localhost:{PORT}/{PROJECT_ID}/us-central1/{functionName}` (에뮬레이터 callable 규격)
  - CLI 인자 파싱 — `--scenario concurrency|idempotency|expiry|all`
  - 에뮬레이터 주소 자동 감지 — `process.env.FIREBASE_EMULATOR_HOST`, `process.env.PORT` (default: `127.0.0.1:5001` for Firestore, `127.0.0.1:5001` for Functions)
  - 테스트 전 기존 테스트 데이터 정리 (cleanup) 함수
  - 스크립트 진입점: `main()` — scenario별 분기

  **Must NOT do**:
  - 프로덕션 Firebase 프로젝트 참조 절대 금지
  - `firebase-functions` 종속성 추가 금지 (Admin SDK만 사용)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 골격 코드는 패턴이 명확하고 결정적
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: 브라우저 테스트용으로 불필요

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (sole task)
  - **Blocks**: Task 2, 3, 4, 5, 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `functions/src/firestoreQueue.ts:67-97` — `normalizeCallableRequest` 구조 (함수 호출 시 `{ data, auth }` 구조 이해)
  - `functions/src/firestoreQueue.ts:330-341` — `joinQueue`가 `schoolId` + `requestId`를 `data`에서 추출하는 방식

  **API/Type References**:
  - `functions/src/firestoreQueue.ts:13-24` — `QueueStateDoc` 인터페이스 (사후 검증 시 필드명 참고)
  - `functions/src/firestoreQueue.ts:26-34` — `QueueEntryDoc` 인터페이스
  - `functions/src/firestoreQueue.ts:36-49` — `ReservationDoc` 인터페이스
  - `functions/src/firestoreQueue.ts:51-57` — `RequestLockDoc` 인터페이스
  - `functions/src/firestoreQueue.ts:662-672` — `ALLOWED_FORM_FIELDS` (confirmReservation에 필요한 formData 필드)
  - `functions/src/firestoreQueue.ts:686-703` — `sanitizeFormData` 검증 규칙 (phone: `010\d{8}`, studentName 필수)

  **External References**:
  - Firebase Emulator callable 호출: `POST http://127.0.0.1:5001/{project}/us-central1/{funcName}` — body: `{ data: {...} }`, headers: `Authorization: Bearer {token}`, `Content-Type: application/json`

  **WHY Each Reference Matters**:
  - `normalizeCallableRequest` 패턴을 알아야 에뮬레이터에서 올바른 HTTP payload 구성 가능
  - `ALLOWED_FORM_FIELDS` + `sanitizeFormData` 규칙을 지키지 않으면 confirmReservation 호출 시 `invalid-argument` 에러 발생
  - 각 Doc 인터페이스는 사후 검증 시 어떤 필드를 읽어야 하는지 결정

  **Acceptance Criteria**:
  - [ ] `scripts/load-test-firestore-queue.mjs` 파일 존재
  - [ ] `node scripts/load-test-firestore-queue.mjs --help` 실행 시 사용법 출력

  **QA Scenarios**:

  ```
  Scenario: 스크립트가 에뮬레이터 없이 실행 시 친절한 에러 메시지
    Tool: Bash
    Preconditions: Firebase Emulator 미실행 상태
    Steps:
      1. node scripts/load-test-firestore-queue.mjs --scenario concurrency
      2. 에러 메시지에 "에뮬레이터가 실행 중이어야 합니다" 또는 Firebase 연결 에러 표시 확인
    Expected Result: 에뮬레이터 미실행임을 명시하는 메시지 출력 (undefined 에러 아님)
    Failure Indicators: "ECONNREFUSED" 원시 에러만 표시
    Evidence: .sisyphus/evidence/task-1-no-emulator.txt

  Scenario: --help 플래그로 사용법 확인
    Tool: Bash
    Preconditions: 스크립트 파일 존재
    Steps:
      1. node scripts/load-test-firestore-queue.mjs --help
    Expected Result: 사용 가능한 시나리오 목록과 전제 조건 안내
    Evidence: .sisyphus/evidence/task-1-help.txt
  ```

  **Commit**: YES
  - Message: `chore(scripts): add load test script skeleton for Firestore queue`
  - Files: `scripts/load-test-firestore-queue.mjs`

---

- [ ] 2. 동시성 테스트 시나리오 구현

  **What to do**:
  - Task 1의 스크립트 내에 `runConcurrencyTest(schoolId, userIds)` 함수 구현
  - 100명의 익명 사용자 생성 (테스트 시작 전 일괄 생성, userIds 배열 확보)
  - `Promise.all`로 100명이 동시에 `joinQueue({ schoolId, requestId: unique per user })` 호출
  - joinQueue 완료 후, 입장 가능한 사용자(=`eligible`) 중 30명을 랜덤 선택하여 `startRegistrationSession({ schoolId, requestId: unique })` 동시 호출
  - startRegistrationSession 완료 후, 세션 확보한 사용자 중 20명을 랜덤 선택하여 `confirmReservation({ schoolId, sessionId, formData: { studentName: '테스트{i}', phone: '0100000{i:04d}', agreedSms: true }, requestId: unique })` 동시 호출
  - 전화번호 중복 방지: `phone` 필드를 사용자별 고유하게 생성 (`0101000{i:04d}` 형식)
  - 각 단계의 성공/실패 카운트와 응답 시간을 측정하여 콘솔에 출력
  - 함수가 전체 흐름(joinQueue → startRegistrationSession → confirmReservation)을 하나의 테스트로 묶어서 실행

  **Must NOT do**:
  - 사용자 간 전화번호 중복 금지 — confirmReservation이 `already-exists` 에러 반환하면 정상 동작이 아님
  - `maxCapacity` 초과 시도 주의 — 테스트 학교 정원(30+10) 내에서 처리해야 정상 범위 테스트

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 비동기 동시성 제어와 에러 처리가 복잡
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: 터미널 스크립트로 불필요

  **Parallelization**:
  - **Can Run In Parallel**: YES (Task 3, 4와 병렬 가능)
  - **Parallel Group**: Wave 2 (with Task 3, 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `functions/src/firestoreQueue.ts:330-458` — `joinQueue` 전체 로직 (requestLock → rateLimit → transaction → result)
  - `functions/src/firestoreQueue.ts:460-588` — `startRegistrationSession` 전체 로직
  - `functions/src/firestoreQueue.ts:705-871` — `confirmReservation` 전체 로직 (duplicate phone check, capacity check)

  **API/Type References**:
  - `functions/src/firestoreQueue.ts:426` — `nextNumber = queueState.lastAssignedNumber + 1` (번호 발급 로직 이해)
  - `functions/src/firestoreQueue.ts:547-549` — `queueEntry.number > queueState.currentNumber` → `failed-precondition` (입장 불가 조건)
  - `functions/src/firestoreQueue.ts:783-791` — 중복 전화번호 검증 쿼리

  **External References**:
  - Firebase Emulator Auth: `admin.auth().createUser()`으로 익명 사용자 생성 후 `admin.auth().createCustomToken(uid)`로 토큰 발급 가능

  **WHY Each Reference Matters**:
  - `joinQueue`의 transaction 경합을 이해해야 100명 동시 호출 시 어떤 에러가 정상인지 판단 가능 (transaction conflict 재시도는 Firebase SDK가 자동 처리)
  - `startRegistrationSession`의 `queueEntry.number > queueState.currentNumber` 체크를 알아야 30명 선택 시 입장 가능한 사용자만 선택해야 함
  - `confirmReservation`의 중복 전화번호 검증을 위해 각 사용자에 고유 phone 필드 필수

  **Acceptance Criteria**:
  - [ ] 100명 joinQueue 호출 시 번호 중복(두 사용자가 같은 number)이 없어야 함
  - [ ] 30명 startRegistrationSession 호출 시 세션 중복(같은 사용자에게 활성 세션 2개)이 없어야 함
  - [ ] 20명 confirmReservation 호출 시 capacity 초과 에러가 발생하지 않아야 함 (테스트 학교 정원 범위 내)

  **QA Scenarios**:

  ```
  Scenario: 동시성 테스트 전체 실행
    Tool: Bash
    Preconditions: Firebase Emulator 실행 중, 테스트 학교 생성 완료 (Task 1)
    Steps:
      1. node scripts/load-test-firestore-queue.mjs --scenario concurrency
      2. 출력에서 "joinQueue: 100/100 success" 확인
      3. 출력에서 "startRegistrationSession: 30/30 success" 확인
      4. 출력에서 "confirmReservation: N/20 success" 확인 (N은 실제 성공 수)
      5. 출력에서 번호 중복 검증 결과 PASS 확인
    Expected Result: 모든 단계에서 예상 성공률 충족 + 번호 중복 0건
    Failure Indicators: "DUPLICATE NUMBER DETECTED" 로그
    Evidence: .sisyphus/evidence/task-2-concurrency.txt

  Scenario: 정원 초과 요청 시 적절히 거부
    Tool: Bash
    Preconditions: 동시성 테스트로 이미 정원이 거의 찬 상태
    Steps:
      1. 추가 10명이 confirmReservation 시도
      2. "resource-exhausted" 또는 "FULL_CAPACITY" 에러 확인
    Expected Result: 정원 초과 요청이 명확한 에러로 거부됨
    Evidence: .sisyphus/evidence/task-2-capacity-reject.txt
  ```

  **Commit**: YES (groups with Task 3, 4)
  - Message: `test(scripts): implement concurrency test scenario for Firestore queue`
  - Files: `scripts/load-test-firestore-queue.mjs`

---

- [ ] 3. 멱등성 테스트 시나리오 구현

  **What to do**:
  - `runIdempotencyTest(schoolId)` 함수 구현
  - 단일 익명 사용자 생성
  - 동일 `requestId`로 `joinQueue` 10회 순차 호출 — 매번 동일 `{ schoolId, requestId: "idem-test-001" }`
  - 동일 `requestId`로 `startRegistrationSession` 10회 순차 호출
  - 동일 `requestId`로 `confirmReservation` 5회 순차 호출
  - 각 호출의 응답을 비교 — 모든 응답이 동일한 결과를 반환하는지 검증
  - Firestore에서 `requestLocks` 컬렉션 조회 — 동일 requestId에 대해 문서가 정확히 1개인지 확인
  - Firestore에서 `queueEntries/{userId}` 문서 조회 — 번호가 1개만 할당되었는지 확인
  - Firestore에서 `reservations` 컬렉션에서 `userId` 기준 조회 — 활성 예약이 1개인지 확인

  **Must NOT do**:
  - `Promise.all`로 멱등성 테스트 호출 금지 — 순차 호출로 네트워크 재시도 시나리오 재현
  - 테스트 간 requestId 재사용 금지 — 시나리오 간 격리

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: requestLock 검증 로직과 응답 비교가 정교해야 함
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: 불필요

  **Parallelization**:
  - **Can Run In Parallel**: YES (Task 2, 4와 병렬 가능)
  - **Parallel Group**: Wave 2 (with Task 2, 4)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `functions/src/firestoreQueue.ts:343-346` — `getExistingRequestResult` → 기존 결과 반환 (멱등성 핵심)
  - `functions/src/firestoreQueue.ts:370-373` — transaction 내 lockSnapshot.exists 체크 (이중 검사)
  - `functions/src/firestoreQueue.ts:257-265` — `getExistingRequestResult` 구현

  **API/Type References**:
  - `functions/src/firestoreQueue.ts:51-57` — `RequestLockDoc` 타입 (type, userId, result 필드)

  **External References**:
  - 없음

  **WHY Each Reference Matters**:
  - `getExistingRequestResult`의 두 단계(트랜잭션 전 + 트랜잭션 내)를 이해해야 멱등성 검증 로직 설계 가능
  - `RequestLockDoc.result` 필드에 원본 응답이 저장되므로 10회 호출 모두 같은 result를 반환하는지 비교

  **Acceptance Criteria**:
  - [ ] joinQueue 10회 호출 모두 동일 `number` 반환
  - [ ] requestLocks에 해당 requestId 문서 정확히 1개
  - [ ] queueEntries에 해당 사용자 문서 정확히 1개
  - [ ] confirmReservation 5회 호출 모두 동일 `registrationId` 반환

  **QA Scenarios**:

  ```
  Scenario: 멱등성 테스트 전체 실행
    Tool: Bash
    Preconditions: Firebase Emulator 실행 중, 테스트 학교 생성 완료
    Steps:
      1. node scripts/load-test-firestore-queue.mjs --scenario idempotency
      2. 출력에서 "joinQueue 10x: all responses identical = true" 확인
      3. 출력에서 "startRegistrationSession 10x: all responses identical = true" 확인
      4. 출력에서 "confirmReservation 5x: all responses identical = true" 확인
      5. 출력에서 "requestLocks count: 1 (expected: 1) PASS" 확인
    Expected Result: 모든 멱등성 체크 PASS
    Failure Indicators: "MISMATCH: response N differs" 또는 "requestLocks count: X (expected: 1) FAIL"
    Evidence: .sisyphus/evidence/task-3-idempotency.txt
  ```

  **Commit**: YES (groups with Task 2, 4)
  - Message: `test(scripts): implement idempotency test scenario for Firestore queue`
  - Files: `scripts/load-test-firestore-queue.mjs`

---

- [ ] 4. 만료/경합 테스트 시나리오 구현

  **What to do**:
  - `runExpiryRaceTest(schoolId)` 함수 구현
  - 단일 익명 사용자 생성 후 joinQueue → startRegistrationSession으로 세션 확보
  - 세션 만료 시간을 3초로 짧게 설정하기 위해 서버의 `DEFAULT_SESSION_MS`(300000 = 5분)이 아닌, 테스트에서 세션 생성 후 수동으로 reservation 문서의 `expiresAt`를 3초 후로 덮어쓰기
  - 만료 1초 전(2초 대기 후)에 `confirmReservation({ schoolId, sessionId, formData: { studentName: '테스트', phone: '01000000001', agreedSms: true }, requestId: "race-confirm-001" })`과 `forceExpireSession({ schoolId, sessionId, requestId: "race-expire-001" })`을 `Promise.all`로 동시 호출
  - 두 호출 결과 확인 — 둘 중 하나만 성공, 나머지는 에러
  - Firestore에서 해당 reservation 문서의 최종 `status` 확인 — `confirmed` 또는 `expired` 중 하나만
  - Firestore에서 `queueState/current`의 `activeReservationCount`와 실제 활성 reservation 수 비교 — 일치해야 함
  - 추가: 여러 사용자(10명)가 동시에 만료 시나리오를 겪는 배치 버전도 실행
  - 각 사용자에 대해 confirmed/expired 중 하나만 최종 상태인지, 카운트 이중 감소/증가가 없는지 검증

  **Must NOT do**:
  - `setTimeout`만으로 타이밍 보장 금지 — `Date.now()` 기반 폴링으로 실제 만료 시점 근접에서 호출
  - 세션을 강제로 만료시킨 후 confirm이 성공하는 것을 기대 금지

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 타이밍 제어, Firestore 직접 문서 조작, 경합 상태 분석이 복잡
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: 불필요

  **Parallelization**:
  - **Can Run In Parallel**: YES (Task 2, 3와 병렬 가능)
  - **Parallel Group**: Wave 2 (with Task 2, 3)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `functions/src/firestoreQueue.ts:324-328` — `expireReservationDocument` signature (db, schoolId, reservationId, userId)
  - `functions/src/firestoreQueue.ts:336` — `db.runTransaction` 내에서 reservation.status 확인 후 전환
  - `functions/src/firestoreQueue.ts:295-297` — reservation이 이미 expired/cancelled/confirmed면 `{ expired: false }` 반환 (멱등)
  - `functions/src/firestoreQueue.ts:775-781` — confirmReservation 내에서 만료 시간 검증 + `deadline-exceeded` 에러

  **API/Type References**:
  - `functions/src/firestoreQueue.ts:65` — `DEFAULT_SESSION_MS = 5 * 60 * 1000` (300000ms, 덮어쓰기 대상)
  - `functions/src/firestoreQueue.ts:38-39` — `ReservationDoc.createdAt`, `ReservationDoc.expiresAt`

  **External References**:
  - Firebase Admin SDK: `admin.firestore().doc(...).update({ expiresAt: shortValue })` — 문서 직접 수정

  **WHY Each Reference Matters**:
  - `DEFAULT_SESSION_MS`가 5분이므로 테스트에서 `expiresAt`를 3초 후로 덮어써야 실제 테스트 가능
  - `expireReservationDocument`가 transaction 안에서 `reservation.status`를 체크하므로 confirm과 expire가 동시 실행되면 Firestore가 직렬화 — 이것이 검증하고자 하는 경합
  - `activeReservationCount` 정합성 검증을 위해 `expireReservationDocument`가 count를 어떻게 조정하는지(라인 301: `Math.max(0, ...-1)`) 이해 필요

  **Acceptance Criteria**:
  - [ ] confirm + expire 동시 호출 시 둘 중 정확히 하나만 성공
  - [ ] reservation 최종 status가 `confirmed` 또는 `expired` 중 하나
  - [ ] activeReservationCount가 실제 활성 reservation 수와 일치
  - [ ] 10명 배치 테스트에서 카운트 이중 감소/증가 없음

  **QA Scenarios**:

  ```
  Scenario: 단일 사용자 만료/경합 테스트
    Tool: Bash
    Preconditions: Firebase Emulator 실행 중, 테스트 학교 생성 완료
    Steps:
      1. node scripts/load-test-firestore-queue.mjs --scenario expiry
      2. 출력에서 "RACE RESULT: one success, one failure = true" 확인
      3. 출력에서 "final status is confirmed XOR expired = true" 확인
      4. 출력에서 "activeReservationCount consistent = true" 확인
    Expected Result: 경합 후 정확히 하나의 최종 상태 + 카운트 정합성 유지
    Failure Indicators: "BOTH succeeded" 또는 "activeReservationCount mismatch"
    Evidence: .sisyphus/evidence/task-4-expiry-race.txt

  Scenario: 10명 배치 만료 테스트
    Tool: Bash
    Preconditions: 동일
    Steps:
      1. node scripts/load-test-firestore-queue.mjs --scenario expiry
      2. 출력에서 "BATCH EXPIRY: 10 users, N confirmed, M expired, N+M=10" 확인
      3. 출력에서 "count consistency PASS" 확인
    Expected Result: 10명 모두 confirmed 또는 expired 중 하나 + 전체 카운트 정합
    Evidence: .sisyphus/evidence/task-4-expiry-batch.txt
  ```

  **Commit**: YES (groups with Task 2, 3)
  - Message: `test(scripts): implement expiry/race condition test scenario`
  - Files: `scripts/load-test-firestore-queue.mjs`

---

- [ ] 5. 사후 검증 로직 통합

  **What to do**:
  - `runPostTestVerification(schoolId)` 함수 구현 — 모든 시나리오 실행 후 호출
  - Firebase Admin SDK로 6개 컬렉션 조회:
    1. `schools/{schoolId}/queueState/current` → QueueStateDoc 읽기
    2. `schools/{schoolId}/queueEntries` 전체 스캔
    3. `schools/{schoolId}/reservations` 전체 스캔
    4. `schools/{schoolId}/registrations` 전체 스캔
    5. `schools/{schoolId}/requestLocks` 전체 스캔
  - 6개 검증 포인트 구현:
    1. `availableCapacity >= 0` — 음수면 FAIL ("잔여 인원이 음수입니다")
    2. `lastAssignedNumber >= currentNumber` — 아니면 FAIL ("발급 번호가 입장 기준보다 작습니다")
    3. `activeReservationCount` == 실제 `status in ['reserved','processing']`인 reservation 수 — 아니면 FAIL
    4. 동일 `userId`에 활성 reservation이 2개 이상이면 FAIL — `"User {uid} has N active reservations (expected <=1)"`
    5. 동일 `requestId`에 requestLocks 문서가 2개 이상이면 FAIL — `"RequestId {id} has N lock documents (expected 1)"`
    6. `registrations` 컬렉션 size == `queueState.confirmedCount + queueState.waitlistedCount` — 아니면 FAIL
  - 각 검증을 PASS/FAIL로 출력
  - 전체 결과: `X/6 PASS` 요약 출력
  - 시나리오 실행 후 자동으로 `runPostTestVerification` 호출하도록 `main()` 연결

  **Must NOT do**:
  - 검증을 생략하거나 warning 수준으로 처리 금지 — 모든 실패는 FAIL로 명시

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: 6개 검증 포인트의 정확한 Firestore 쿼리와 카운트 로직
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `playwright`: 불필요

  **Parallelization**:
  - **Can Run In Parallel**: YES (Task 6와 병렬 가능)
  - **Parallel Group**: Wave 3 (with Task 6)
  - **Blocks**: F1, F2
  - **Blocked By**: Task 2, 3, 4

  **References**:

  **Pattern References**:
  - `functions/src/firestoreQueue.ts:215-240` — `buildQueueStateDoc` 내 `availableCapacity` 계산: `totalCapacity - confirmedCount - waitlistedCount - activeReservationCount`
  - `functions/src/firestoreQueue.ts:282-322` — `recalculateQueueState` (서버 측 재계산 로직 — 검증 로직의 정답)

  **API/Type References**:
  - `functions/src/firestoreQueue.ts:13-24` — `QueueStateDoc` 필드명 참조
  - `functions/src/firestoreQueue.ts:51-57` — `RequestLockDoc` 필드명 참조

  **External References**:
  - Firebase Admin SDK: `admin.firestore().collection(...).where('status', 'in', [...]).get()`

  **WHY Each Reference Matters**:
  - `buildQueueStateDoc`의 `availableCapacity` 계산을 검증 로직에서 재현하면 서버 계산과 독립적으로 정합성 확인 가능
  - `recalculateQueueState`는 서버의 재계산 로직이므로, 검증 로직이 같은 계산을 수행하면 양쪽 결과 비교 가능

  **Acceptance Criteria**:
  - [ ] 6개 검증 포인트가 각각 PASS/FAIL로 출력됨
  - [ ] `--scenario all` 실행 시 모든 시나리오 완료 후 자동 검증 실행
  - [ ] 검증 실패 시 구체적인 실패 원인이 출력됨 (문서 ID, 값, 기대값 포함)

  **QA Scenarios**:

  ```
  Scenario: 동시성 테스트 후 사후 검증
    Tool: Bash
    Preconditions: 동시성 테스트 완료
    Steps:
      1. node scripts/load-test-firestore-queue.mjs --scenario all
      2. 마지막 "POST-TEST VERIFICATION" 섹션에서 "6/6 PASS" 확인
    Expected Result: 모든 검증 PASS
    Failure Indicators: "3/6 PASS" 또는 특정 검증 포인트 "FAIL" 출력
    Evidence: .sisyphus/evidence/task-5-verification.txt

  Scenario: 멱등성 테스트 후 requestLocks 검증
    Tool: Bash
    Preconditions: 멱등성 테스트 완료
    Steps:
      1. 멱등성 시나리오 실행
      2. 사후 검증에서 "requestLocks: no duplicate requestId PASS" 확인
    Expected Result: 각 requestId에 lock 문서 1개
    Evidence: .sisyphus/evidence/task-5-locks.txt
  ```

  **Commit**: YES (groups with Task 6)
  - Message: `test(scripts): add post-test verification for 6 Firestore collections`
  - Files: `scripts/load-test-firestore-queue.mjs`

---

- [ ] 6. README 작성 및 실행 명령 정리

  **What to do**:
  - `scripts/README.md` 생성
  - 전제 조건 명시:
    - Node.js 18+
    - Firebase CLI (`firebase-tools`) 설치
    - `npm install` 완료 (root + functions)
    - `functions` 디렉토리에서 `npm run build` 완료 (함수 컴파일)
  - 에뮬레이터 실행 명령: `firebase emulators:start --only firestore,functions,auth` 또는 `npm run emulators` (존재 시)
  - 테스트 실행 명령: `node scripts/load-test-firestore-queue.mjs --scenario all`
  - 개별 시나리오: `--scenario concurrency`, `--scenario idempotency`, `--scenario expiry`
  - 검증 체크리스트 (6개 포인트) 설명
  - 테스트 학교 설정 (capacity, batchSize 등) 설명
  - 에러 해결 가이드 (ECONNREFUSED, PERMISSION_DENIED 등)

  **Must NOT do**:
  - 불필요한 마크다운 장식 금지
  - 실제 존재하지 않는 npm script 참조 금지

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 문서화 작업, 패턴 명확
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - 없음

  **Parallelization**:
  - **Can Run In Parallel**: YES (Task 5와 병렬 가능)
  - **Parallel Group**: Wave 3 (with Task 5)
  - **Blocks**: F1, F2
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `functions/package.json` — `npm run build`, `npm run serve` 명령 확인

  **External References**:
  - Firebase Emulator 문서: `firebase emulators:start` 명령

  **WHY Each Reference Matters**:
  - `functions` 빌드가 선행되어야 에뮬레이터에서 함수가 로드됨

  **Acceptance Criteria**:
  - [ ] `scripts/README.md` 파일 존재
  - [ ] README에 기재된 명령어를 실제로 따라 할 수 있음 (에뮬레이터 실행 → 테스트 실행)

  **QA Scenarios**:

  ```
  Scenario: README의 명령어가 유효한지 확인
    Tool: Bash
    Preconditions: 에뮬레이터 실행 중
    Steps:
      1. README에 기재된 대로 `node scripts/load-test-firestore-queue.mjs --scenario idempotency` 실행
      2. 에러 없이 시나리오가 시작됨
    Expected Result: README 지침대로 실행 가능
    Evidence: .sisyphus/evidence/task-6-readme-valid.txt
  ```

  **Commit**: YES (groups with Task 5)
  - Message: `docs(scripts): add load test README with emulator setup guide`
  - Files: `scripts/README.md`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [ ] F1. **에뮬레이터 전체 실행 검증** — `deep`
  Firebase Emulator를 시작하고 `node scripts/load-test-firestore-queue.mjs --scenario all`을 실행.
  3가지 시나리오 모두 완료 후 사후 검증 결과를 확인.
  6개 검증 포인트가 모두 PASS인지 검증.
  실패 시 로그를 분석하고 원인을 보고.
  Output: `Scenarios [3/3 pass] | Verification [6/6 PASS] | VERDICT: APPROVE/REJECT`

- [ ] F2. **결과 로그 및 검증 포인트 확인** — `unspecified-high`
  각 시나리오의 콘솔 출력을 캡처하여 `.sisyphus/evidence/final-qa/`에 저장.
  동시성 테스트: 번호 중복 0건, 세션 중복 0건
  멱등성 테스트: 모든 응답 동일, requestLocks 1개/요청
  만료/경합 테스트: 단일 최종 상태, 카운트 정합
  Output: `Scenarios [N/N pass] | Evidence [N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `chore(scripts): add load test script skeleton for Firestore queue` — scripts/load-test-firestore-queue.mjs
- **Wave 2**: `test(scripts): implement concurrency, idempotency, and expiry test scenarios` — scripts/load-test-firestore-queue.mjs
- **Wave 3**: `test(scripts): add post-test verification and README` — scripts/load-test-firestore-queue.mjs, scripts/README.md

---

## Success Criteria

### Verification Commands
```bash
# 에뮬레이터 실행 (별도 터미널)
cd functions && npm run build && cd .. && firebase emulators:start --only firestore,functions,auth

# 전체 테스트
node scripts/load-test-firestore-queue.mjs --scenario all

# 개별 시나리오
node scripts/load-test-firestore-queue.mjs --scenario concurrency
node scripts/load-test-firestore-queue.mjs --scenario idempotency
node scripts/load-test-firestore-queue.mjs --scenario expiry
```

### Final Checklist
- [ ] 3가지 시나리오 모두 PASS
- [ ] 6개 검증 포인트 모두 PASS
- [ ] 에뮬레이터 환경에서만 동작 (프로덕션 접근 코드 없음)
- [ ] README 지침대로 재현 가능
