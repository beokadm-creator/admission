---
title: Script Operations Guide
doc-role: runbook
status: active
precedence: 60
memory-type: operational-runbook
token-estimate: 700
required-for:
  - queue validation
optional-for:
  - day-to-day frontend work
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#runbooks]

# Queue Validation Scripts

## Essential (Post-Compact)

- 현재 기준 핵심 검증 스크립트는 `load-test-firestore-queue.mjs`다.
- 나머지 `validate_*.cjs`, `verify_queue_flow.cjs`는 과거 흐름 참고용이다.
- 자동 검증 결과만으로 충분하지 않으며 브라우저 기반 수동 QA가 필요하다.

<!-- STATIC:START -->
## Recommended Flow

1. `cd functions && npm run build`
2. 루트에서 Firebase emulator 실행
3. `node scripts/load-test-firestore-queue.mjs --scenario all`
4. 필요 시 개별 시나리오 실행
5. 공개 신청 진입부터 제출 완료까지 수동 QA 수행

## Commands

```bash
cd functions
npm run build
cd ..
firebase emulators:start --only firestore,functions,auth
node scripts/load-test-firestore-queue.mjs --scenario all
node scripts/load-test-firestore-queue.mjs --scenario concurrency
node scripts/load-test-firestore-queue.mjs --scenario idempotency
node scripts/load-test-firestore-queue.mjs --scenario expiry
```

## Script Roles

- `load-test-firestore-queue.mjs`: 현재 구조 기준 주 검증 도구
- `createAdmin.cjs`: 로컬 또는 운영 보조 작업
- `validate_*.cjs`: 과거 RTDB 또는 이전 검증 흐름 참고
- `verify_queue_flow.cjs`: 역사적 참고
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 스크립트가 참조하는 포트와 에뮬레이터 구성은 실행 시점 환경과 `firebase.json`을 함께 확인한다.
- 운영 검증 세부 시나리오는 `.trae/documents/firestore_queue_cutover_and_test_plan.md`와 `.trae/documents/queue_operational_stability_validation.md`를 참고한다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 현행 스크립트와 과거 스크립트를 분리해서 문서화.
