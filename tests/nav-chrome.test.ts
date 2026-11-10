import {
  getNavChromeState,
  navChromeReducer,
  CLOSE_SIDEBAR_ON_SELECT,
  NavChromeStateInput,
  NavChromeEvent,
  ChromeReducerState,
} from '../src/utils/navChrome';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  }
}

console.log('--- RUNNING NAV CHROME LOGIC & STATE TESTS ---');

// 1. Pure getNavChromeState table-driven tests
const stateMatrix: Array<{
  input: NavChromeStateInput;
  expected: { topBarVisible: boolean; sidebarVisible: boolean };
  desc: string;
}> = [
  {
    input: { isDesktop: true, isSidebarOpen: false, isBlocked: false },
    expected: { topBarVisible: true, sidebarVisible: false },
    desc: 'Desktop default: top bar visible, sidebar hidden',
  },
  {
    input: { isDesktop: true, isSidebarOpen: true, isBlocked: false },
    expected: { topBarVisible: false, sidebarVisible: true },
    desc: 'Desktop with sidebar open: top bar hidden, sidebar visible',
  },
  {
    input: { isDesktop: false, isSidebarOpen: false, isBlocked: false },
    expected: { topBarVisible: false, sidebarVisible: false },
    desc: 'Mobile default: neither desktop bar visible (mobile bottom island handles nav)',
  },
  {
    input: { isDesktop: false, isSidebarOpen: true, isBlocked: false },
    expected: { topBarVisible: false, sidebarVisible: false },
    desc: 'Mobile with desktop sidebarOpen true: neither desktop bar visible',
  },
  {
    input: { isDesktop: true, isSidebarOpen: false, isBlocked: true },
    expected: { topBarVisible: false, sidebarVisible: false },
    desc: 'Desktop blocked: neither bar visible',
  },
  {
    input: { isDesktop: true, isSidebarOpen: true, isBlocked: true },
    expected: { topBarVisible: false, sidebarVisible: false },
    desc: 'Desktop blocked with sidebar open: neither bar visible',
  },
  {
    input: { isDesktop: false, isSidebarOpen: false, isBlocked: true },
    expected: { topBarVisible: false, sidebarVisible: false },
    desc: 'Mobile blocked: neither bar visible',
  },
];

for (const tc of stateMatrix) {
  const res = getNavChromeState(tc.input);
  assert(
    res.topBarVisible === tc.expected.topBarVisible &&
      res.sidebarVisible === tc.expected.sidebarVisible,
    `${tc.desc}: got ${JSON.stringify(res)}, expected ${JSON.stringify(tc.expected)}`
  );
  console.log(`✓ ${tc.desc}`);
}

// 2. Reducer table-driven tests across states x events
const initialState: ChromeReducerState = {
  isDesktop: true,
  isSidebarOpen: false,
  isBlocked: false,
};

// Event: toggleFromLogo on desktop
let state = navChromeReducer(initialState, { type: 'toggleFromLogo' });
assert(state.isSidebarOpen === true, 'toggleFromLogo opens sidebar on desktop');
console.log('✓ toggleFromLogo opens sidebar on desktop');

// Event: toggleFromLogo again closes it
state = navChromeReducer(state, { type: 'toggleFromLogo' });
assert(state.isSidebarOpen === false, 'toggleFromLogo closes sidebar when already open');
console.log('✓ toggleFromLogo toggles sidebar closed');

// Event: toggleFromLogo when blocked does nothing
const blockedState: ChromeReducerState = { isDesktop: true, isSidebarOpen: false, isBlocked: true };
const blockedToggle = navChromeReducer(blockedState, { type: 'toggleFromLogo' });
assert(blockedToggle.isSidebarOpen === false, 'toggleFromLogo ignored when blocked');
console.log('✓ toggleFromLogo ignored when blocked');

// Event: escape closes sidebar
state = { isDesktop: true, isSidebarOpen: true, isBlocked: false };
state = navChromeReducer(state, { type: 'escape' });
assert(state.isSidebarOpen === false, 'escape key closes sidebar');
console.log('✓ escape key closes sidebar');

// Event: scrimClick closes sidebar
state = { isDesktop: true, isSidebarOpen: true, isBlocked: false };
state = navChromeReducer(state, { type: 'scrimClick' });
assert(state.isSidebarOpen === false, 'scrimClick closes sidebar');
console.log('✓ scrimClick closes sidebar');

// Event: close closes sidebar
state = { isDesktop: true, isSidebarOpen: true, isBlocked: false };
state = navChromeReducer(state, { type: 'close' });
assert(state.isSidebarOpen === false, 'close event closes sidebar');
console.log('✓ close event closes sidebar');

// Event: selectDestination with CLOSE_SIDEBAR_ON_SELECT = true closes sidebar
assert(CLOSE_SIDEBAR_ON_SELECT === true, 'CLOSE_SIDEBAR_ON_SELECT is true');
state = { isDesktop: true, isSidebarOpen: true, isBlocked: false };
state = navChromeReducer(state, { type: 'selectDestination' });
assert(state.isSidebarOpen === false, 'selectDestination closes sidebar');
console.log('✓ selectDestination closes sidebar');

// Event: routeChange closes sidebar
state = { isDesktop: true, isSidebarOpen: true, isBlocked: false };
state = navChromeReducer(state, { type: 'routeChange' });
assert(state.isSidebarOpen === false, 'routeChange closes sidebar');
console.log('✓ routeChange closes sidebar');

// Event: resizeToMobile closes desktop sidebar and sets isDesktop false
state = { isDesktop: true, isSidebarOpen: true, isBlocked: false };
state = navChromeReducer(state, { type: 'resizeToMobile' });
assert(state.isDesktop === false && state.isSidebarOpen === false, 'resizeToMobile resets sidebar and desktop flag');
console.log('✓ resizeToMobile closes desktop sidebar and resets isDesktop');

// Event: resizeToDesktop sets isDesktop true, but NEVER re-opens sidebar automatically
state = navChromeReducer(state, { type: 'resizeToDesktop' });
assert(state.isDesktop === true && state.isSidebarOpen === false, 'resizeToDesktop does not auto-open sidebar');
console.log('✓ resizeToDesktop sets isDesktop true and keeps sidebar closed');

// Event: signOut sets blocked true and closes sidebar
state = { isDesktop: true, isSidebarOpen: true, isBlocked: false };
state = navChromeReducer(state, { type: 'signOut' });
assert(state.isBlocked === true && state.isSidebarOpen === false, 'signOut sets blocked and closes sidebar');
console.log('✓ signOut sets blocked and closes sidebar');

console.log('========================================');
console.log('🎉 ALL NAV CHROME TESTS PASSED CLEANLY');
console.log('========================================');
