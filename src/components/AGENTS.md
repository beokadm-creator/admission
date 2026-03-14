# REUSABLE COMPONENTS

**Purpose:** Shared UI components used across school and admin domains

## OVERVIEW
Five reusable components for route protection, queue management, registration display, and modal popups.

## WHERE TO LOOK
| Component | File | Purpose |
|-----------|------|---------|
| Auth route guard | `AdminRoute.tsx` | Protects admin routes, checks MASTER/SCHOOL roles |
| Empty state | `Empty.tsx` | Consistent empty/placeholder UI |
| Queue management | `QueueController.tsx` | Live queue position display with auto-refresh |
| Registration list | `RegistrationList.tsx` | Table view of registrations with filters |
| Modal popup | `SchoolPopup.tsx` | School-configurable popup for announcements |

## CONVENTIONS
**Component Patterns:**
- Functional components with TypeScript interfaces for props
- Tailwind CSS for styling (uses `cn()` utility from `src/lib/utils.ts`)
- Props interfaces defined inline or in `src/types/models.ts`
- No component-level state management (use Context or lift state)

**Styling:**
- Consistent use of Tailwind spacing and color utilities
- Responsive design with mobile-first approach
- Accessible button and form elements (add explicit type props)

**Composition:**
- Components are domain-agnostic (no school/admin logic)
- Receive data via props, not direct Firestore queries
- Emit events via callback props (onClick, onSubmit, etc.)

## ANTI-PATTERNS
- Embedding Firestore queries in components (prefer context/service layer)
- Domain logic in reusable components (keep pure UI)
- Missing prop TypeScript interfaces
- Inconsistent styling patterns
