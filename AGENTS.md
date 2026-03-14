# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-24
**Project:** admission - University Event Reservation System

## OVERVIEW
Event registration system for universities with dynamic form fields, queue management, and AlimTalk notifications. React + TypeScript + Vite frontend, Firebase Functions backend, NHN Cloud AlimTalk integration.

## STRUCTURE
```
admission/
├── src/                      # Frontend (React + TypeScript)
│   ├── pages/
│   │   ├── school/          # School-facing pages (Register, Queue, Lookup, etc.)
│   │   └── admin/           # Admin dashboard (SchoolSettings, SchoolList, Login)
│   ├── components/          # Reusable UI components (AdminRoute, QueueController, etc.)
│   ├── contexts/            # React Context providers (AuthContext, SchoolContext)
│   ├── lib/                 # Utilities (cn class name helper)
│   ├── hooks/               # Custom React hooks (useTheme)
│   ├── types/               # TypeScript type definitions (models.ts)
│   ├── firebase/            # Firebase client configuration
│   └── layouts/             # Layout components (SchoolLayout)
├── functions/               # Firebase Cloud Functions backend
│   ├── src/index.ts         # Firestore triggers, AlimTalk API integration
│   └── lib/                 # Backend utilities
├── public/                  # Static assets
├── .trae/documents/         # Architecture docs (PRD, technical design)
└── dist/                    # Vite build output
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Frontend entry point | `src/main.tsx` | React 18 with StrictMode |
| Route definitions | `src/App.tsx` | All routes defined here |
| Backend entry point | `functions/src/index.ts` | Firestore triggers, AlimTalk |
| Type definitions | `src/types/models.ts` | SchoolConfig, Registration, AdminUser |
| Firebase config | `src/firebase/config.ts` | Client initialization |
| School domain pages | `src/pages/school/` | Register, Queue, Parking, Main, Lookup, Complete |
| Admin domain pages | `src/pages/admin/` | Dashboard, SchoolSettings, SchoolList, Login |
| Reusable components | `src/components/` | AdminRoute, QueueController, RegistrationList |
| State management | `src/contexts/` | AuthContext, SchoolContext (no Redux, uses Context API) |
| Build configuration | `vite.config.ts`, `tsconfig.json` | Vite + TypeScript project references |
| Deployment config | `firebase.json` | Hosting, Functions, Firestore rules |

## CONVENTIONS
**TypeScript Configuration:**
- Project references mode (`tsc -b`) for faster builds
- Strict mode disabled (`strict: false`), type checking via `tsc --noEmit`
- Path alias: `@/*` maps to `./src/*`

**React Patterns:**
- Functional components with hooks
- Context API for state (AuthContext, SchoolContext)
- No Redux/mobX - use Context or Zustand if needed
- React Router v7 with nested routes (SchoolLayout wrapper)
- Form handling: react-hook-form

**CSS/Styling:**
- Tailwind CSS v3.4 with PostCSS + Autoprefixer
- CLSX + tailwind-merge for conditional classes
- Utility function: `cn()` in `src/lib/utils.ts`

**Firebase:**
- Firestore for data persistence
- Firebase Authentication for admin users
- Cloud Functions for backend logic (Firestore triggers)
- Realtime Database rules: `database.rules.json`

**Code Organization:**
- Domain-based grouping: `src/pages/school/`, `src/pages/admin/`
- No index.ts barrels in deep modules (each file imported directly)
- Centralized routing in `src/App.tsx`

## ANTI-PATTERNS (THIS PROJECT)
No explicit anti-patterns documented in code. To be added:
- Direct Firestore queries from components (prefer context/service layer)
- Hardcoded template codes (use schoolConfig.alimtalkSettings)

## COMMANDS

### Frontend (Root)
```bash
npm run dev          # Start Vite dev server (HMR enabled)
npm run build        # Type-check + build for production
npm run lint         # Run ESLint
npm run check        # Type-check only (no build)
npm run preview      # Preview production build locally
```

### Backend (Firebase Functions)
```bash
cd functions
npm run build        # Compile TypeScript
npm run serve        # Run Firebase emulators
npm run shell        # Interactive functions shell
npm run deploy       # Deploy to Firebase
npm run logs         # View function logs
```

### Firebase Deployment
```bash
firebase deploy              # Deploy all (hosting + functions)
firebase deploy --only hosting   # Deploy frontend only
firebase deploy --only functions  # Deploy backend only
```

### NHN Cloud AlimTalk Setup
```bash
firebase functions:config:set nhn.appkey="YOUR_APP_KEY" nhn.secretkey="YOUR_SECRET_KEY" nhn.sender_key="YOUR_SENDER_KEY"
```

## NOTES

**No Test Framework:**
- No test command or test framework configured
- Consider adding Vitest for frontend testing
- No test files present in codebase

**No CI/CD:**
- No GitHub Actions or GitLab CI workflows
- Manual deployment via Firebase CLI
- Consider adding GitHub Actions for automated testing/deployment

**AlimTalk Integration:**
- NHN Cloud API v1.5 for AlimTalk notifications
- Three templates: success (확정), waitlist (대기), promote (승급)
- Requires Firebase config: nhn.appkey, nhn.secretkey, nhn.sender_key

**Architecture Documents:**
- Located in `.trae/documents/` (non-standard location)
- `university_event_reservation_prd.md` - Product requirements
- `university_event_reservation_technical_architecture.md` - Technical design

**Custom Vite Plugin:**
- `vite-plugin-trae-solo-badge` adds Trae AI badge in production (bottom-right)

**Key Types:**
- `SchoolConfig`: Per-school configuration (formFields, alimtalkSettings, terms, etc.)
- `Registration`: User registration record with status (confirmed/waitlisted/canceled)
- `AdminUser`: Admin user with role (MASTER/SCHOOL)

**Database Structure:**
- `admins/{adminId}` - Admin users collection
- `schools/{schoolId}` - School configuration collection
- `schools/{schoolId}/registrations/{registrationId}` - Registration subcollection

**Large Files (>300 lines):**
- `src/pages/school/Register.tsx` (310 lines) - Main registration form
- `src/pages/admin/SchoolSettings.tsx` (251 lines) - Admin configuration UI
