---
title: Deployment Guide
doc-role: canonical
status: active
precedence: 65
memory-type: operational-runbook
token-estimate: 900
required-for:
  - production deployment
optional-for:
  - local development
---

@include [docs/standards/shared-rules.md#global]
@include [docs/standards/shared-rules.md#runbooks]

# Deployment Guide

## Essential (Post-Compact)

- 배포 전 `npm run build`와 `cd functions && npm run build`를 모두 통과시킨다.
- NHN Cloud AlimTalk 자격 증명은 Firebase Functions config 또는 private settings에서 확인한다.
- 배포 범위는 hosting, functions, firestore rules/indexes 중 필요한 것만 선택한다.
- 프로덕션 반영 전 emulator 또는 제한된 환경에서 큐 핵심 시나리오를 점검한다.

<!-- STATIC:START -->
## Preflight

```bash
npm run build
npm run lint
cd functions
npm run build
```

## Firebase Config

```bash
firebase login
firebase functions:config:get
firebase functions:config:set nhn.appkey="YOUR_APP_KEY"
firebase functions:config:set nhn.secretkey="YOUR_SECRET_KEY"
firebase functions:config:set nhn.sender_key="YOUR_SENDER_KEY"
```

## Deployment Commands

```bash
firebase deploy
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

## Minimum Checks

- 관리자 로그인 가능 여부
- 학교 공개 페이지 진입 여부
- 대기열 입장과 신청서 제출 가능 여부
- 조회 및 취소 callable 정상 동작 여부
- AlimTalk 발송 또는 graceful degradation 확인
<!-- STATIC:END -->

<!-- DYNAMIC:START -->
## Dynamic Notes

- Functions 엔진은 현재 Node.js 22로 설정되어 있다.
- 큐 핵심 검증 스크립트는 `scripts/load-test-firestore-queue.mjs`다.
<!-- DYNAMIC:END -->

## Changelog

- 2026-04-02: 깨진 텍스트와 중복 체크리스트를 제거하고 runbook 형태로 재작성.
