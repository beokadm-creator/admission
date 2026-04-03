# 라이브 전 UX 메시지·접근성 정비

## TL;DR

> **Quick Summary**: `FULL_CAPACITY` 영문 노출 버그 수정, `resource-exhausted` 계열 에러 한국어 변환, 접근성 LSP 에러 일괄 수정
> 
> **Deliverables**:
> - Register.tsx FULL_CAPACITY 에러 한국어 메시지 처리
> - SmartQueueGate.tsx resource-exhausted 에러 메시지 정비
> - 전체 파일 button type 속성 추가
> - Register.tsx form label htmlFor/id 연결
> - 정적 요소 키보드 접근성 추가
> - firebase.json에 firestore rules 필드 추가
> 
> **Estimated Effort**: Quick
> **Parallel Execution**: YES - 1 wave (6 tasks) + FINAL wave (4 reviews)
> **Critical Path**: Task 1 → FINAL (모든 태스크가 독립)

---

## Context

### Original Request
라이브 전 UX 메시지 버그와 접근성 LSP 에러를 수정하는 전체 정비 작업.

### Interview Summary
**Key Discussions**:
- `confirmReservation`에서 `FULL_CAPACITY` 에러가 Register.tsx else 분기에서 `error.message` 원문 그대로 노출됨
- `SmartQueueGate.tsx`의 `friendlyErrorMessage`가 `resource-exhausted`를 "접속자가 많아 지연"으로 오변환할 여지 있음
- LSP 접근성 에러: button type 누락, form label 미연결, 정적 요소 interactivity

**Research Findings**:
- `Register.tsx:309-329`: catch에서 `resource-exhausted` 코드가 별도 분기 없이 else로 빠짐
- `SmartQueueGate.tsx:160-175`: `friendlyErrorMessage`에 `resource-exhausted` 관련 패턴 누락
- LSP: SmartQueueGate(7개), Register(1개), AdminLayout(2개), Lookup(3개), SchoolList(4개) button type 누락

### Metis Review
- 타임아웃으로 미수급, 자체 분석으로 커버

---

## Work Objectives

### Core Objective
사용자가 볼 수 있는 모든 에러 메시지를 정확한 한국어로 전달하고, 접근성 표준을 충족한다.

### Concrete Deliverables
- `Register.tsx`: `resource-exhausted` + `FULL_CAPACITY` 명시적 한국어 처리
- `SmartQueueGate.tsx`: `resource-exhausted` 패턴 추가
- 5개 파일: button `type` 속성 일괄 추가
- `Register.tsx` + `Lookup.tsx`: label htmlFor/id 연결
- `firebase.json`: `"rules": "firestore.rules"` 필드 추가

### Definition of Done
- [ ] `npm run build` 성공 (0 errors)
- [ ] LSP diagnostic에서 button type / label 에러 0건
- [ ] FULL_CAPACITY 에러 시 한국어 메시지 노출 확인

### Must Have
- FULL_CAPACITY 영문 노출 절대 차단
- 모든 button에 type 속성
- 빌드 성공

### Must NOT Have (Guardrails)
- 기존 큐 로직(`firestoreQueue.ts`) 변경 금지
- 새로운 상태/변수 추가 금지 (기존 패턴 내에서 수정)
- UI 디자인/레이아웃 변경 금지
- 에러 코드 문자열 자체 변경 금지 (메시지 변환만 수정)
- `normalizeCallableRequest`, `checkRateLimit` 등 중복 코드 리팩터링 금지 (별도 작업)

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None (이번 스코프에서 제외)
- **Framework**: none

### QA Policy
모든 태스크는 agent-executed QA scenarios 포함.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Playwright 미사용 — `npm run build` + LSP diagnostics로 검증
- **빌드 검증**: Bash로 `npm run build` 실행, 0 errors 확인
- **정적 분석**: `npx tsc --noEmit`으로 타입 체크

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — 모든 태스크 독립):
├── Task 1: Register.tsx FULL_CAPACITY + resource-exhausted 한국어 에러 처리 [quick]
├── Task 2: SmartQueueGate.tsx resource-exhausted 메시지 정비 [quick]
├── Task 3: 전체 파일 button type 속성 추가 [quick]
├── Task 4: Register.tsx + Lookup.tsx form label htmlFor/id 연결 [quick]
├── Task 5: Register.tsx + SmartQueueGate.tsx 정적 요소 키보드 접근성 [quick]
└── Task 6: firebase.json rules 필드 추가 [quick]

Wave FINAL (After Wave 1 — 4 parallel reviews):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
-> Present results -> Get explicit user okay

