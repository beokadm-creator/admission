# FIREBASE CLOUD FUNCTIONS BACKEND

**Purpose:** Firestore triggers and NHN Cloud AlimTalk integration

## OVERVIEW
Firebase Functions backend handling registration lifecycle events (onCreate, onUpdate) and sending AlimTalk notifications via NHN Cloud API v1.5.

## WHERE TO LOOK
| Task | Function/Location | Notes |
|------|-------------------|-------|
| Registration creation trigger | `onRegistrationCreate` in `index.ts` | Sends success/waitlist AlimTalk |
| Status update trigger | `onRegistrationUpdate` in `index.ts` | Sends promote AlimTalk (waitlist→confirmed) |
| AlimTalk API integration | `sendAlimTalk()` helper | NHN Cloud API v1.5 HTTP POST |
| Firebase config | `functions.config().nhn.*` | appkey, secretkey, sender_key |

## CONVENTIONS
**Firebase Functions Patterns:**
- Firestore triggers: `document('schools/{schoolId}/registrations/{registrationId}')`
- Async/await for all Firestore operations and HTTP requests
- Early return on error conditions (no SMS consent, missing config)
- Console logging for debugging (success and error cases)

**AlimTalk Integration:**
- Templates configured per-school in `schoolConfig.alimtalkSettings`
- Three template codes: successTemplate, waitlistTemplate, promoteTemplate
- Template parameters: studentName, schoolName, rank (for waitlist)
- HTTP POST to `https://api-alimtalk.cloud.toast.com/alimtalk/v1.5/appkeys/{appKey}/messages`

**Environment Variables:**
```bash
firebase functions:config:set nhn.appkey="..." nhn.secretkey="..." nhn.sender_key="..."
```
Access via: `functions.config().nhn.appkey`

**Error Handling:**
- Graceful degradation (if credentials missing, log error and return)
- Check `response.data.header.isSuccessful` before processing
- Log all failures with context (phone number, template code)

## COMMANDS
```bash
cd functions
npm run build        # Compile TypeScript
npm run serve        # Run Firebase emulators locally
npm run shell        # Interactive functions shell for testing
npm run deploy       # Deploy to Firebase (runs build predeploy)
npm run logs         # View function logs in production
```

## ANTI-PATTERNS
- Hardcoding AlimTalk template codes (use schoolConfig.alimtalkSettings)
- Skipping agreedSms consent check (privacy violation)
- Synchronous operations in triggers (always use async/await)
- Missing error boundaries (all HTTP calls in try/catch)
- Logging sensitive data (PII: phone numbers, student names)
