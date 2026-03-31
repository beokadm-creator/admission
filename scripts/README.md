# Queue Validation Scripts

이 디렉터리에는 현재 Firestore 단일 저장소 기준의 검증 스크립트와 과거 실험용 스크립트가 함께 있습니다.

## 현재 기준으로 사용해도 되는 스크립트

- `load-test-firestore-queue.mjs`
  - Firebase Emulator 기준의 기본 검증 스크립트입니다.
  - 동시성, 멱등성, 만료/경합 시나리오를 확인합니다.
  - 현재 운영 구조에서 가장 먼저 돌려야 하는 자동 검증입니다.

## 참고만 하고 운영 검증 기준으로는 사용하지 않는 스크립트

- `verify_queue_flow.cjs`
  - RTDB 기반 검증 흐름이 남아 있는 과거 스크립트입니다.
  - 현재 Firestore 단일 저장소 구조와 맞지 않으므로 운영 승인 판단에 사용하지 않습니다.

- `validate_100_per_60_queue.cjs`
  - 실서비스 프로젝트를 직접 때리는 예전 대량 검증 스크립트입니다.
  - RTDB 전제와 과거 배치 운영 로직을 포함하므로 현재 구조 기준의 승인 스크립트로 보지 않습니다.

- 그 외 `validate_*.cjs`
  - 일부는 여전히 참고용으로 의미가 있지만, 현재 큐의 핵심 판단 기준은 아닙니다.
  - 운영 승인 판단은 문서화된 수동 QA와 `load-test-firestore-queue.mjs` 결과를 우선합니다.

## 권장 검증 순서

1. Functions 빌드
```bash
cd functions
npm run build
cd ..
```

2. 에뮬레이터 실행
```bash
firebase emulators:start --only firestore,functions,auth
```

기본 포트:
- Firestore: `127.0.0.1:18085`
- Auth: `127.0.0.1:9099`
- Functions: `127.0.0.1:15005`

3. 자동 검증 실행
```bash
node scripts/load-test-firestore-queue.mjs --scenario all
```

개별 시나리오:
```bash
node scripts/load-test-firestore-queue.mjs --scenario concurrency
node scripts/load-test-firestore-queue.mjs --scenario idempotency
node scripts/load-test-firestore-queue.mjs --scenario expiry
```

4. 수동 브라우저 QA 실행

운영 안정성 판단에는 아래 문서를 같이 봅니다.

- `.trae/documents/firestore_queue_cutover_and_test_plan.md`
- `.trae/documents/queue_operational_stability_validation.md`

## 현재 운영 기준값

- 작성 세션 만료: `3분`
- `waiting` presence timeout: `30초`
- `eligible` presence timeout: `20초`
- 기본 `maxActiveSessions`: `60`
- 기본 `batchSize`: `1`
- 기본 `batchInterval`: `10초`

## 자동 검증으로 확인되는 것

- `joinQueue` 번호 중복 방지
- 동일 `requestId` 재호출 시 멱등성 유지
- `confirmReservation` 와 `forceExpireSession` 경합 시 단일 종결 상태 유지
- `queueState/current` 와 실제 reservation/registration 문서 수 일치

## 자동 검증만으로 부족한 것

아래 항목은 실제 브라우저 QA가 필요합니다.

- 대기 화면 새로고침 시 번호 유지
- 대기 화면 완전 이탈 시 `waiting` 30초 후 탈락
- `eligible` 상태에서 새로고침 시 자동 진입 복구
- `eligible` 상태에서 이탈 시 `20초` 후 다음 사용자 승격
- 작성 화면 새로고침 시 세션 복구
- 작성 화면 3분 초과 시 게이트로 복귀 및 자동 재진입 차단
