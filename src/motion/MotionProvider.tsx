import React from 'react';
import { LazyMotion, MotionConfig } from 'motion/react';

const loadFeatures = () => import('./features').then((m) => m.default);

export const MotionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig reducedMotion="user">
        {children}
      </MotionConfig>
    </LazyMotion>
  );
};
