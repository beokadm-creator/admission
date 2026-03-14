# ADMIN PAGES MODULE

**Domain:** School administration dashboard

## OVERVIEW
Four admin pages for managing schools: authentication, dashboard routing, school listing/creation, and per-school settings configuration.

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Admin authentication | `Login.tsx` | Firebase Auth login for MASTER/SCHOOL roles |
| Admin dashboard | `Dashboard.tsx` | Role-based routing (MASTER → SchoolList, SCHOOL → SchoolSettings) |
| School management | `SchoolList.tsx` | List all schools, create new ones |
| School configuration | `SchoolSettings.tsx` (251 lines) | Edit schoolConfig (formFields, alimtalkSettings, terms, etc.) |

## CONVENTIONS
**Admin-Specific Patterns:**
- All admin routes require authentication via `AdminRoute` component wrapper
- Role-based access control: `UserRole = 'MASTER' | 'SCHOOL'`
- MASTER admins can access all schools via SchoolList
- SCHOOL admins restricted to their `assignedSchoolId`
- Uses both AuthContext (authentication) and AdminContext (authorization)

**RBAC Implementation:**
```typescript
// AdminRoute checks:
- User logged in? (AuthContext)
- User has admin role? (admins collection)
- SCHOOL role: assignedSchoolId matches route param?
```

**State Management:**
- Firebase Auth for authentication
- Firestore `admins/{adminId}` for role/assignment data
- Firestore `schools/{schoolId}` for school configuration

**Data Access:**
- MASTER: Read/write all schools
- SCHOOL: Read/write only assignedSchoolId

## ANTI-PATTERNS
- Bypassing AdminRoute wrapper (exposes protected routes)
- Hardcoding role checks (use AdminContext utilities)
- Editing schools without ownership check (for SCHOOL role)
- Storing secrets in schoolConfig (use Firebase functions config)
