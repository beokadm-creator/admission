---
title: Markdown Governance
doc-role: canonical
status: active
precedence: 100
memory-type: governance
token-estimate: 1100
required-for:
  - editing markdown docs
  - reconciling conflicting instructions
optional-for:
  - pure code debugging
---

# Markdown Governance

## Essential (Post-Compact)

- 모든 작성 문서는 메타데이터, `Essential (Post-Compact)`, `STATIC/DYNAMIC`, `Changelog`를 가진다.
- 충돌 시 높은 `precedence`가 낮은 `precedence`를 이긴다.
- `@include`는 중복 규칙을 끌어오는 선언이며, 상세 규칙은 shared rules 파일에 둔다.
- 오래된 draft는 삭제보다 강등을 우선하되, `status`와 `doc-role`을 명확히 적는다.
- 코드와 문서가 충돌하면 코드를 우선하고 문서를 갱신한다.

## Metadata Contract

각 작성 문서는 가능한 한 아래 필드를 가진다.

- `title`: 문서 이름
- `doc-role`: canonical, adapter, reference, runbook, draft, archive 중 하나
- `status`: active, draft, archived, superseded 중 하나
- `precedence`: 숫자. 높을수록 우선
- `memory-type`: AI가 어떤 종류의 기억으로 다룰지 표시
- `token-estimate`: 문서 단독 로딩 예상 토큰량
- `required-for`: 이 문서가 꼭 필요한 작업
- `optional-for`: 있으면 좋은 작업

## Precedence

기본 우선순위는 아래 순서를 따른다.

1. `docs/standards/markdown-governance.md`
2. `docs/standards/shared-rules.md`
3. 루트 canonical 문서 (`AGENTS.md`, `README.md`, `.impeccable.md`)
4. 하위 폴더 `AGENTS.md`
5. 운영 runbook (`DEPLOYMENT_GUIDE.md`, `scripts/README.md`)
6. 제품/기술 reference (`.trae/documents/*`)
7. draft/history (`.sisyphus/*`)

같은 레벨에서 충돌하면 더 최근 `Changelog`를 가진 문서보다 더 구체적인 범위의 문서를 우선한다.

## STATIC/DYNAMIC Markers

문서 본문은 가능한 한 아래 주석 마커로 분리한다.

- `<!-- STATIC:START -->` ~ `<!-- STATIC:END -->`
- `<!-- DYNAMIC:START -->` ~ `<!-- DYNAMIC:END -->`

의미는 다음과 같다.

- STATIC: 구조, 원칙, 변하지 않는 규칙
- DYNAMIC: 현재 상태, 구현 메모, 검증 필요 항목

## @include

중복 규칙은 문서 본문에 다시 쓰지 말고 다음 형식으로 참조한다.

```md
@include [docs/standards/shared-rules.md#global]
```

`@include`는 문맥상 가져와야 하는 규칙을 가리키는 선언이다. 실제 렌더러가 없어도 사람이 읽을 수 있어야 한다.

## Memory Types

권장 값은 아래와 같다.

- `governance`: 최상위 규칙
- `repo-overview`: 저장소 개요
- `repo-operations`: 저장소 전반 작업 기준
- `domain-guide`: 하위 영역 작업 기준
- `design-context`: UI/브랜드 컨텍스트
- `operational-runbook`: 배포/운영 절차
- `experiment-reference`: 실험 참고
- `product-reference`: PRD, 기술 문서
- `task-history`: 과거 계획과 드래프트
- `tool-adapter`: 도구별 얇은 adapter

## Token Budget

- 400 이하: 얇은 adapter 또는 인덱스
- 400~900: 일반 가이드
- 900~1500: canonical 또는 운영 문서
- 1500 초과: 분리 대상 후보

문서가 길어지면 공통 규칙을 shared rules로 빼고 `Essential (Post-Compact)`에 최소 핵심만 남긴다.

## Changelog

각 문서는 마지막에 간단한 변경 이력을 둔다. 한 줄씩 유지하고, 최신 항목을 위가 아니라 아래에 추가해도 된다. 중요한 것은 최근 개편 이력이 남아 있는 것이다.

## Removal Policy

- 기본 템플릿 문구
- 코드와 불일치하는 설명
- 다른 문서에서 이미 canonical 하게 설명한 반복 내용
- 더 이상 실행하지 않는 절차를 현재 운영 문서처럼 쓰는 표현

이 항목은 삭제하거나 reference/draft 문서로 강등한다.

## Changelog

- 2026-04-02: 저장소 마크다운 정리 기준 최초 도입.
