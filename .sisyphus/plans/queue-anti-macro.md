# 대기열 입장 챌린지 — 트래픽 분산 기능

## TL;DR

> **Quick Summary**: `SmartQueueGate.tsx`에 4자리 난수 입력 챌린지를 추가하여 오픈 시간 동시 클릭 트래픽을 인간 입력 지연(약 2~3초)만큼 자연 분산시킨다. 관리자 페이지에서 학교별 활성화/비활성화 제어.
>
> **Deliverables**:
> - `src/types/models.ts`: `queueSettings`에 `useEntryChallenge` 필드 추가
> - `src/pages/admin/SchoolSettings.tsx`: 관리자 토글 UI + 저장 직렬화
> - `src/hooks/useQueueChallenge.ts`: 챌린지 상태 관리 훅 (신규 파일)
> - `src/components/QueueChallengeModal.tsx`: 프리미엄 모달 UI (신규 파일)
> - `src/components/SmartQueueGate.tsx`: 훅 연동 + 버튼 onClick 래핑
>
> **Estimated Effort**: Short (3~5 hours)
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 + Task 3 (parallel) → Task 4 → Task 5 (QA)

---

## Context

### Original Request
오픈 시간에 트래픽 폭주를 막기 위해 4자리 난수 입력을 도입하여 인간의 입력 시간만큼 트래픽을 자연 분산.

### Interview Summary
**Key Discussions**:
- **목표 확정**: "매크로 차단"이 아닌 "트래픽 분산". 클라이언트 전용 4자리 난수로 인간 입력 지연(약 2~3초)을 유도.
- **명명 변경**: `useCaptcha` → `useEntryChallenge` (실제 역할 정확히 반영)
- **컴포넌트 분리**: SmartQueueGate.tsx가 이미 1287줄이므로 훅+모달을 별도 파일로 분리
- **챌린지 적용 범위**: 모든 `joinQueue()` 시도에 동일 적용 (버튼 활성 조건이 이미 검증)
- **테스트 전략**: QA만 (테스트 프레임워크 없음)

**Research Findings**:
- 서버에 이미 per-user 5회/분, per-IP 120회/분 rate limit 존재 → 클라이언트 챌린지는 보조적 분산 역할
- `queueEnabled: false` 경로와 `autoEntering` 경로는 `startRegistration()`을 사용 → 챌린지 불필요
- `src/hooks/` 디렉토리가 이미 존재 (`useTheme.ts` 확인)
- SchoolSettings의 `onSubmit`이 이미 `queueSettings`를 직렬화 (643-646줄)
- 모바일 하단 바 조인 버튼(1131줄)도 동일한 `joinQueue()` 사용

### Metis Review
**Identified Gaps** (all addressed):
- 난수 생성 타이밍: 모달 열릴 때 `useState` 초기화로 생성 (StrictMode 안전)
- 빠른 더블클릭: 훅이 `isChallengeOpen` 상태 반환 → 버튼에서 무시
- 붙여넣기/백스페이스 처리: 모달 컴포넌트에서 필수 구현
- `inputMode="numeric" pattern="[0-9]" type="text"` 조합으로 모바일 키패드 트리거
- 모달 z-index: 하단 바(z-40), 프로그램 이미지(z-100)보다 높게 설정

---

## Work Objectives

### Core Objective
오픈 시간 대기열 진입 전 4자리 난수 입력을 강제하여, 인간의 입력 시간만큼 동시 클릭 트래픽을 자연스럽게 분산시킨다.

### Concrete Deliverables
- `SchoolConfig.queueSettings.useEntryChallenge: boolean` 타입 정의
- 관리자 설정 > 대기열 설정 섹션에 "입장 챌린지" 토글
- `useQueueChallenge` 훅: 난수 생성, 입력 검증, 성공/실패 상태 관리
- `QueueChallengeModal`: 개별 숫자 박스, 흔들림 애니메이션, 모바일 최적화
- SmartQueueGate 데스크톱/모바일 조인 버튼에 챌린지 인터셉트 연동

