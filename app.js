// app.js — app shell, navigation, and PIN screen.
// Depends on globals PayMath (paymath.js) and Store (storage.js), loaded before this file.

const state = { data: null, currentWorkerId: null, currentMonday: null };

const SCREEN_IDS = ['screen-pin', 'screen-workers', 'screen-worker', 'screen-week', 'screen-payday'];

const SCREEN_TITLES = {
  'screen-workers': 'Workers',
  'screen-worker': 'Worker',
  'screen-week': 'Week',
  'screen-payday': 'Payday',
};

// Where the back button sends you from each screen. Screens not listed here
// (screen-workers, screen-pin) never show a back button.
const BACK_TARGETS = {
  'screen-worker': 'screen-workers',
  'screen-week': 'screen-worker',
  'screen-payday': 'screen-workers',
};

let currentScreen = null;

function show(screenId) {
  SCREEN_IDS.forEach((id) => {
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
  titleEl.textContent = SCREEN_TITLES[screenId] || '';
  const backTarget = BACK_TARGETS[screenId];
  backBtn.hidden = !backTarget;
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
}

function resetPinEntry(mode) {
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
  show('screen-workers');
  renderWorkers();
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
      setPinMessage('Enter PIN');
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

function renderWorkers() {
  // Task 5 fills this in: render the worker list on screen-workers.
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  state.data = Store.load();
  initPinScreen();
  show('screen-pin');

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
    const target = BACK_TARGETS[currentScreen];
    if (target) show(target);
  });
});
