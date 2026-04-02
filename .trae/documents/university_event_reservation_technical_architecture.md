---
title: Technical Architecture
doc-role: reference
status: active
precedence: 50
memory-type: product-reference
token-estimate: 900
required-for:
  - architecture review
  - cross-layer changes
optional-for:
  - content updates
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#reference-docs]

# Technical Architecture

## Essential (Post-Compact)

- 프런트엔드는 React 앱, 백엔드는 Firebase Functions와 Firestore/RTDB 조합이다.
- 공개 신청 흐름은 클라이언트와 callable 함수의 협업으로 성립한다.
- 큐 상태와 신청 상태를 함께 볼 때는 `functions/src/firestoreQueue.ts`를 우선 참조한다.
- 운영 문서보다 오래된 설명은 현재 코드 기준으로 다시 검증한다.

<!-- STATIC:START -->
## Layers

- Frontend: React 18 + TypeScript + Vite
- Client Data Access: Firebase SDK
- Backend: Firebase Functions
- Persistence: Firestore, Realtime Database
- Auth: Firebase Auth
- Notification: NHN Cloud AlimTalk

## Public Routes

- `/:schoolId/gate`
- `/:schoolId/queue`
- `/:schoolId/register`
- `/:schoolId/complete`
- `/:schoolId/lookup`

## Admin Routes

- `/admin/login`
- `/admin`
- `/admin/schools`
- `/admin/schools/:schoolId`
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 초기 설계 문서의 일부 API 표현은 현재 callable 함수 구조와 다를 수 있다.
- 최신 callable 목록은 `functions/src/index.ts`와 `functions/src/firestoreQueue.ts`를 본다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 오래된 세부 API 서술을 compact architecture reference로 정리.
