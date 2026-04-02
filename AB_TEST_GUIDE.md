---
title: AB Test Guide
doc-role: reference
status: active
precedence: 55
memory-type: experiment-reference
token-estimate: 800
required-for:
  - ab test planning
optional-for:
  - normal feature work
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#reference-docs]

# A/B Test Guide

## Essential (Post-Compact)

- A/B 테스트는 실제 코드와 설정 존재 여부를 먼저 확인한 뒤 진행한다.
- KPI는 전환율, 성공률, 이탈률, 평균 완료 시간, 서버 오류율을 최소 기준으로 본다.
- 운영 결정은 단일 수치가 아니라 사용자 경험과 장애 위험을 함께 고려한다.

<!-- STATIC:START -->
## Purpose

대기열 사용 여부 또는 공개 신청 진입 방식 변화가 실제 신청 완료율과 안정성에 어떤 영향을 주는지 측정하기 위한 참고 문서다.

## Recommended KPI

- 신청 완료 전환율
- 등록 성공률
- 중도 이탈률
- 평균 신청 완료 시간
- 서버 오류율
- 문의 또는 CS 발생량

## Execution Flow

1. 실험 범위와 대상 학교를 정한다.
2. 코드와 `SchoolConfig`에 필요한 플래그가 존재하는지 확인한다.
3. 측정 이벤트와 저장 위치를 정한다.
4. 제한된 트래픽으로 시범 운영한다.
5. 전면 적용 여부를 결정한다.
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 타입 기준 A/B 설정 필드는 `src/types/models.ts`의 `abTestSettings`를 참고한다.
- 실제 지표 저장 및 집계 로직은 작업 시점의 코드 구현 상태를 다시 검증해야 한다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 상세 절차의 중복을 제거하고 실행 기준 중심의 reference 문서로 재정리.