### Definition of Done
- [ ] 관리자 설정에서 '입장 챌린지' 토글로 기능 on/off 가능
- [ ] 기능 활성화 + 챌린지 off 상태에서 "대기열 입장" 클릭 시 난수 모달 표시
- [ ] 올바른 4자리 입력 시에만 `joinQueue()` 실행
- [ ] 틀린 입력 시 흔들림 효과 + 입력 초기화 + 새 난수 생성
- [ ] 모달 닫기(ESC / X 버튼) 시 대기열 진입 없이 복귀
- [ ] 모바일에서 숫자 키패드 정상 동작
- [ ] `npm run build` 성공, LSP 에러 없음

### Must Have
- `useEntryChallenge`가 `true`일 때만 챌린지 동작
- 기본값 `undefined`/`false` → 챌린지 비활성 (기존 학교 영향 없음)
- 데스크톱 조인 버튼 + 모바일 하단 바 조인 버튼 모두에 적용
- 접근성: `role="dialog"`, `aria-modal="true"`, 키보드 탐색 지원

### Must NOT Have (Guardrails)
- ❌ 외부 캡차 라이브러리(reCAPTCHA 등) 사용 금지 (자체 구현)
- ❌ 서버 측 검증 로직 추가 금지 (클라이언트 전용 분산 목적)
- ❌ `joinQueue()` 함수 내부 수정 금지 (버튼 onClick만 인터셉트)
- ❌ 이미 eligible/canEnter/autoEntering 사용자에게 챌린지 표시 금지
- ❌ `queueEnabled: false` 경로에 챌린지 표시 금지
- ❌ `startRegistration()` 경로에 챌린지 표시 금지
- ❌ 챌린지 난이도 설정 (항상 4자리 고정)
- ❌ 난수 만료 시간 / TTL (모달 열린 동안 유효)
- ❌ 챌린지 실패 rate limit (무제한 재시도)
- ❌ 관리자/테스트 모드 건너뛰기
- ❌ 챌린지 완료 로깅/분석

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO
- **Automated tests**: None
- **Framework**: None
- **QA Method**: Agent-executed Playwright + build verification

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Build verification**: `npm run build` → success
- **LSP verification**: `lsp_diagnostics` → no errors in modified files
- **UI verification**: Playwright → 브라우저에서 실제 동작 확인

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation):
├── Task 1: Type definition + model update [quick]
└── (no other tasks can start — all depend on types)

Wave 2 (After Task 1 — parallel):
├── Task 2: Admin toggle in SchoolSettings (depends: 1) [quick]
└── Task 3: Challenge hook + Modal component (depends: 1) [visual-engineering]

Wave 3 (After Tasks 2, 3 — integration):
└── Task 4: Integrate into SmartQueueGate (depends: 2, 3) [quick]

Wave FINAL (After ALL tasks):
└── Task 5: Full QA verification (depends: 4) [unspecified-high]

Critical Path: Task 1 → Task 3 → Task 4 → Task 5
Parallel Speedup: Task 2 ∥ Task 3
Max Concurrent: 2
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 2, 3 | 1 |
| 2 | 1 | 4 | 2 |
| 3 | 1 | 4 | 2 |
| 4 | 2, 3 | 5 | 3 |
| 5 | 4 | — | FINAL |

### Agent Dispatch Summary

- **Wave 1**: 1 task → Task 1 `quick`
- **Wave 2**: 2 tasks → Task 2 `quick`, Task 3 `visual-engineering`
- **Wave 3**: 1 task → Task 4 `quick`
- **FINAL**: 1 task → Task 5 `unspecified-high` + `playwright` skill

---

## TODOs

> Implementation tasks below. Each task includes recommended agent profile, references, and QA scenarios.

