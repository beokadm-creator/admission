---
title: admission
doc-role: canonical
status: active
precedence: 80
memory-type: repo-overview
token-estimate: 900
required-for:
  - repo onboarding
  - feature implementation
optional-for:
  - deployment work
  - queue debugging
---

@include [docs/standards/markdown-governance.md#metadata-contract]
@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#repo-docs]

# admission

## Essential (Post-Compact)

- 이 저장소는 대학 행사 신청 시스템이다.
- 프런트엔드는 React 18 + TypeScript + Vite + Tailwind CSS를 사용한다.
- 백엔드는 Firebase Functions, Firestore, Realtime Database, Firebase Auth를 사용한다.
- 학교별 설정과 공개 신청 플로우는 `schools/{schoolId}` 중심으로 구성된다.
- 큐 관련 상세 규칙은 [AGENTS.md](./AGENTS.md)와 [scripts/README.md](./scripts/README.md)를 우선 참고한다.

<!-- STATIC:START -->
## Overview

`admission`은 학교별 행사 신청, 대기열 진입, 신청서 작성, 관리자 운영, AlimTalk 발송을 하나의 Firebase 프로젝트에서 처리하는 시스템이다.

## Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, React Router v7, react-hook-form
- Backend: Firebase Functions, Firestore, Realtime Database, Firebase Auth
- Integrations: NHN Cloud AlimTalk

## Key Paths

- `src/App.tsx`: 라우팅 진입점
- `src/contexts/AuthContext.tsx`: 관리자 인증 상태
- `src/contexts/SchoolContext.tsx`: 학교 설정 로딩
- `src/components/SmartQueueGate.tsx`: 공개 신청 진입 및 대기열 UI
- `functions/src/firestoreQueue.ts`: 큐 핵심 로직
- `functions/src/index.ts`: 등록 조회, 취소, 알림, 백엔드 export
- `.trae/documents/`: PRD, 기술 아키텍처, 검증 문서

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run check
npm run preview
```

```bash
cd functions
npm run build
npm run serve
npm run shell
npm run deploy
npm run logs
```

## Document Map

- `AGENTS.md`: 저장소 전체 작업 규칙과 코드 탐색 기준
- `CLAUDE.md`: Claude 계열 에이전트용 얇은 adapter 문서
- `.impeccable.md`: UI/브랜드 디자인 컨텍스트
- `DEPLOYMENT_GUIDE.md`: 배포 전후 절차
- `AB_TEST_GUIDE.md`: A/B 테스트 운영 참고
- `scripts/README.md`: 검증 스크립트 운용법
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- 현재 테스트 프레임워크는 구성되어 있지 않다.
- 현재 CI/CD 파이프라인은 저장소 안에 정의되어 있지 않다.
- Functions 런타임은 `functions/package.json` 기준 Node.js 22이다.
- 큐 핵심 로직은 `functions/src/firestoreQueue.ts`에 분리되어 있다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: Vite 기본 README를 제거하고 저장소 기준 canonical 문서로 재작성.
