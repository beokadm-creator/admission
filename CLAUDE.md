---
title: Claude Adapter Guide
doc-role: adapter
status: active
precedence: 70
memory-type: tool-adapter
token-estimate: 500
required-for:
  - Claude-based agent sessions
optional-for:
  - non-Claude agents
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#agent-guides]

# CLAUDE.md

## Essential (Post-Compact)

- 이 문서는 얇은 adapter 문서다.
- 저장소 규칙의 진실원본은 루트 `AGENTS.md`와 `docs/standards/*`다.
- Claude 계열 에이전트도 코드 기준으로 문서를 검증해야 한다.

<!-- STATIC:START -->
## Usage

- 저장소 개요와 작업 기준은 `AGENTS.md`를 먼저 읽는다.
- 디자인 작업은 `.impeccable.md`를 추가로 참조한다.
- 배포 작업은 `DEPLOYMENT_GUIDE.md`를 참조한다.
- 큐 검증 작업은 `scripts/README.md`와 `.trae/documents/*queue*.md`를 참조한다.
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 이 문서는 Claude 전용 중복 설명을 줄이기 위해 최소 정보만 유지한다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 중복 아키텍처 설명을 제거하고 AGENTS.md를 참조하는 adapter 문서로 축약.
