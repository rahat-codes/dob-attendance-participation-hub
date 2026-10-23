export const ease = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
} as const;

export const dur = {
  fast: 0.15,
  base: 0.2,
  slow: 0.3,
  celebrate: 0.6,
} as const;

export const spring = {
  sheet: { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 },
  pop: { type: 'spring', stiffness: 520, damping: 22 },
} as const;

export const fadeUp = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: dur.base, ease: ease.out },
  },
  exit: {
    opacity: 0,
    transition: { duration: dur.fast },
  },
};

export const fade = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { duration: dur.base },
  },
  exit: {
    opacity: 0,
    transition: { duration: dur.fast },
  },
};

export const scaleIn = {
  hidden: { opacity: 0, scale: 0.97 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: dur.base, ease: ease.out },
  },
  exit: {
    opacity: 0,
    scale: 0.98,
    transition: { duration: dur.fast },
  },
};

export const sheetUp = {
  hidden: { y: '100%' },
  show: { y: 0, transition: spring.sheet },
  exit: { y: '100%', transition: { duration: dur.base, ease: ease.inOut } },
};

export const stagger = (step = 0.03, _max = 12) => ({
  show: {
    transition: {
      staggerChildren: step,
      delayChildren: 0.02,
    },
  },
});