- [ ] 1. Type Definition — `useEntryChallenge` 필드 추가

  **What to do**:
  - `src/types/models.ts`의 `SchoolConfig.queueSettings`에 `useEntryChallenge?: boolean` 추가
  - 기존 `queueSettings`은 `{ maxActiveSessions: number; enabled: boolean; }` 구조
  - 옵셔널 필드이므로 기존 학교 설정에 영향 없음 (undefined → false 처리)

  **Must NOT do**:
  - 다른 타입 변경 금지
  - 기존 필드 타입 수정 금지

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 단일 파일, 1줄 추가
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 1 (단독)
  - **Blocks**: Tasks 2, 3, 4
  - **Blocked By**: None (즉시 시작)

  **References**:

  **Pattern References**:
  - `src/types/models.ts:37-40` — `queueSettings` 현재 구조 (`maxActiveSessions`, `enabled`). 이 위치에 `useEntryChallenge` 추가.

  **API/Type References**:
  - `src/types/models.ts:SchoolConfig` — 전체 SchoolConfig 인터페이스

  **WHY Each Reference Matters**:
  - `models.ts:37-40` — 정확히 이 블록 내에 새 필드를 추가해야 함. 다른 위치에 추가하면 SchoolSettings에서 읽지 못함.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Type definition is correct
    Tool: Bash (TypeScript compiler)
    Preconditions: models.ts 수정 완료
    Steps:
      1. npx tsc --noEmit src/types/models.ts
      2. Check output for errors
    Expected Result: Zero TypeScript errors
    Failure Indicators: Any error mentioning 'useEntryChallenge' or 'queueSettings'
    Evidence: .sisyphus/evidence/task-1-type-check.txt
  ```

  **Commit**: YES
  - Message: `feat(queue): add useEntryChallenge field to SchoolConfig`
  - Files: `src/types/models.ts`

- [ ] 2. Admin Toggle — 관리자 설정에 입장 챌린지 토글 추가

  **What to do**:
  - `src/pages/admin/SchoolSettings.tsx`의 "모집 및 대기열 설정" 섹션에 토글 추가
  - 기존 체크박스 패턴(`queueSettings.enabled` 토글, 1116-1123줄)을 그대로 따름
  - `react-hook-form`의 `register('queueSettings.useEntryChallenge')` 사용
  - `onSubmit()` 함수(605-749줄)의 `sanitizedDoc.queueSettings` 객체(643-646줄)에 `useEntryChallenge` 직렬화 추가
  - `loadSchool` 함수(413줄)에서 기존 설정 로드 시 `setValue('queueSettings.useEntryChallenge', ...)` 추가

  **Must NOT do**:
  - 기존 설정 필드 수정/삭제 금지
  - 새 섹션 생성 금지 (기존 "모집 및 대기열 설정" 섹션에 추가)
  - 기본값 form 초기값(257-260줄)에 `useEntryChallenge` 명시적 추가 불필요 (옵셔널)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 기존 패턴 복사 + 3곳에 유사 코드 추가
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (Task 3과 병렬)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 4
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/pages/admin/SchoolSettings.tsx:1116-1123` — "대기열 기능 사용" 체크박스. 이와 동일한 UI 패턴으로 "입장 챌린지" 토글 추가.
  - `src/pages/admin/SchoolSettings.tsx:643-646` — `onSubmit`에서 `queueSettings` 직렬화. 이 블록에 `useEntryChallenge` 필드 추가.
  - `src/pages/admin/SchoolSettings.tsx:413-414` — 기존 설정 로드. `setValue('queueSettings.enabled', ...)` 패턴 그대로 적용.

  **API/Type References**:
  - `src/types/models.ts:SchoolConfig.queueSettings` — Task 1에서 추가한 타입

  **Test References**:
  - 해당 없음 (테스트 없음)

  **WHY Each Reference Matters**:
  - `1116-1123줄` — 관리자 토글의 정확한 UI 패턴. 일관성을 위해 동일한 마크업 구조 사용.
  - `643-646줄` — 설정 저장 시 반드시 이 위치에 필드 추가해야 함. 누락하면 저장 시 값이 소실됨.
  - `413-414줄` — 기존 학교 설정을 불러올 때 값을 복원하지 않으면 폼에 빈 값이 표시됨.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Admin toggle visible and functional
    Tool: Playwright
    Preconditions: Task 1 완료, dev server 실행 중
    Steps:
      1. /admin/schools/{schoolId} → 설정 탭 클릭
      2. "모집 및 대기열 설정" 섹션으로 스크롤
      3. "대기열 기능 사용" 아래에 "입장 챌린지 (4자리 난수 입력)" 체크박스 확인
      4. 체크박스 토글 → 저장 버튼 클릭
      5. 페이지 새로고침 → 설정 유지 확인
    Expected Result: 토글이 표시되고, 저장 후 새로고침해도 값이 유지됨
    Failure Indicators: 토글이 보이지 않음, 저장 후 값 초기화됨
    Evidence: .sisyphus/evidence/task-2-admin-toggle.png

  Scenario: Default value is false for existing schools
    Tool: Bash (curl/Playwright)
    Preconditions: 기존 학교 설정 (useEntryChallenge 없음)
    Steps:
      1. 관리자 설정 페이지 로드
      2. 입장 챌린지 체크박스 상태 확인
    Expected Result: 체크박스가 체크 해제 상태 (false)
    Failure Indicators: 체크박스가 체크되어 있음
    Evidence: .sisyphus/evidence/task-2-default-value.png
  ```

  **Commit**: YES
  - Message: `feat(admin): add entry challenge toggle to school settings`
  - Files: `src/pages/admin/SchoolSettings.tsx`

- [ ] 3. Challenge Hook + Modal — `useQueueChallenge` 훅 및 `QueueChallengeModal` 컴포넌트

  **What to do**:
  - **`src/hooks/useQueueChallenge.ts`** (신규):
    - 상태: `challengeCode`, `userInput`, `isOpen`, `isShaking`, `hasError`
    - `openChallenge()`: 난수 생성 + 모달 열기
    - `handleDigitInput(index, value)`: 개별 숫자 입력 처리, 자동 포커스 이동
    - `handleBackspace(index)`: 이전 박스로 포커스 복귀
    - `handlePaste(text)`: 4자리 붙여넣기 처리
    - `submitChallenge()`: 입력값과 난수 비교 → 성공 시 콜백 호출
    - `closeChallenge()`: 모달 닫기 + 상태 초기화
    - 반환: `{ isOpen, challengeDigits, userDigits, isShaking, hasError, openChallenge, handleDigitInput, handleBackspace, handlePaste, submitChallenge, closeChallenge }`
    - 난수 생성: `String(Math.floor(Math.random() * 10000)).padStart(4, '0')`
    - 오입력 시: 흔들림 애니메이션 500ms → 입력 초기화 → 새 난수 생성
  
  - **`src/components/QueueChallengeModal.tsx`** (신규):
    - `fixed inset-0 z-50` 배경 블러(`backdrop-blur-sm bg-black/50`) 오버레이
    - `role="dialog"`, `aria-modal="true"`, `aria-label="입장 확인"`
    - 숫자 4개 독립 박스: `w-14 h-16 text-2xl font-bold bg-stone-50 border-2 rounded-xl`
    - 각 박스: `inputMode="numeric" pattern="[0-9]" type="text"` (모바일 숫자 키패드)
    - 흔들림: CSS keyframes `shake` (`transform: translate3d(-4px, 0, 0)` → `translate3d(4px, 0, 0)`)
    - 에러 피드백: "번호가 일치하지 않습니다. 새로운 번호가 생성되었습니다." (로즈색)
    - 닫기 버튼: 우상단 X 아이콘 + ESC 키 지원
    - 전체 입력 시 자동 제출

  **Must NOT do**:
  - SmartQueueGate.tsx 수정 금지 (Task 4에서 별도 처리)
  - 서버 통신 로직 추가 금지
  - 난수 난이도 설정 추가 금지
  - 만료 시간/TTL 추가 금지

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: 프리미엄 UI 모달 구현 + 마이크로 인터랙션 + 모바일 최적화
  - **Skills**: [`frontend-design`, `animate`]
    - `frontend-design`: 프로젝트 컨텍스트에 맞는 디자인 시스템 준수
    - `animate`: 흔들림 애니메이션, 포커스 전환 효과

  **Parallelization**:
  - **Can Run In Parallel**: YES (Task 2와 병렬)
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 4
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/components/SmartQueueGate.tsx:1172-1206` — 기존 모달 패턴 (프로그램 이미지 뷰어). `fixed inset-0 z-[100]` + `onClick` 닫기 + `onClick stopPropagation`. 이 패턴을 따르되 z-index는 `z-50` 사용.
  - `src/components/SmartQueueGate.tsx:958-971` — 기존 입력 폼 패턴. `inputMode="numeric"` + `rounded-2xl border` 스타일. 숫자 박스에도 동일한 스타일 가이드 적용.
  - `.impeccable.md` — 프로젝트 디자인 시스템 토큰 (색상, 둥근 정도, 폰트)

  **API/Type References**:
  - `src/types/models.ts:SchoolConfig.queueSettings.useEntryChallenge` — Task 1에서 추가한 타입

  **External References**:
  - Tailwind CSS keyframes: `tailwind.config.js`에 `shake` 애니메이션 정의 필요 시 참고

  **WHY Each Reference Matters**:
  - `1172-1206줄` — 기존 모달 구현의 정확한 패턴. 오버레이 + 모달 구조, 클릭 이벤트 처리 방식, 반응형 대응.
  - `958-971줄` — 기존 숫자 입력의 스타일링. `rounded-2xl` + `border-gray-200` + `focus:border-snu-blue` 패턴.
  - `.impeccable.md` — 프로젝트 전체 디자인 토큰. 일관된 UI를 위해 필수 참고.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Modal opens and displays 4 digit boxes
    Tool: Playwright
    Preconditions: 훅 + 모달 컴포넌트 구현 완료, dev server 실행 중
    Steps:
      1. 임시 테스트 페이지에서 openChallenge() 호출
      2. 모달이 표시되는지 확인
      3. 4개의 숫자 입력 박스가 표시되는지 확인
      4. 각 박스에 숫자만 입력 가능한지 확인
    Expected Result: 4개의 독립된 숫자 입력 박스가 포함된 모달 표시
    Failure Indicators: 모달이 열리지 않음, 박스가 4개가 아님, 문자 입력 가능
    Evidence: .sisyphus/evidence/task-3-modal-open.png

  Scenario: Correct input triggers success callback
    Tool: Playwright
    Preconditions: 모달 열림 상태
    Steps:
      1. 생성된 난수를 확인 (디버그 모드)
      2. 4개 박스에 올바른 숫자 순서대로 입력
      3. 성공 콜백이 호출되는지 확인
    Expected Result: 올바른 입력 후 모달 닫힘 + 성공 콜백 실행
    Failure Indicators: 콜백 미호출, 모달 유지
    Evidence: .sisyphus/evidence/task-3-correct-input.txt

  Scenario: Wrong input shows shake animation
    Tool: Playwright
    Preconditions: 모달 열림 상태
    Steps:
      1. 잘못된 4자리 숫자 입력
      2. 흔들림 애니메이션 확인
      3. 에러 메시지 "번호가 일치하지 않습니다" 표시 확인
      4. 입력 초기화 + 새 난수 생성 확인
    Expected Result: 흔들림 → 에러 메시지 → 입력 초기화 → 새 난수
    Failure Indicators: 흔들림 없음, 에러 메시지 없음, 입력 유지
    Evidence: .sisyphus/evidence/task-3-wrong-input.png

  Scenario: Mobile numeric keyboard appears
    Tool: Playwright (mobile emulation)
    Preconditions: 모바일 에뮬레이션 (iPhone 14)
    Steps:
      1. 숫자 박스 탭
      2. inputMode="numeric" 확인
      3. 숫자 키패드가 나타나는지 확인
    Expected Result: 숫자 전용 키패드 표시
    Failure Indicators: 전체 키보드 표시
    Evidence: .sisyphus/evidence/task-3-mobile-keyboard.png
  ```

  **Commit**: YES
  - Message: `feat(queue): implement useQueueChallenge hook and modal`
  - Files: `src/hooks/useQueueChallenge.ts`, `src/components/QueueChallengeModal.tsx`

- [ ] 4. Integration — SmartQueueGate에 챌린지 연동

  **What to do**:
  - `src/components/SmartQueueGate.tsx` 수정:
    - `import { useQueueChallenge } from '../hooks/useQueueChallenge'`
    - `import QueueChallengeModal from './QueueChallengeModal'`
    - 컴포넌트 내부에 훅 호출: `const challenge = useQueueChallenge({ onSuccess: () => void joinQueue() })`
    - 데스크톱 조인 버튼(978줄) `onClick` 변경: `() => { if (shouldShowChallenge) { challenge.openChallenge(); } else { void joinQueue(); } }`
    - 모바일 하단 바 조인 버튼(1131줄) `onClick` 동일하게 변경
    - `shouldShowChallenge` 계산: `schoolConfig?.queueSettings?.useEntryChallenge === true && (!myEntry || myEntry.status === 'expired')`
    - 모달 렌더링: `{challenge.isOpen && <QueueChallengeModal ...challenge />}` 을 JSX 최하단에 추가
  
  - `tailwind.config.js`에 `shake` keyframe 애니메이션 추가 (Task 3에서 필요 시 이곳으로 이동)

  **Must NOT do**:
  - `joinQueue()` 함수 내부 수정 금지
  - `startRegistration()` 경로에 챌린지 추가 금지
  - `autoEntering` 경로에 챌린지 추가 금지
  - `queueEnabled === false` 경로에 챌린지 추가 금지
  - 이미 `eligible` 상태인 사용자에게 챌린지 표시 금지

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 기존 파일에 최소한의 변경 (~15줄 추가)
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (순차)
  - **Blocks**: Task 5
  - **Blocked By**: Tasks 2, 3

  **References**:

  **Pattern References**:
  - `src/components/SmartQueueGate.tsx:977-984` — 데스크톱 조인 버튼. `onClick={() => void joinQueue()}` 이 부분을 챌린지 인터셉트로 교체.
  - `src/components/SmartQueueGate.tsx:1130-1136` — 모바일 하단 바 조인 버튼. 동일하게 인터셉트.
  - `src/components/SmartQueueGate.tsx:951-973` — `!myEntry || myEntry.status === 'expired'` 조건부 렌더링. 이 조건이 true일 때만 조인 버튼이 표시됨. 챌린지도 이 조건과 동일하게 적용.
  - `src/components/SmartQueueGate.tsx:209` — `queueEnabled` 체크 패턴. `schoolConfig?.queueSettings?.enabled !== false`. `useEntryChallenge`도 동일하게 `=== true` 체크.
  - `src/components/SmartQueueGate.tsx:1207-1209` — 모달 렌더링 위치. 프로그램 이미지 모달 다음에 새 모달 추가.

  **API/Type References**:
  - `src/types/models.ts:SchoolConfig.queueSettings.useEntryChallenge` — Task 1에서 추가
  - `src/hooks/useQueueChallenge.ts` — Task 3에서 생성한 훅 인터페이스
  - `src/components/QueueChallengeModal.tsx` — Task 3에서 생성한 모달 props

  **WHY Each Reference Matters**:
  - `977-984줄` — 챌린지 인터셉트의 정확한 위치. 이 onClick만 교체하면 됨.
  - `1130-1136줄` — 모바일 조인 버튼도 동일하게 교체 필요. 누락 시 모바일에서 챌린지 없이 바로 진입됨.
  - `209줄` — boolean 설정 읽기의 정확한 패턴. `!== false`가 아닌 `=== true`를 사용하여 undefined를 false로 처리.

  **Acceptance Criteria**:

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Challenge appears on desktop join button when enabled
    Tool: Playwright
    Preconditions: useEntryChallenge = true, 대기열 활성, 오픈 시간 이후
    Steps:
      1. /{schoolId}/gate 접속
      2. 이름 + 휴대폰 입력
      3. "대기열 입장" 버튼 클릭
      4. 챌린지 모달이 표시되는지 확인
    Expected Result: 모달이 열리고 4자리 난수가 보임
    Failure Indicators: 모달 없이 바로 joinQueue 실행, 에러 발생
    Evidence: .sisyphus/evidence/task-4-desktop-challenge.png

  Scenario: Challenge appears on mobile bottom bar when enabled
    Tool: Playwright (mobile emulation)
    Preconditions: useEntryChallenge = true, 모바일 뷰
    Steps:
      1. 모바일 에뮬레이션에서 /{schoolId}/gate 접속
      2. 이름 + 휴대폰 입력
      3. 하단 바 "대기열 입장" 버튼 클릭
      4. 챌린지 모달이 하단 바 위에 표시되는지 확인
    Expected Result: 모달이 z-50으로 하단 바(z-40) 위에 표시
    Failure Indicators: 모달이 하단 바에 가려짐
    Evidence: .sisyphus/evidence/task-4-mobile-challenge.png

  Scenario: No challenge when useEntryChallenge is false/undefined
    Tool: Playwright
    Preconditions: useEntryChallenge = false (또는 설정 없음)
    Steps:
      1. /{schoolId}/gate 접속
      2. "대기열 입장" 버튼 클릭
      3. 모달 없이 바로 joinQueue 실행되는지 확인
    Expected Result: 챌린지 모달 없이 바로 대기열 진입 시도
    Failure Indicators: 모달이 나타남 (설정이 false인데도)
    Evidence: .sisyphus/evidence/task-4-no-challenge.txt

  Scenario: No challenge for eligible users (auto-enter flow)
    Tool: Playwright
    Preconditions: 이미 대기열 eligible 상태, useEntryChallenge = true
    Steps:
      1. /{schoolId}/gate 접속 (이미 eligible 상태)
      2. "지금 신청하기" 버튼 확인
      3. 챌린지 없이 startRegistration 실행되는지 확인
    Expected Result: 챌린지 없이 자동/수동 입장 진행
    Failure Indicators: eligible 사용자에게 챌린지 모달 표시
    Evidence: .sisyphus/evidence/task-4-eligible-no-challenge.txt

  Scenario: No challenge in queueEnabled=false flow
    Tool: Playwright
    Preconditions: queueSettings.enabled = false, useEntryChallenge = true
    Steps:
      1. /{schoolId}/gate 접속
      2. "바로 신청하기" 버튼 확인
      3. 챌린지 없이 startRegistration 실행
    Expected Result: 대기열 없이 직접 신청 경로 동작 (챌린지 없음)
    Failure Indicators: 직접 신청 경로에서 챌린지 모달 표시
    Evidence: .sisyphus/evidence/task-4-direct-no-challenge.txt

  Scenario: npm run build success
    Tool: Bash
    Preconditions: 모든 파일 수정 완료
    Steps:
      1. npm run build
      2. 빌드 출력 확인
    Expected Result: 빌드 성공, 에러 0개
    Failure Indicators: TypeScript 에러, import 에러
    Evidence: .sisyphus/evidence/task-4-build.txt
  ```

  **Commit**: YES
  - Message: `feat(queue): integrate entry challenge into SmartQueueGate join flow`
  - Files: `src/components/SmartQueueGate.tsx`, `tailwind.config.js` (shake 애니메이션 필요 시)

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

