# SCHOOL PAGES MODULE

**Domain:** School-facing event registration pages

## OVERVIEW
Five route components power the school event funnel: landing/prompting, queue management, registration form, completion status, and lookup.

## WHERE TO LOOK
| Task | File | Notes |
|------|------|-------|
| Main registration form | `Register.tsx` (310 lines) | Dynamic form fields based on schoolConfig.formFields |
| Queue status display | `Queue.tsx` | Shows current position and waitlist status |
| School landing page | `Main.tsx` | Entry point with hero info, countdown, and navigation |
| Status lookup | `Lookup.tsx` | Phone-based registration lookup |
| Completion confirmation | `Complete.tsx` | Post-registration confirmation page |

## CONVENTIONS
**School-Specific Patterns:**
- All pages consume `SchoolContext` for schoolConfig (name, logo, formFields, terms)
- Form fields dynamically rendered based on `schoolConfig.formFields` flags (collectEmail, collectAddress, etc.)
- Terms content loaded from `schoolConfig.terms.privacy`, `terms.thirdParty`, `terms.sms`
- Route paths are nested under `/:schoolId` in App.tsx with SchoolLayout wrapper
- Phone number format: 010-0000-0000 (enforced in validation)

**Data Flow:**
- Read school config from Firestore: `schools/{schoolId}`
- Write registrations to subcollection: `schools/{schoolId}/registrations/{registrationId}`
- Registration status: 'confirmed' | 'waitlisted' | 'canceled'

**State Management:**
- Uses SchoolContext (not AuthContext - public access)
- No authentication required for school pages
- Client-side Firestore queries via Firebase SDK

## ANTI-PATTERNS
- Hardcoding form field names (derive from schoolConfig.formFields)
- Embedding school-specific logic in components (keep domain-agnostic)
- Direct Firestore queries without error boundaries
