---
title: Registration Flow Draft
doc-role: draft
status: archived
precedence: 30
memory-type: task-history
token-estimate: 500
required-for:
  - historical flow review
optional-for:
  - current public flow changes
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#task-history]

# Registration Flow Draft

## Essential (Post-Compact)

- 이 문서는 과거 공개 신청 흐름 설명 초안이다.
- 현재 실제 진입점은 `Main.tsx`가 아니라 `SmartQueueGate` 기반 `/:schoolId/gate`다.
- 사용자 플로우를 검토할 때는 현재 라우트와 컴포넌트를 우선 본다.

<!-- STATIC:START -->
## Historical Flow Summary

- 오픈 대기
- 대기번호 발급
- 작성 세션 진입
- 제한 시간 내 신청서 제출
- 완료 또는 대기 상태 확인
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 실제 대기열 상태 전이는 backend callable과 `SmartQueueGate.tsx`의 조합으로 재확인해야 한다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 과거 상세 설명을 archived draft 요약으로 정리.
