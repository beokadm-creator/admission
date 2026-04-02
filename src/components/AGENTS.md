---
title: Components Agent Guide
doc-role: canonical
status: active
precedence: 84
memory-type: domain-guide
token-estimate: 500
required-for:
  - shared component changes
optional-for:
  - functions-only work
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#agent-guides]

# Components Agent Guide

## Essential (Post-Compact)

- 공용 컴포넌트는 도메인 특수 로직보다 재사용성과 명확한 props를 우선한다.
- 공개 신청 진입 UI는 `SmartQueueGate.tsx`가 핵심이다.
- 관리자 보호는 `AdminRoute.tsx`에서 처리한다.
- 공용 컴포넌트 안에서 직접 데이터 저장소를 쿼리하지 않는다.

<!-- STATIC:START -->
## Key Files

- `AdminRoute.tsx`: 관리자 접근 보호
- `Empty.tsx`: 공통 빈 상태
- `RegistrationList.tsx`: 관리자 신청 목록 테이블
- `SchoolPopup.tsx`: 학교별 공지 팝업
- `SmartQueueGate.tsx`: 공개 신청 진입, 대기열, 상태 안내
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 문서상의 `QueueController`는 현재 코드에 없으며 `SmartQueueGate`가 해당 역할을 확장해서 담당한다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 실제 컴포넌트 목록에 맞게 갱신하고 오래된 항목 제거.
