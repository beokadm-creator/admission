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

## Design Context

### Users
**학부모 (40~50대)** + **학생 (10~20대)**. 주로 모바일로 접속, 입학 신청이라는 긴장된 상황에서 방문. 처음 방문해도 즉시 어떤 서비스인지, 지금 무엇을 해야 하는지 알 수 있어야 한다.

### Brand Personality
**신뢰·명료·격조** — 공공기관처럼 믿을 수 있되, 모던하고 쉬운 느낌. 사용자 불안을 줄이고 절차에 대한 확신을 주는 것이 목표.

### Aesthetic Direction
- 레퍼런스: Apple 공식 사이트, Linear — 여백 풍부, 타이포그래피 중심, 절제된 UI
- 폰트: Pretendard (Google Fonts CDN)
- 컬러: `#003B71` 네이비 중심, 보조 강조 최소화
- 테마: 라이트 모드 전용
- 안티 레퍼런스: SaaS 랜딩, 과한 그래디언트, glassmorphism

### Design Principles
1. **위계가 먼저** — 접수 중인 학교가 히어로 수준으로 강조. 서비스 소개보다 현재 상태 우선.
2. **여백으로 신뢰** — 풍부한 여백이 공식 서비스의 무게감을 만든다.
3. **텍스트가 디자인이다** — 잘 짜인 타이포그래피 위계가 아이콘 반복보다 효과적.
4. **모바일 우선** — 버튼 높이 56px+, 본문 16px+, 가로 스크롤 금지.
5. **상태를 즉시 이해** — 접수중(초록), 예정(앰버), 마감(로즈)을 색과 레이블로 명확히 구분.

## Changelog

- 2026-04-04: Design Context 추가 (사용자: 학부모+학생, 레퍼런스: Apple/Linear, 폰트: Pretendard).
- 2026-04-03: 9원칙 기준으로 재작성. 불필요한 마크다운 제거, token-estimate 축소.
- 2026-04-02: 중복 아키텍처 설명 제거, AGENTS.md 참조 adapter 문서로 축약.
