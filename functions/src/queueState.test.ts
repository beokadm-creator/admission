import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQueueStateDoc,
  getAdvanceLimitFromCounts,
  getAvailableWriterSlots,
  getQueueAdvanceAmount,
  type QueueStateDoc
} from './queueState';

const round = {
  id: 'round1',
  label: 'Round 1',
  openDateTime: '2026-04-01T00:00:00.000Z',
  maxCapacity: 20,
  waitlistCapacity: 10,
  enabled: true
};

test('buildQueueStateDoc derives capacity and queue metadata from context', () => {
  const state = buildQueueStateDoc(
    round,
    {
      totalCapacity: 30,
      maxActiveSessions: 5,
      queueEnabled: true,
      now: 1234
    },
    {
      activeReservationCount: 2,
      confirmedCount: 10,
      waitlistedCount: 3
    }
  );

  assert.equal(state.totalCapacity, 30);
  assert.equal(state.availableCapacity, 15);
  assert.equal(state.maxActiveSessions, 5);
  assert.equal(state.updatedAt, 1234);
  assert.equal(state.queueEnabled, true);
});

test('getAvailableWriterSlots never returns a negative number', () => {
  const state = {
    roundId: 'round1',
    roundLabel: 'Round 1',
    currentNumber: 0,
    lastAssignedNumber: 0,
    lastAdvancedAt: 0,
    activeReservationCount: 8,
    pendingAdmissionCount: 0,
    maxActiveSessions: 5,
    confirmedCount: 0,
    waitlistedCount: 0,
    totalCapacity: 20,
    availableCapacity: 20,
    updatedAt: 0,
    queueEnabled: true
  } satisfies QueueStateDoc;

  assert.equal(getAvailableWriterSlots(state), 0);
});

test('getQueueAdvanceAmount is capped by waiting users, capacity, and session headroom', () => {
  const state = {
    roundId: 'round1',
    roundLabel: 'Round 1',
    currentNumber: 10,
    lastAssignedNumber: 20,
    lastAdvancedAt: 0,
    activeReservationCount: 2,
    pendingAdmissionCount: 1,
    maxActiveSessions: 5,
    confirmedCount: 0,
    waitlistedCount: 0,
    totalCapacity: 20,
    availableCapacity: 9,
    updatedAt: 0,
    queueEnabled: true
  } satisfies QueueStateDoc;

  assert.equal(getQueueAdvanceAmount(state), 2);
  assert.equal(getQueueAdvanceAmount(state, 1), 1);
});

test('getAdvanceLimitFromCounts respects live metrics rather than stale queue counts', () => {
  const state = {
    roundId: 'round1',
    roundLabel: 'Round 1',
    currentNumber: 10,
    lastAssignedNumber: 20,
    lastAdvancedAt: 0,
    activeReservationCount: 0,
    pendingAdmissionCount: 0,
    maxActiveSessions: 4,
    confirmedCount: 0,
    waitlistedCount: 0,
    totalCapacity: 20,
    availableCapacity: 20,
    updatedAt: 0,
    queueEnabled: true
  } satisfies QueueStateDoc;

  assert.equal(
    getAdvanceLimitFromCounts(state, {
      activeReservationCount: 2,
      pendingAdmissionCount: 1,
      confirmedCount: 0,
      waitlistedCount: 0,
      availableCapacity: 5
    }),
    1
  );
});
