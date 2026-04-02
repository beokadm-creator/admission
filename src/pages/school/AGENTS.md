---
title: School Pages Agent Guide
doc-role: canonical
status: active
precedence: 84
memory-type: domain-guide
token-estimate: 650
required-for:
  - school-facing page changes
optional-for:
  - admin-only work
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#agent-guides]
@include [docs/standards/shared-rules.md#design-rules]

# School Pages Agent Guide

## Essential (Post-Compact)

- 공개 라우트의 시작점은 `/:schoolId/gate`다.
- 학교 공개 페이지는 `SchoolLayout`과 `SchoolContext`를 전제로 한다.
- 신청 폼은 `schoolConfig.formFields`와 `terms` 설정을 기반으로 동적으로 동작한다.
- 전화번호, 접수 가능 상태, 제출 완료 메시지는 사용자 신뢰에 직접 영향을 주므로 보수적으로 수정한다.

<!-- STATIC:START -->
## Key Files

- `Main.tsx`는 현재 직접 라우트에 쓰이지 않는다.
- `Queue.tsx`: 대기 상태 화면
- `Register.tsx`: 신청 폼
- `Complete.tsx`: 제출 완료 화면
- `Lookup.tsx`: 조회 및 취소
- `src/components/SmartQueueGate.tsx`: 공개 신청 진입과 상태 안내

## Stable Rules

- 학교 설정은 `SchoolContext`에서 읽는다.
- 공개 페이지는 인증이 없어도 동작해야 한다.
- 상태 문구는 사용자가 다음 행동을 알 수 있게 써야 한다.
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 루트 라우팅 기준 index는 `gate`로 redirect된다.
- 오래된 문서에서 `Main.tsx`를 진입점으로 설명한 경우 현재 코드와 다르다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 현재 라우트 구조와 SmartQueueGate 중심 흐름에 맞게 수정.
