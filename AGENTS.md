---
title: Repository Agent Guide
doc-role: canonical
status: active
precedence: 90
memory-type: repo-operations
token-estimate: 1200
required-for:
  - repo-wide code changes
  - architecture-sensitive work
optional-for:
  - design-only work
  - product planning
---

@include [docs/standards/markdown-governance.md#precedence]
@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#agent-guides]

# Repository Agent Guide

## Essential (Post-Compact)

- 충돌 시 우선순위는 `docs/standards/markdown-governance.md` > 루트 `AGENTS.md` > 하위 폴더 `AGENTS.md` > 참고 문서 순서다.
- 코드 수정 전에는 관련 도메인 문서와 실제 코드를 함께 확인한다.
- 큐 로직 변경은 `functions/src/firestoreQueue.ts`, `src/components/SmartQueueGate.tsx`, `src/pages/school/Register.tsx`를 함께 본다.
- 관리자 기능 변경은 `src/pages/admin/*`, `src/components/AdminRoute.tsx`, `src/contexts/AuthContext.tsx`를 함께 본다.
- 문서가 코드와 다르면 코드를 우선 진실원본으로 보고 문서를 갱신한다.

<!-- STATIC:START -->
## System Summary

이 프로젝트는 학교별 설정 기반의 공개 신청 시스템이다. 학생은 `/:schoolId/gate`에서 대기열에 진입하고, 순차적으로 신청서를 작성한다. 관리자는 `/admin` 영역에서 학교와 신청 현황을 관리한다.

## Where To Look

- 라우트: `src/App.tsx`
- 관리자 인증: `src/contexts/AuthContext.tsx`
- 학교 설정 로딩: `src/contexts/SchoolContext.tsx`
- 공개 신청 시작 UI: `src/components/SmartQueueGate.tsx`
- 학교 페이지: `src/pages/school/`
- 관리자 페이지: `src/pages/admin/`
- 큐 서버 로직: `functions/src/firestoreQueue.ts`
- 조회/취소/알림 로직: `functions/src/index.ts`
- 타입 정의: `src/types/models.ts`

## Stable Conventions

- 프런트엔드는 React 함수형 컴포넌트와 훅을 사용한다.
- 상태는 Context와 필요한 경우 Zustand를 사용한다.
- 학교 공개 영역은 인증 없이 접근하며 `SchoolContext`로 설정을 로드한다.
- 관리자 영역은 `AdminRoute`로 보호한다.
- 큐와 신청 가능 상태의 최종 판정은 서버 callable 함수가 담당한다.
- 문서의 세부 수치보다 실제 코드 상수와 타입을 우선 신뢰한다.

## Anti-Patterns

- 재사용 컴포넌트 내부에서 직접 Firestore 쿼리 수행
- 학교별 예외 로직을 공용 컴포넌트에 하드코딩
- 관리자 권한 검증 없이 학교 설정 수정
- AlimTalk 키나 비밀값을 공개 설정 문서에 기록
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 현재 루트에 테스트 러너 설정은 없다.
- Functions 코드가 `index.ts`와 `firestoreQueue.ts`로 역할 분리되어 있다.
- 일부 오래된 계획 문서는 `.sisyphus/`와 `.trae/documents/`에 남아 있으며, 현재 작업 판단에는 참고 문서로만 사용한다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 메타데이터, 우선순위, compact 규칙을 포함한 canonical 에이전트 가이드로 재작성.
