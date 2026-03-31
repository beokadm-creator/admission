# Firestore Queue Cutover And Test Plan

## Purpose

This document defines the post-RTDB validation plan for the Firestore-only queue, reservation, and registration flow.

For the current operational stability checklist that includes presence, refresh recovery, eligible timeout, and 3-minute session expiry, also use:

- `.trae/documents/queue_operational_stability_validation.md`

Goals:

- Verify that queue state, reservation state, and final registrations stay consistent under retries and concurrency.
- Give admins a concrete cutover checklist for deployment day.
- Define the minimum manual QA needed before opening traffic.

## New Source Of Truth

The system now uses Firestore only.

Operational documents:

- `schools/{schoolId}`
  - school configuration
  - `stats.confirmedCount`
  - `stats.waitlistedCount`
- `schools/{schoolId}/queueState/current`
  - `currentNumber`
  - `lastAssignedNumber`
  - `activeReservationCount`
  - `confirmedCount`
  - `waitlistedCount`
  - `totalCapacity`
  - `availableCapacity`
- `schools/{schoolId}/queueEntries/{userId}`
  - per-user queue number and live eligibility state
- `schools/{schoolId}/reservations/{reservationId}`
  - active session state
- `schools/{schoolId}/registrations/{registrationId}`
  - final submitted result
- `schools/{schoolId}/requestLocks/{requestId}`
  - idempotency ledger

## Invariants

These conditions should always hold:

1. `queueState.availableCapacity = totalCapacity - confirmedCount - waitlistedCount - activeReservationCount`
2. A user has at most one active reservation with status `reserved` or `processing`
3. A reservation can only move forward:
   - `reserved -> confirmed`
   - `reserved -> expired`
   - `processing -> confirmed`
   - `processing -> expired`
4. A registration is created at most once per successful reservation submit
5. A repeated request with the same `requestId` returns the existing result and must not mutate counts twice

## Required Firestore Indexes

Required indexes are defined in [firestore.indexes.json](/C:/Users/whhol/Documents/trae_projects/admission/firestore.indexes.json).

Important composite indexes:

- `registrations(studentName, phoneLast4, submittedAt desc)`
- `registrations(phone, status)`
- `reservations(userId, status)`
- `reservations(status, expiresAt)`

## Pre-Deploy Checklist

1. Deploy Firestore rules and indexes.
2. Deploy Functions.
3. Deploy Hosting.
4. Confirm no RTDB configuration remains in local env or Firebase config.
5. Confirm `joinQueue`, `startRegistrationSession`, `getReservationSession`, `confirmReservation`, `forceExpireSession` are callable in the target project.
6. For each open school, initialize `queueState/current` if missing.
7. Confirm admin settings page updates `queueState/current.totalCapacity`.

## Manual QA

### A. Basic Queue Flow

1. Open the gate page before `openDateTime`.
2. Confirm the gate is closed and no queue join is possible.
3. Move `openDateTime` to the past.
4. Join the queue as one user.
5. Confirm:
   - `queueEntries/{userId}` exists
   - `lastAssignedNumber` increments
   - `currentNumber` is set for immediate admission when capacity exists

### B. Reservation Session

1. Start registration from an eligible queue position.
2. Confirm:
   - a `reservations/{reservationId}` document is created
   - `activeReservationCount` increments
   - `availableCapacity` decrements
3. Refresh the page.
4. Confirm the same session is reused and no duplicate session is created.

### C. Successful Submit

1. Submit valid form data.
2. Confirm:
   - `registrations/{registrationId}` exists
   - reservation status becomes `confirmed`
   - queue entry becomes `consumed`
   - `stats.confirmedCount` or `stats.waitlistedCount` updates once
   - `queueState/current` counters remain balanced

### D. Session Expiry

1. Start registration.
2. Wait for session expiry or trigger `forceExpireSession`.
3. Confirm:
   - reservation becomes `expired`
   - queue entry becomes `expired`
   - `activeReservationCount` decrements
   - `availableCapacity` returns

### E. Cancel Flow

1. Lookup a confirmed registration.
2. Cancel it.
3. Confirm:
   - registration status becomes `canceled`
   - `stats` decrements once
   - `queueState.availableCapacity` increases accordingly

## Concurrency QA

### 1. Duplicate Join

Expected:

- same user presses join multiple times
- only one queue entry survives
- same result is returned when reusing the same `requestId`

### 2. Duplicate Start Session

Expected:

- same user repeats start request
- active reservation is reused
- `activeReservationCount` does not increase twice

### 3. Duplicate Confirm

Expected:

- same `requestId` returns same registration result
- registration document is created once
- counts change once

### 4. Auto Advance Race

Expected:

- two scheduler executions do not over-advance `currentNumber`
- `currentNumber` increases only by allowed `advanceAmount`

### 5. Expire vs Confirm Race

Expected:

- a session near expiry ends in exactly one terminal state
- no case where counts are decremented twice or registration is duplicated

## Recommended Verification Queries

Use these checks after QA or after cutover:

1. `queueState/current.availableCapacity` should never be negative
2. `queueState/current.lastAssignedNumber >= currentNumber`
3. count of active reservations should match `activeReservationCount`
4. there should be no reservations stuck in `processing` for longer than session timeout

## Post-Deploy Monitoring

For the first live event, monitor:

- number of new `requestLocks` per minute
- number of active reservations per school
- expired reservation count from scheduled cleanup
- any Functions error logs from:
  - `joinQueue`
  - `startRegistrationSession`
  - `confirmReservation`
  - `cleanupExpiredReservations`
  - `autoAdvanceQueue`

## Rollback Guidance

There is no RTDB rollback target anymore.

If issues occur:

1. disable the school by setting `schools/{schoolId}.isActive = false`
2. inspect `queueState/current`
3. inspect active reservations
4. run `resetSchoolState` only if the event must be fully re-opened from zero

## Exit Criteria

The cutover is considered stable when:

- all manual QA scenarios pass
- duplicate request scenarios do not double-count
- expiry and cancel flows restore capacity correctly
- no RTDB references are present in app code or config