Critical Path: Wave 1 → FINAL
Parallel Speedup: ~85% (all Wave 1 tasks independent)
Max Concurrent: 6 (Wave 1)
```

### Dependency Matrix

| Task | Depends on | Blocks | Wave |
|------|----------|---------|-------|
| 1 | — | 1 | |
| 2 | — | 1 | |
| 3 | — | 1 | |
| 4 | — | 1 | |
| 5 | — | 1 | |
| 6 | — | 1 | |
| F1-F4 | 1-6 | FINAL |

| 所有 tasks are Wave 1 independent. No cross-task dependencies. |



| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | F1-F4 | 1 |
| 2 | — | F1-F4 | 1 |
| 3 | — | F1-F4 | 1 |
| 4 | — | F1-F4 | 1 |
| 5 | — | F1-F4 | 1 |
| 6 | — | F1-F4 | 1 |

### Agent Dispatch Summary

- **Wave 1**: **6** — T1-T6 → `quick`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

  

- [ ] 1. **Register.tsx FULL_CAPACITY· resource-exhausted 에러 한국어 변환**

  **What to do**:
  - `Register.tsx` catch 블록(309-329)에 `functions/resource-exhausted` 에러 코드에 대한 명시적 분기를 추가
  - `FULL_CAPACITY` 메시지 → "모집 정원과 예비 정원이 모두 마감되어 신청을 완료할 수 없습니다. 대기열 화면으로 돌아갑니다."
  - `resource-exhausted` (기타) → "현재 신청 가능한 인원이 없습니다. 잠시 후 다시 시도해 주세요."
  - `deadline-exceeded`, `failed-precondition`, `already-exists` 분기는 그대로 유지
  - else 분기의 `error.message` 노출 방지 → 한국어 폴백 메시지로 교체

  **Must NOT do**:
  - 서버 로직 변경 금지 (FULL_CAPACITY 판정 자체는 설계상 올바름)
  - `deadline-exceeded`, `failed-precondition`, `already-exists` 처리 로직 변경 금지

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`frontend-design`]
  - **Skills Evaluated but Omitted**:
    - `animate`: 메시지 표시에 애니메이션 불필요

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: F1-F4 (Final Verification)
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/pages/school/Register.tsx:309-329` — 현재 catch 블록 구조. `deadline-exceeded`, `failed-precondition`, `already-exists` 분기와 else 분기를 확인
  - `src/components/SmartQueueGate.tsx:160-175` — `friendlyErrorMessage` 패턴 참고 (resource-exhausted 처리 방식)

  **API/Type References**:
  - `functions/src/firestoreQueue.ts:1881` — `FULL_CAPACITY` 에러 발생 지점
  - `functions/src/firestoreQueue.ts:1521` — startRegistrationSession의 `resource-exhausted` 에러 메시지

  **Acceptance Criteria**:

  - [ ] `resource-exhausted` 에러 코드에 대한 명시적 분기가 추가됨
  - [ ] `FULL_CAPACITY` 메시지가 한국어로 변환됨
  - [ ] else 분기에서 영어 원문 노출이 제거됨

  **QA Scenarios**:
  ```
  Scenario: FULL_CAPACITY 에러 시 한국어 메시지 표시
    Tool: Bash (grep)
    Preconditions: Register.tsx 코드가 수정됨
    Steps:
      1. grep -n "resource-exhausted" src/pages/school/Register.tsx
      2. grep -n "FULL_CAPACITY" src/pages/school/Register.tsx
      3. grep -n "정원" src/pages/school/Register.tsx
    Expected Result: resource-exhausted 분기가 존재하고 "모집 정원" 한국어 메시지가 포함됨
    Failure Indicators: resource-exhausted 분기가 없거나 영어 원문이 그대로 남음
    Evidence: .sisyphus/evidence/task-1-capacity-message.txt

  Scenario: else 분기에서 error.message 원문 노출 방지
    Tool: Bash (grep)
    Steps:
      1. Register.tsx의 catch else 분기에서 getFirebaseError(error)?.message 직접 사용 코드 확인
      2. 한국어 폴백 메시지가 있는지 확인
    Expected Result: else 분기가 한국어 폴백만 사용
    Failure Indicators: error.message가 사용자에게 직접 노출됨
    Evidence: .sisyphus/evidence/task-1-else-fallback.txt
  ```

  **Commit**: YES (groups with 2)
  - Message: `fix(register): add Korean error messages for FULL_CAPACITY and resource-exhausted`
  - Files: `src/pages/school/Register.tsx`

