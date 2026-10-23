import React from 'react';
import { m, HTMLMotionProps } from 'motion/react';

export interface MotionButtonProps extends HTMLMotionProps<'button'> {
  children: React.ReactNode;
}

export const MotionButton = React.forwardRef<HTMLButtonElement, MotionButtonProps>(
  ({ children, className = '', whileTap, ...props }, ref) => {
    return (
      <m.button
        ref={ref}
        whileTap={whileTap !== undefined ? whileTap : { scale: 0.97 }}
        transition={{ duration: 0.1 }}
        className={`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#b5ff00] ${className}`}
        {...props}
      >
        {children}
      </m.button>
    );
  }
);

MotionButton.displayName = 'MotionButton';
