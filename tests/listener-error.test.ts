import assert from 'node:assert/strict';
import { notifyListenerError } from '../src/firebase/firestoreService';
import { OperationType } from '../src/firebase/config';

console.log('--- RUNNING LISTENER ERROR NOTIFICATION TESTS ---');

// Test 1: notifyListenerError calls onError without re-throwing the handleFirestoreError exception
{
  let calledError: Error | null = null;
  const mockFirebaseError = new Error('Missing or insufficient permissions');
  (mockFirebaseError as any).code = 'permission-denied';

  // Even though handleFirestoreError throws, notifyListenerError must catch it and invoke onError
  assert.doesNotThrow(() => {
    notifyListenerError(
      mockFirebaseError,
      OperationType.LIST,
      'members',
      (err) => {
        calledError = err;
      }
    );
  }, 'notifyListenerError must never throw unhandled exception to the caller');

  assert.ok(calledError, 'onError callback must be invoked');
  assert.equal((calledError as any).code, 'permission-denied', 'Error code must be preserved');
  assert.equal((calledError as any).message, 'Missing or insufficient permissions', 'Error message must be preserved');
  console.log('✓ Listener error propagation to onError callback passed');
}

// Test 2: Non-Error objects are wrapped into Error instances
{
  let calledError: any = null;
  notifyListenerError(
    'raw-string-error',
    OperationType.LIST,
    'sessions',
    (err: any) => {
      calledError = err;
    }
  );

  assert.ok(calledError instanceof Error, 'Raw strings must be converted to Error instances');
  assert.equal(calledError?.message, 'raw-string-error');
  console.log('✓ Non-Error object conversion passed');
}

// Test 3: Safe when onError is undefined
{
  assert.doesNotThrow(() => {
    notifyListenerError(
      new Error('Test error without callback'),
      OperationType.GET,
      'users/test-uid',
      undefined
    );
  }, 'Must safely handle undefined onError');
  console.log('✓ Undefined onError handling passed');
}

console.log('ALL LISTENER ERROR TESTS PASSED SUCCESSFULLY!');
process.exit(0);
