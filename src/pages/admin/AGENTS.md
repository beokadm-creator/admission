---
title: Admin Pages Agent Guide
doc-role: canonical
status: active
precedence: 84
memory-type: domain-guide
token-estimate: 550
required-for:
  - admin page changes
optional-for:
  - school public flow work
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#agent-guides]

# Admin Pages Agent Guide

## Essential (Post-Compact)

- 관리자 영역은 `/admin/login`, `/admin`, `/admin/schools`, `/admin/schools/:schoolId`로 구성된다.
- 인증과 프로필 로딩은 `AuthContext`가 담당한다.
- SCHOOL 역할은 자기 학교만 수정할 수 있어야 한다.
- 오래된 문서상의 `AdminContext`는 현재 코드에 없으므로 사용하지 않는다.

<!-- STATIC:START -->
## Key Files

- `Login.tsx`: Firebase Auth 로그인
- `Dashboard.tsx`: 역할 기반 진입 페이지
- `SchoolList.tsx`: 학교 목록 및 생성
- `SchoolSettings.tsx`: 학교 설정 편집

## Stable Rules

- 관리자 페이지는 항상 `AdminRoute` 뒤에 위치한다.
- 권한 분기는 `adminProfile.role`과 `assignedSchoolId`를 기준으로 본다.
- 설정 저장 전 공개 화면 영향 범위를 함께 점검한다.
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 대용량 편집 포인트는 `SchoolSettings.tsx`다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 실제 라우트와 AuthContext 구조에 맞춰 정리.
