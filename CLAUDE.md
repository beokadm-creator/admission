# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Frontend (root)
```bash
npm run dev       # Vite dev server with HMR
npm run build     # tsc -b && vite build (TypeScript check + bundle)
npm run lint      # ESLint
npm run check     # TypeScript type check only (no emit)
npm run preview   # Preview production build
```

### Cloud Functions (functions/)
```bash
cd functions
npm run build     # TypeScript compilation → lib/
npm run deploy    # Deploy functions to Firebase
npm run serve     # Build + start Firebase emulators (functions only)
npm run logs      # View function logs
```

### Firebase Emulators
```bash
firebase emulators:start   # Start all emulators (Auth:9099, Functions:14005, Firestore:18085, RTDB:19005, Hosting:15005)
```

### Deploy
```bash
firebase deploy             # Deploy everything
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## Architecture

**Multi-school event admission system** — schools configure their own registration forms; students register and optionally enter a waiting queue.

### Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS + React Router v7
- **State**: Zustand, React Context (AuthContext, SchoolContext)
- **Backend**: Firebase (Firestore, RTDB, Cloud Functions v1, Auth)
- **Notifications**: NHN Cloud AlimTalk (KakaoTalk SMS) via Cloud Functions
- **Path alias**: `@/*` → `./src/*`

### Route Structure
```
/admin/login                  Admin login
/admin/                       AdminDashboard (school list + stats)
/admin/schools                SchoolList
/admin/schools/:schoolId      SchoolSettings (edit school config)

/:schoolId/                   SchoolMain (landing with school info and queue entry links)
/:schoolId/gate               SmartQueueGate (queue entry point)
/:schoolId/queue              QueuePage (waiting position display)
/:schoolId/register           RegisterPage (registration form)
/:schoolId/complete           CompletePage (success)
/:schoolId/lookup             LookupPage (lookup + cancel by phone)
```

Admin routes are guarded by `AdminRoute` which reads from `AuthContext`. School pages are wrapped in `SchoolLayout` with `SchoolContext` loading the school config from Firestore.

### Key Contexts
- **`AuthContext`** (`src/contexts/AuthContext.tsx`) — Firebase Auth state + `AdminUser` profile (role: `MASTER` | `SCHOOL`)
- **`SchoolContext`** (`src/contexts/SchoolContext.tsx`) — `SchoolConfig` for current `schoolId`, loaded from Firestore

### Data Models (`src/types/models.ts`)
- **`SchoolConfig`** — per-school configuration: capacity, form fields, queue settings, A/B test settings, AlimTalk templates, button visibility, terms
- **`Registration`** — student registration with status `confirmed | waitlisted | canceled`
- **`AdminUser`** — admin user with role `MASTER` (all schools) or `SCHOOL` (assigned school only)

### Cloud Functions (`functions/src/index.ts`)
All business logic lives here. Key groups:
- **Queue**: `joinQueue`, `reserveSlot`, `autoAdvanceQueue` (Pub/Sub scheduled), `cleanupExpiredReservations`
- **Registration**: `registerRegistration`, `registerRegistrationWithAB`, `confirmReservation`
- **Lookup/Cancel**: `lookupRegistration`, `cancelRegistration`
- **Notifications**: `sendAlimTalk`, `processAlimTalkQueue` (Firestore trigger), `retryPendingAlimTalkQueue` (Pub/Sub)
- **A/B Testing**: `getABTestGroup`, `getABTestResults`
- **Admin**: `getSystemStats` (MASTER only), `runMaintenanceTask`
- **Triggers**: `onRegistrationCreateQueued`, `onSchoolUpdate`, `scheduledCleanup`

### Queue & Slot System
- Uses Firebase RTDB (not Firestore) for low-latency queue operations
- RTDB paths: `queue/{schoolId}/`, `slots/{schoolId}/`
- Anonymous auth (`src/lib/queue.ts` → `getQueueUserId()`) gates queue entry
- Batch-based advancement: configurable `batchSize` + `batchInterval` per school
- `SmartQueueGate` component decides whether to show queue or pass directly to register

### Security
- Firestore rules enforce role-based access; clients can read `schools` but cannot write registrations/stats directly — all writes go through Cloud Functions using Admin SDK
- RTDB rules restrict slot reservations to Cloud Functions (system-only)
- Admin SDK credentials use ADC (Application Default Credentials) in Cloud Functions

### Environment Variables
Frontend uses `VITE_FIREBASE_*` env vars (`.env`). Cloud Functions use ADC / Firebase environment config.

## Design Context

전체 디자인 맥락은 `.impeccable.md`를 참조. 핵심 원칙 요약:

### Users
**주 사용자: 입학 지원 학생의 학부모** — 입학 당일 현장에서 스마트폰으로 대기열 등록. 고부담 상황, 중·장년층 포함, 빠르고 명확한 피드백이 불안 해소의 핵심.

### Brand Personality
- **3단어**: 신뢰, 안정, 격식
- 서울대학교 공식 채널의 권위와 공신력, 따뜻한 공식성
- 텍스트 어조: 존댓말, 명확한 안내, 불필요한 유행어 없음

### Aesthetic Direction
- SNU Blue(`#003B71`) 기반, 절제된 색상 팔레트
- **절대 피할 것**: 과도한 그라디언트/네온/화려함, 스타트업 감성, 극단적 미니멀, 관료적 올드 UI
- 라이트 모드 우선, 모바일 최우선

### Design Principles
1. **SNU Blue 기반 신뢰감 있는 색상 체계**: SNU Blue 일관성 유지, 임의 색상 변경 금지
2. **상태(대기/입장/완료)를 색상+숫자로 즉시 전달**: 대기/입장/완료 상태를 시각적으로 즉시 파악할 수 있도록 표현
3. **한글 가독성 우선, 최소 16px, 존댓말 어조**: 불안을 낮추는 타이포그래피, 충분한 크기와 쉬운 말 사용
4. **모바일 터치 최적화 (버튼 최소 56px)**: 핵심 행동은 한 화면에서 완결되도록 모바일 최우선 배치
5. **격식 있되 친절한 안내 문구**: 오류 메시지도 비난하지 않고 다음 행동 중심으로 작성
