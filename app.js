// app.js — app shell, navigation, and PIN screen.
// Depends on globals PayMath (paymath.js) and Store (storage.js), loaded before this file.

const state = { data: null, currentWorkerId: null, currentMonday: null };

// Single source of truth for every screen: its top-bar title, where its back
// button goes (null = no back button), and the render function to call after
// navigating there (null = nothing to render, e.g. static/PIN screens).
// Later tasks: register your screen's render fn in SCREENS and always
// navigate via navigateTo() so destinations always re-render.
const SCREENS = {
  'screen-pin':     { title: '',        back: null,             render: null },
  'screen-workers': { title: 'Workers', back: null,             render: () => renderWorkers() },
  'screen-worker':  { title: 'Worker',  back: 'screen-workers', render: null }, // Task 5/6 sets render
  'screen-week':    { title: 'Week',    back: 'screen-worker',  render: null }, // Task 7 sets render; back may be set dynamically later
  'screen-payday':  { title: 'Payday',  back: 'screen-workers', render: null }, // Task 8 sets render
};

let currentScreen = null;

// Pure visibility/top-bar work — toggles which section is shown and updates
// the top bar's title/back button from SCREENS. Does not render content;
// use navigateTo() for that.
function show(screenId) {
  Object.keys(SCREENS).forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = id !== screenId;
  });
  currentScreen = screenId;

  const topbar = document.getElementById('topbar');
  const backBtn = document.getElementById('backBtn');
  const titleEl = document.getElementById('topbarTitle');

  if (screenId === 'screen-pin') {
    topbar.hidden = true;
    return;
  }

  topbar.hidden = false;
  const config = SCREENS[screenId] || {};
  titleEl.textContent = config.title || '';
  backBtn.hidden = !config.back;
}

// Navigate to a screen and run its render function, if any. Every navigation
// in the app (back button, proceeding past the PIN screen, and all
// screen-to-screen jumps in later tasks) should go through this rather than
// calling show() directly, so the destination's content is always fresh.
function navigateTo(screenId) {
  show(screenId);
  const render = SCREENS[screenId] && SCREENS[screenId].render;
  if (render) render();
}

// ---------------------------------------------------------------------------
// PIN screen
// ---------------------------------------------------------------------------

// pinMode: 'choose' (first-run, entering a new PIN) | 'confirm' (first-run,
// re-entering to confirm) | 'enter' (returning user unlocking).
let pinMode = 'enter';
let pinBuffer = [];
let firstPinDigits = null;
let pinBusy = false; // true while a mismatch/error message is being shown

function pinDotsEl() { return document.getElementById('pinDots'); }
function pinMessageEl() { return document.getElementById('pinMessage'); }

function updateDots() {
  const dots = pinDotsEl().querySelectorAll('.dot');
  dots.forEach((dot, i) => dot.classList.toggle('filled', i < pinBuffer.length));
}

function setPinMessage(text) {
  pinMessageEl().textContent = text;
}

function shakeDots() {
  const dotsEl = pinDotsEl();
  dotsEl.classList.remove('shake');
  void dotsEl.offsetWidth; // force reflow so the animation restarts if triggered twice in a row
  dotsEl.classList.add('shake');
  // Belt-and-braces: also drop the class as soon as the animation finishes,
  // in case resetPinEntry() doesn't run first (e.g. future callers of shakeDots()).
  dotsEl.addEventListener('animationend', () => dotsEl.classList.remove('shake'), { once: true });
}

function resetPinEntry(mode) {
  pinDotsEl().classList.remove('shake'); // dots must return to their normal color on the next entry
  pinBuffer = [];
  updateDots();
  pinMode = mode;
  if (mode === 'choose') setPinMessage('Choose a 4-digit PIN');
  else if (mode === 'confirm') setPinMessage('Confirm PIN');
  else setPinMessage('Enter PIN');
}

function initPinScreen() {
  firstPinDigits = null;
  pinBusy = false;
  resetPinEntry(state.data.pin === null ? 'choose' : 'enter');
}

function proceedFromPin() {
  navigateTo('screen-workers');
}

function handlePinComplete() {
  const entered = pinBuffer.join('');

  if (pinMode === 'choose') {
    firstPinDigits = entered;
    resetPinEntry('confirm');
    return;
  }

  if (pinMode === 'confirm') {
    if (entered === firstPinDigits) {
      state.data.pin = entered;
      Store.save(state.data);
      proceedFromPin();
    } else {
      pinBusy = true;
      pinBuffer = [];
      updateDots();
      shakeDots();
      setPinMessage("PINs didn't match — start over");
      setTimeout(() => {
        firstPinDigits = null;
        pinBusy = false;
        resetPinEntry('choose');
      }, 1400);
    }
    return;
  }

  // pinMode === 'enter'
  if (entered === state.data.pin) {
    proceedFromPin();
  } else {
    pinBusy = true;
    pinBuffer = [];
    updateDots();
    shakeDots();
    setPinMessage('Wrong PIN — try again');
    setTimeout(() => {
      pinBusy = false;
      resetPinEntry('enter'); // also clears the shake class, independent of animationend
    }, 1200);
  }
}

function handleDigit(digit) {
  if (pinBusy || pinBuffer.length >= 4) return;
  pinBuffer.push(digit);
  updateDots();
  if (pinBuffer.length === 4) handlePinComplete();
}

function handleBackspace() {
  if (pinBusy) return;
  pinBuffer.pop();
  updateDots();
}

// ---------------------------------------------------------------------------
// Screen stubs for later tasks
// ---------------------------------------------------------------------------

// RULE for all render fns: build DOM via createElement/textContent. NEVER
// innerHTML with interpolated user data (worker names are free text).
function renderWorkers() {
  // Task 5 fills this in: render the worker list on screen-workers.
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  state.data = Store.load();
  initPinScreen();
  navigateTo('screen-pin');

  document.querySelector('.keypad').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    if (btn.id === 'backspaceBtn') {
      handleBackspace();
    } else if (btn.dataset.digit !== undefined) {
      handleDigit(btn.dataset.digit);
    }
  });

  document.getElementById('backBtn').addEventListener('click', () => {
    const config = SCREENS[currentScreen];
    if (config && config.back) navigateTo(config.back);
  });
});
