import { useReducedMotion } from 'motion/react';

export function useMotionSafe() {
  const shouldReduce = useReducedMotion();
  const reduced = Boolean(shouldReduce);

  return {
    reduced,
    duration: (ms: number) => (reduced ? 0 : ms),
  };
}