- [ ] 2. **SmartQueueGate.tsx resource-exhausted 메시지 변환 강화**

  **What to do**:
  - `friendlyErrorMessage`(160-175)에 `resource-exhausted` 패턴 추가
  - `FULL_CAPACITY` → "모집 정원과 예비 정원이 모두 마감되었습니다. 추가 모집이 있을 경우 안내됩니다."
  - "동시 접수 가능한 인원이 가득 찼" → "현재 동시 접수 인원이 가득 찼습니다. 잠시 후 다시 시도해 주세요." (기존 메시지 유지하되나 패턴에 명시적 추가)
  - 기존 "운영 상한", "정원이 없습니다" 패턴은 그대로 유지

  **Must NOT do**:
  - 서버 로직 변경 금지
  - 기존 "이미 진행 중인 대기열" 등 정상 동작 메시지 변경 금지

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`frontend-design`]
  - **Skills Evaluated but Omitted**:
    - `animate`: 정적 메시지 변경만

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: F1-F4
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/components/SmartQueueGate.tsx:160-175` — `friendlyErrorMessage` useMemo 전체
  - `src/pages/school/Register.tsx:309-329` — 동일 에러 코드 처리 패턴 참고용

  **API/Type References**:
  - `functions/src/firestoreQueue.ts:1225-1234` — 큐 비활성화 시 `direct` 결과 반환 (정원 체크 없음)
  - `functions/src/firestoreQueue.ts:1287-1288` — `joinQueue`의 `resource-exhausted` 에러 메시지

  **Acceptance Criteria**:

  - [ ] `FULL_CAPACITY` 패턴이 `friendlyErrorMessage`에 추가됨
  - [ ] 기존 "운영 상한", "정원이 없습니다" 패턴이 유지됨
  - [ ] 모든 resource-exhausted 계열이 한국어 메시지로 변환됨

  **QA Scenarios**:
  ```
  Scenario: FULL_CAPACITY 포함 여부 확인
    Tool: Bash (grep)
    Steps:
      1. grep -n "FULL_CAPACITY\|resource-exhausted" src/components/SmartQueueGate.tsx
      2. grep -n "마감\|정원" src/components/SmartQueueGate.tsx
    Expected Result: FULL_CAPACITY 패턴이 추가되어 있고 한국어 메시지가 포함됨
    Failure Indicators: FULL_CAPACITY 패턴이 없거나 영어 원문 노출 가능
    Evidence: .sisyphus/evidence/task-2-gate-message.txt

  Scenario: 기존 메시지 유지 확인
    Tool: Bash (grep)
    Steps:
      1. grep -n "운영 상한\|이미 진행 중인" src/components/SmartQueueGate.tsx
    Expected Result: 기존 패턴이 모두 유지됨
    Failure Indicators: 기존 패턴이 누락됨
    Evidence: .sisyphus/evidence/task-2-existing-patterns.txt
  ```

  **Commit**: YES (groups with 1)
  - Message: `fix(queue-gate): add FULL_CAPACITY and resource-exhausted message handling`
  - Files: `src/components/SmartQueueGate.tsx`

---

## Final Verification Wave---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `npm run build` + `npx tsc --noEmit`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | TypeCheck [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state (`npm run build`). Verify: 1) FULL_CAPACITY error path - check that Register.tsx catch block now has explicit resource-exhausted handling with Korean text. 2) SmartQueueGate friendlyErrorMessage includes resource-exhausted patterns. 3) All buttons have type attributes. 4) Form labels have htmlFor. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Checks [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1**: `fix(register): add Korean error messages for FULL_CAPACITY and resource-exhausted` — src/pages/school/Register.tsx
- **2**: `fix(queue-gate): improve resource-exhausted error message handling` — src/components/SmartQueueGate.tsx
- **3**: `fix(a11y): add button type attributes across all pages` — src/components/SmartQueueGate.tsx, src/pages/school/Register.tsx, src/layouts/AdminLayout.tsx, src/pages/school/Lookup.tsx, src/pages/admin/SchoolList.tsx
- **4**: `fix(a11y): connect form labels to inputs with htmlFor/id` — src/pages/school/Register.tsx, src/pages/school/Lookup.tsx
- **5**: `fix(a11y): add keyboard handlers to interactive static elements` — src/pages/school/Register.tsx, src/components/SmartQueueGate.tsx
- **6**: `chore(firebase): add firestore rules field for safe deployment` — firebase.json

---

## Success Criteria

### Verification Commands
```bash
npm run build          # Expected: success, 0 errors
npx tsc --noEmit       # Expected: 0 errors
```

### Final Checklist
- [ ] FULL_CAPACITY 영문 노출 완전 차단
- [ ] 모든 button에 type 속성
- [ ] Form label-input 연결
- [ ] 빌드 성공
- [ ] firestoreQueue.ts 변경 없음 (guardrail 준수)
