/**
 * Recoverable dynamic loader for the Firestore service module.
 * Ensures rejected dynamic imports reset the cached promise so retries
 * execute a fresh module/connection load instead of staying permanently rejected.
 */
export function createLazyFirestoreLoader<T>(importer: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;

  return () => {
    if (!pending) {
      pending = importer().catch((err) => {
        pending = null;
        throw err;
      });
    }
    return pending;
  };
}

export const loadFirestoreService = createLazyFirestoreLoader(
  () => import('./firestoreService')
);

export interface AuthFirestoreLoadErrorState {
  registrationError: { code: string; message: string };
  authError: string;
}

/**
 * Normalizes dynamic Firestore / Auth bootstrap errors so LoginView exits
 * the verifying spinner and presents a recoverable Retry action.
 */
export function resolveAuthFirestoreLoadFailure(err: unknown): AuthFirestoreLoadErrorState {
  const errObj = err as { code?: string; message?: string } | null | undefined;
  const code =
    typeof errObj?.code === 'string' && errObj.code.trim().length > 0
      ? errObj.code.trim()
      : 'firestore-load-failed';
  const rawMessage =
    typeof errObj?.message === 'string' && errObj.message.trim().length > 0
      ? errObj.message.trim()
      : 'Could not load database services.';

  const friendly =
    rawMessage.toLowerCase().includes('fetch') ||
    rawMessage.toLowerCase().includes('import') ||
    rawMessage.toLowerCase().includes('network')
      ? 'Could not connect to club database services. Please check your connection and retry.'
      : rawMessage;

  return {
    registrationError: {
      code,
      message: friendly,
    },
    authError: friendly,
  };
}
