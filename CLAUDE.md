---
title: Claude Adapter Guide
doc-role: adapter
status: active
precedence: 70
memory-type: tool-adapter
token-estimate: 400
required-for:
  - Claude-based agent sessions
optional-for:
  - non-Claude agents
  - design-only work
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#agent-guides]

## Essential (Post-Compact)

- 진실원본은 `AGENTS.md`(precedence 90)와 `docs/standards/*`(95)다. 이 파일은 adapter다.
- 충돌 시 우선순위: `docs/standards/*` > `AGENTS.md` > `CLAUDE.md` > 하위 문서.
- 코드와 문서가 다르면 코드가 이긴다. 문서를 갱신한다.

<!-- STATIC:START -->
## 작업별 참조 파일

| 작업 | 참조 |
|------|------|
| 저장소 개요 · 코드 구조 | `AGENTS.md` |
| 디자인 · 브랜드 | `.impeccable.md` |
| 배포 · 운영 절차 | `DEPLOYMENT_GUIDE.md` |
| 큐 검증 · 부하 테스트 | `scripts/README.md`, `.trae/documents/*queue*.md` |
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

_현재 별도로 추적할 임시 상태 없음._
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-03: 9원칙 기준으로 재작성. 불필요한 마크다운 제거, token-estimate 축소.
- 2026-04-02: 중복 아키텍처 설명 제거, AGENTS.md 참조 adapter 문서로 축약.
