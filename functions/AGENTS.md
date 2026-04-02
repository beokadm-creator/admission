---
title: Functions Agent Guide
doc-role: canonical
status: active
precedence: 85
memory-type: domain-guide
token-estimate: 700
required-for:
  - backend changes
  - queue callable updates
optional-for:
  - frontend-only work
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#agent-guides]

# Functions Agent Guide

## Essential (Post-Compact)

- 큐 핵심 로직은 `functions/src/firestoreQueue.ts`가 우선이다.
- `functions/src/index.ts`는 export, 조회/취소, 알림 보조 로직을 가진다.
- AlimTalk 자격 증명은 Firebase config와 `schools/{schoolId}/privateSettings/alimtalk`를 함께 본다.
- 백엔드 변경 시 권한, idempotency, rate limit, graceful degradation을 함께 검토한다.

<!-- STATIC:START -->
## Where To Look

- 큐 입장: `joinQueue`
- 작성 시작: `startRegistrationSession`
- 제출 확정: `confirmReservation`
- 세션 만료: `forceExpireSession`, `cleanupExpiredReservations`
- 운영 보조: `autoAdvanceQueue`, `runAdminQueueAction`, `resetSchoolState`
- 조회/취소: `lookupRegistration`, `cancelRegistration`

## Stable Conventions

- callable 입력은 normalize helper를 거친다.
- 관리자 전용 작업은 admin access 검증을 거친다.
- 공용 사용자 흐름은 인증, request lock, rate limit을 함께 고려한다.
- AlimTalk 발송 실패는 전체 흐름을 막지 않도록 처리한다.
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 현재 queue 관련 export는 `functions/src/firestoreQueue.ts`에서 재-export 된다.
- Functions 런타임은 Node.js 22다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 실제 backend 구조에 맞게 slim guide로 재작성.