- [ ] F1. **Build & Type Verification** — `unspecified-high`
  Run `npm run build` and verify zero errors. Run LSP diagnostics on all modified files. Check for TypeScript type errors, unused imports, and missing references.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F2. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test integration: challenge → joinQueue → queue state update. Test edge cases: modal close, wrong input, feature toggle off. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

---

## Commit Strategy

- **Task 1**: `feat(queue): add useEntryChallenge field to SchoolConfig` - `src/types/models.ts`
- **Task 2**: `feat(admin): add entry challenge toggle to school settings` - `src/pages/admin/SchoolSettings.tsx`
- **Task 3**: `feat(queue): implement useQueueChallenge hook and modal` - `src/hooks/useQueueChallenge.ts`, `src/components/QueueChallengeModal.tsx`
- **Task 4**: `feat(queue): integrate entry challenge into SmartQueueGate join flow` - `src/components/SmartQueueGate.tsx`
- Pre-commit: `npm run build`

---

## Success Criteria

### Verification Commands
```bash
npm run build  # Expected: successful build with no errors
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] Build passes with no errors
- [ ] Challenge appears only when `useEntryChallenge === true`
- [ ] Challenge does NOT appear in: queueEnabled: false flow, autoEntering flow, startRegistration flow
- [ ] Both desktop and mobile join buttons trigger challenge
- [ ] Wrong input shows shake animation and resets
- [ ] Modal close returns to normal state without joining queue
