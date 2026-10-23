import fs from 'fs';
import path from 'path';
import { dur, ease, spring, fadeUp, fade, sheetUp, scaleIn, stagger } from '../src/motion/presets';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${message}`);
}

async function runMotionTests() {
  console.log('\n--- Running Motion Verification Tests ---\n');

  // Test 1: Preset tokens within non-negotiable budget
  console.log('Test 1: Preset token duration budgets');
  assert(dur.fast <= 0.15, `dur.fast (${dur.fast}) <= 0.15s`);
  assert(dur.base <= 0.25, `dur.base (${dur.base}) <= 0.25s`);
  assert(dur.slow <= 0.35, `dur.slow (${dur.slow}) <= 0.35s`);
  assert(dur.celebrate <= 0.70, `dur.celebrate (${dur.celebrate}) <= 0.70s`);
  assert(typeof ease.out === 'object' && ease.out.length === 4, 'ease.out is cubic bezier');
  assert(spring.sheet.stiffness > 300, 'spring.sheet has snappy stiffness');
  assert(spring.pop.stiffness > 400, 'spring.pop has energetic stiffness');

  // Test 2: Variants definition check
  console.log('Test 2: Motion variants check');
  assert(typeof fadeUp.hidden === 'object' && fadeUp.hidden.opacity === 0, 'fadeUp hidden opacity is 0');
  assert(typeof fadeUp.show === 'object' && fadeUp.show.opacity === 1, 'fadeUp show opacity is 1');
  assert(typeof fade.hidden === 'object' && fade.hidden.opacity === 0, 'fade hidden opacity is 0');
  assert(typeof sheetUp.hidden === 'object' && sheetUp.hidden.y === '100%', 'sheetUp hidden y is 100%');
  assert(typeof scaleIn.hidden === 'object' && scaleIn.hidden.opacity === 0, 'scaleIn hidden opacity is 0');
  const stag = stagger(0.03, 12);
  assert(typeof stag.show === 'object', 'stagger generator returns variant');

  // Test 3: Static codebase scan for prohibited motion features and direct `motion` component imports
  console.log('Test 3: Static scan across src/ for prohibited motion imports');
  const srcDir = path.resolve(process.cwd(), 'src');

  function scanDir(dir: string): string[] {
    const results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const item of list) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        results.push(...scanDir(fullPath));
      } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const allSourceFiles = scanDir(srcDir);
  assert(allSourceFiles.length > 10, `Found ${allSourceFiles.length} source files to scan`);

  for (const file of allSourceFiles) {
    const rel = path.relative(process.cwd(), file);
    const content = fs.readFileSync(file, 'utf-8');

    // Rule: Must NOT import `motion` from 'motion/react' or 'framer-motion' (must use `m`)
    // Allow MotionConfig, MotionProvider, etc.
    const forbiddenMotionImport = /import\s+{[^}]*\bmotion\b[^}]*}\s+from\s+['"](motion\/react|framer-motion)['"]/.test(content);
    assert(
      !forbiddenMotionImport,
      `File ${rel} must not import full 'motion' component directly (use 'm' from 'motion/react')`
    );

    // Rule: Must not use layout, layoutId, drag, Reorder
    // (Only search for props like layoutId=, drag=, or <Reorder)
    const hasLayoutId = /\blayoutId\s*=/.test(content);
    assert(!hasLayoutId, `File ${rel} must not use 'layoutId' (prohibited without domMax)`);

    const hasDrag = /\bdrag\s*=\s*['"{]/.test(content);
    assert(!hasDrag, `File ${rel} must not use 'drag' prop`);

    const hasReorder = /<\s*Reorder\b/.test(content);
    assert(!hasReorder, `File ${rel} must not use '<Reorder>' component`);
  }

  // Test 4: MotionProvider verification
  console.log('Test 4: MotionProvider configuration');
  const providerContent = fs.readFileSync(path.join(srcDir, 'motion', 'MotionProvider.tsx'), 'utf-8');
  assert(providerContent.includes('strict'), 'MotionProvider enforces LazyMotion strict mode');
  assert(providerContent.includes('reducedMotion="user"'), 'MotionProvider enforces reducedMotion="user"');

  // Test 5: index.css prefers-reduced-motion check
  console.log('Test 5: CSS prefers-reduced-motion overrides');
  const cssContent = fs.readFileSync(path.join(srcDir, 'index.css'), 'utf-8');
  assert(cssContent.includes('@media (prefers-reduced-motion: reduce)'), 'index.css has prefers-reduced-motion media query');
  assert(cssContent.includes('.animate-pulse'), 'index.css neutralizes animate-pulse under reduced motion');
  assert(cssContent.includes('.animate-spin'), 'index.css neutralizes animate-spin under reduced motion');

  console.log('\n🎉 ALL MOTION CHECKS PASSED!\n');
}

runMotionTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
