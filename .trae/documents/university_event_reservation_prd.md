---
title: Product Requirements
doc-role: reference
status: active
precedence: 50
memory-type: product-reference
token-estimate: 850
required-for:
  - product planning
  - feature scope review
optional-for:
  - small bug fixes
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#reference-docs]

# University Event Reservation PRD

## Essential (Post-Compact)

- 제품 목적은 학교별 행사 신청과 운영을 하나의 시스템으로 처리하는 것이다.
- 핵심 사용자 그룹은 학생, 학교 관리자, 시스템 관리자다.
- 핵심 플로우는 학교 진입, 대기열 또는 바로 신청, 신청 완료, 조회/취소다.
- 현재 구현 상세는 코드와 canonical 문서를 기준으로 다시 검증한다.

<!-- STATIC:START -->
## Goals

- 학교별로 다른 신청 양식을 운영할 수 있어야 한다.
- 트래픽이 몰리는 오픈 시점에 신청 안정성을 유지해야 한다.
- 관리자 화면에서 학교와 신청 현황을 관리할 수 있어야 한다.
- 학생에게는 명확한 상태 안내와 알림을 제공해야 한다.

## User Roles

- 학생: 공개 신청 진입, 신청, 조회, 취소
- 학교 관리자: 학교 설정, 신청 현황 관리
- 시스템 관리자: 전체 학교 관리와 운영 지원

## Core User Journey

1. 학교 URL 진입
2. 오픈 전 안내 또는 대기열 진입
3. 신청서 작성
4. 제출 결과 확인
5. 필요 시 조회 또는 취소
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 구현 기준 라우트와 컴포넌트는 `README.md`와 `AGENTS.md`를 통해 최신화해서 본다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 장문 PRD를 compact reference로 정리하고 현재 구현 기준 문서와 연결.
