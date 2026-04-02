---
title: Firestore Queue Cutover Plan
doc-role: reference
status: active
precedence: 48
memory-type: task-history
token-estimate: 650
required-for:
  - queue migration review
optional-for:
  - normal feature work
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#task-history]

# Firestore Queue Cutover And Test Plan

## Essential (Post-Compact)

- 이 문서는 Firestore 기반 큐 전환 작업의 계획/검증 기록이다.
- 현재 운영 판단에는 `functions/src/firestoreQueue.ts`와 `scripts/README.md`를 우선 사용한다.
- 남길 핵심은 전환 시 검증해야 할 시나리오와 관찰 포인트다.

<!-- STATIC:START -->
## Core Scenarios

- 대기열 입장 idempotency
- 작성 세션 시작과 만료
- 제출 확정과 수용 인원 반영
- 관리자 개입 후 상태 일관성
- 장애 또는 중단 이후 재진입
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 전환 완료 여부는 문서가 아니라 현재 코드 구조를 보고 판단한다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 세부 절차를 줄이고 컷오버 핵심 시나리오만 남김.
