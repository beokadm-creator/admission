---
title: Shared Rules
doc-role: canonical
status: active
precedence: 95
memory-type: governance
token-estimate: 800
required-for:
  - editing markdown docs
  - reconciling repeated guidance
optional-for:
  - code-only work
---

# Shared Rules

## Essential (Post-Compact)

- 공통 규칙은 여기 두고, 개별 문서에는 반복하지 않는다.
- 문서는 역할과 범위를 먼저 밝히고, 세부는 코드나 하위 문서로 보낸다.
- reference 문서는 현재 운영 문서인 척하지 않는다.

<!-- STATIC:START -->
## Global

- 코드가 문서보다 우선한다.
- 문서는 사람이 빠르게 스캔할 수 있게 유지한다.
- 구체적인 파일 경로와 실제 명칭을 쓴다.
- 모호한 미래 시제보다 현재 확인 가능한 사실을 쓴다.

## Repo Docs

- README는 저장소 개요와 문서 지도 역할에 집중한다.
- 루트 canonical 문서끼리 중복 설명을 최소화한다.

## Agent Guides

- 루트 `AGENTS.md`는 저장소 전반 규칙만 가진다.
- 하위 `AGENTS.md`는 해당 폴더에만 특화된 규칙을 가진다.
- adapter 문서는 canonical 문서를 참조하고 중복을 만들지 않는다.

## Design Rules

- 브랜드 톤은 안정감과 공식성을 우선한다.
- 공공성 있는 UX에서는 명확한 상태 표현과 행동 유도가 핵심이다.

## Runbooks

- runbook은 실행 순서와 확인 항목 위주로 쓴다.
- 불확실한 최신 상태는 Dynamic Notes로 분리한다.

## Reference Docs

- reference 문서는 의사결정 배경과 개념 설명에 집중한다.
- 현재 truth source인 척하지 말고 canonical 문서를 연결한다.

## Task History

- draft와 plan은 역사적 기록으로 남긴다.
- 이미 반영된 세부 설계는 핵심 요약만 남기고 나머지는 정리한다.
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- shared rules는 개별 문서의 중복을 줄이기 위한 공통 참조 레이어다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 공통 규칙을 shared rules 파일로 분리.
