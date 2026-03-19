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
