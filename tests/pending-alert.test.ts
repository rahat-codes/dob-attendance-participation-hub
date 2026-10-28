import assert from 'node:assert/strict';
import { PendingRequestDetector } from '../src/utils/pendingAlerts';
import { UserProfile } from '../src/types';

function makeMockUser(id: string, status: UserProfile['status'], name = `User ${id}`): UserProfile {
  return {
    id,
    email: `${id}@example.com`,
    displayName: name,
    status,
    readAnnouncementIds: [],
    notificationPrefs: { enabled: true, announcements: true, reminders: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

console.log('--- RUNNING PENDING REQUEST DETECTOR TESTS ---');

// Test 1: Initial snapshot suppresses existing pending requests
{
  const detector = new PendingRequestDetector();
  const initialUsers: UserProfile[] = [
    makeMockUser('uid-1', 'pending'),
    makeMockUser('uid-2', 'pending'),
    makeMockUser('uid-3', 'active'),
  ];

  const alerts = detector.processUsers(initialUsers);
  assert.equal(alerts.length, 0, 'Initial snapshot must NOT trigger alerts');
  assert.equal(detector.getSeenCount(), 2, 'Initial pending UIDs must be marked as seen');
  console.log('✓ Initial snapshot suppression passed');
}

// Test 2: New pending user on subsequent snapshot triggers alert
{
  const detector = new PendingRequestDetector();
  const initialUsers: UserProfile[] = [
    makeMockUser('uid-1', 'pending'),
  ];
  detector.processUsers(initialUsers);

  const secondSnapshot: UserProfile[] = [
    makeMockUser('uid-1', 'pending'),
    makeMockUser('uid-2', 'pending', 'New Applicant'),
    makeMockUser('uid-3', 'active'),
  ];

  const alerts = detector.processUsers(secondSnapshot);
  assert.equal(alerts.length, 1, 'Exactly one alert must be emitted for new pending user');
  assert.equal(alerts[0].id, 'uid-2', 'Emitted user must be uid-2');
  assert.equal(alerts[0].displayName, 'New Applicant');
  console.log('✓ New arrival detection passed');
}

// Test 3: Deduplication - subsequent snapshots with same users do not re-trigger
{
  const detector = new PendingRequestDetector();
  detector.processUsers([makeMockUser('uid-1', 'pending')]);

  // First time uid-2 appears
  const alert1 = detector.processUsers([
    makeMockUser('uid-1', 'pending'),
    makeMockUser('uid-2', 'pending'),
  ]);
  assert.equal(alert1.length, 1);

  // Second time uid-2 appears in snapshot
  const alert2 = detector.processUsers([
    makeMockUser('uid-1', 'pending'),
    makeMockUser('uid-2', 'pending'),
  ]);
  assert.equal(alert2.length, 0, 'Deduplication must prevent duplicate alerts for the same user');
  console.log('✓ Deduplication across consecutive snapshots passed');
}

// Test 4: Non-pending status changes do not trigger pending alerts
{
  const detector = new PendingRequestDetector();
  detector.processUsers([makeMockUser('uid-1', 'active')]);

  const nextSnapshot: UserProfile[] = [
    makeMockUser('uid-1', 'active'),
    makeMockUser('uid-2', 'approved_waiting_response'),
    makeMockUser('uid-3', 'declined'),
  ];

  const alerts = detector.processUsers(nextSnapshot);
  assert.equal(alerts.length, 0, 'Non-pending statuses must not trigger alerts');
  console.log('✓ Non-pending statuses ignored passed');
}

// Test 5: Reset clears state
{
  const detector = new PendingRequestDetector();
  detector.processUsers([makeMockUser('uid-1', 'pending')]);
  detector.reset();
  // After reset, next call is treated as initial snapshot
  const alerts = detector.processUsers([makeMockUser('uid-1', 'pending'), makeMockUser('uid-2', 'pending')]);
  assert.equal(alerts.length, 0, 'After reset, next snapshot is treated as initial');
  console.log('✓ Detector reset passed');
}

console.log('ALL PENDING REQUEST DETECTOR TESTS PASSED SUCCESSFULLY!');
