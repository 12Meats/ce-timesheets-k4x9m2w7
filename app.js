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
  'screen-worker':  { title: 'Worker',  back: 'screen-workers', render: () => renderWorker() },
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
// Shared helpers (Task 5+)
// ---------------------------------------------------------------------------

// Local calendar date as YYYY-MM-DD. Deliberately NOT new Date().toISOString()
// (that's UTC and reads as tomorrow's date in the evening in Arizona).
function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getCurrentWorker() {
  return state.data.workers.find((w) => w.id === state.currentWorkerId) || null;
}

function formatWeekRange(mondayIso) {
  const start = new Date(mondayIso + 'T12:00:00');
  const end = new Date(mondayIso + 'T12:00:00');
  end.setDate(end.getDate() + 6);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return fmt(start) + ' – ' + fmt(end);
}

// Every Monday that has at least one entry for this worker, most recent
// first, capped at 26 weeks. Entries are only ever written when valid
// (storage contract), so any entry present already means minutes > 0.
function getWorkerHistoryMondays(workerId) {
  const days = state.data.entries[workerId] || {};
  const mondays = new Set();
  for (const date of Object.keys(days)) {
    mondays.add(Store.mondayOf(date));
  }
  return Array.from(mondays).sort().reverse().slice(0, 26);
}

// ---------------------------------------------------------------------------
// Task 5: Workers list (screen-workers)
// ---------------------------------------------------------------------------

// RULE for all render fns: build DOM via createElement/textContent. NEVER
// innerHTML with interpolated user data (worker names are free text).
function renderWorkers() {
  const listEl = document.getElementById('workersList');
  listEl.textContent = '';

  const workers = state.data.workers;
  if (workers.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No workers yet — tap Add worker to start.';
    listEl.appendChild(p);
  } else {
    const monday = Store.mondayOf(todayIso());
    workers.forEach((w) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'worker-card';

      const name = document.createElement('div');
      name.className = 'worker-card-name';
      name.textContent = w.name;

      const hours = document.createElement('div');
      hours.className = 'worker-card-hours';
      const mins = Store.weekMinutes(state.data, w.id, monday);
      hours.textContent = PayMath.toDecimal(mins).toFixed(2) + ' hrs this week';

      card.appendChild(name);
      card.appendChild(hours);
      card.addEventListener('click', () => {
        state.currentWorkerId = w.id;
        navigateTo('screen-worker');
      });
      listEl.appendChild(card);
    });
  }

  // Any open add-worker form belongs to the previous render; drop it.
  document.getElementById('addWorkerArea').textContent = '';
}

function showAddWorkerForm() {
  const area = document.getElementById('addWorkerArea');
  if (area.childNodes.length > 0) {
    area.textContent = ''; // toggle closed if already open
    return;
  }

  const form = document.createElement('div');
  form.className = 'add-worker-form';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = 'Worker name';
  label.setAttribute('for', 'newWorkerNameInput');

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'newWorkerNameInput';
  input.autocapitalize = 'words';
  input.placeholder = 'e.g. Jose M';

  const actions = document.createElement('div');
  actions.className = 'add-worker-actions';
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'btn btn-confirm';
  confirmBtn.textContent = 'Add';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  actions.appendChild(confirmBtn);
  actions.appendChild(cancelBtn);

  form.appendChild(label);
  form.appendChild(input);
  form.appendChild(actions);
  area.appendChild(form);
  input.focus();

  function addWorker() {
    const name = input.value.trim();
    if (!name) {
      input.classList.add('field-invalid');
      return;
    }
    state.data.workers.push({ id: genId(), name, rate: null, usualStart: null });
    Store.save(state.data);
    renderWorkers();
  }

  confirmBtn.addEventListener('click', addWorker);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addWorker(); }
  });
  cancelBtn.addEventListener('click', () => { area.textContent = ''; });
}

// ---------------------------------------------------------------------------
// Task 5: Worker file (screen-worker)
// ---------------------------------------------------------------------------

function renderWorker() {
  const worker = getCurrentWorker();
  const fieldsEl = document.getElementById('workerFields');
  const historyEl = document.getElementById('workerHistory');
  fieldsEl.textContent = '';
  historyEl.textContent = '';

  if (!worker) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'Worker not found.';
    fieldsEl.appendChild(p);
    return;
  }

  fieldsEl.appendChild(buildNameField(worker));
  fieldsEl.appendChild(buildRateField(worker));
  fieldsEl.appendChild(buildUsualStartField(worker));

  const weeks = getWorkerHistoryMondays(worker.id);
  if (weeks.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No hours entered yet.';
    historyEl.appendChild(p);
  } else {
    weeks.forEach((mondayIso) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'history-row';

      const label = document.createElement('span');
      label.className = 'history-week';
      label.textContent = formatWeekRange(mondayIso);

      const total = document.createElement('span');
      total.className = 'history-hours';
      total.textContent = PayMath.toDecimal(Store.weekMinutes(state.data, worker.id, mondayIso)).toFixed(2);

      row.appendChild(label);
      row.appendChild(total);
      row.addEventListener('click', () => {
        state.currentMonday = mondayIso;
        navigateTo('screen-week');
      });
      historyEl.appendChild(row);
    });
  }
}

function buildNameField(worker) {
  const row = document.createElement('div');
  row.className = 'field-row';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = 'Name';
  label.setAttribute('for', 'workerNameInput');

  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'workerNameInput';
  input.autocapitalize = 'words';
  input.value = worker.name;
  input.addEventListener('change', () => {
    const trimmed = input.value.trim();
    if (trimmed) {
      worker.name = trimmed;
      input.value = trimmed;
      Store.save(state.data);
    } else {
      input.value = worker.name; // reject blank, revert display
    }
  });

  row.appendChild(label);
  row.appendChild(input);
  return row;
}

function buildRateField(worker) {
  const row = document.createElement('div');
  row.className = 'field-row';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.textContent = 'Hourly rate';
  label.setAttribute('for', 'workerRateInput');

  const wrap = document.createElement('div');
  wrap.className = 'rate-input-wrap';
  const prefix = document.createElement('span');
  prefix.className = 'rate-prefix';
  prefix.textContent = '$';

  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'decimal';
  input.id = 'workerRateInput';
  input.value = worker.rate != null ? String(worker.rate) : '';

  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = 'Enter a valid rate (0 or more).';

  input.addEventListener('change', () => {
    const raw = input.value.trim();
    if (raw === '') {
      worker.rate = null;
      input.classList.remove('field-invalid');
      hint.classList.remove('show');
      Store.save(state.data);
      return;
    }
    const isPlainNumber = /^\d*\.?\d*$/.test(raw) && raw !== '.';
    const parsed = parseFloat(raw);
    if (!isPlainNumber || !isFinite(parsed) || parsed < 0) {
      worker.rate = null;
      input.classList.add('field-invalid');
      hint.classList.add('show');
      Store.save(state.data);
      return;
    }
    worker.rate = Math.round(parsed * 100) / 100;
    input.value = String(worker.rate);
    input.classList.remove('field-invalid');
    hint.classList.remove('show');
    Store.save(state.data);
  });

  wrap.appendChild(prefix);
  wrap.appendChild(input);
  row.appendChild(label);
  row.appendChild(wrap);
  row.appendChild(hint);
  return row;
}

// Minimal inline time entry, contained in one function so Task 6's reusable
// keypad panel can swap it out without touching the rest of renderWorker().
function buildUsualStartField(worker) {
  const row = document.createElement('div');
  row.className = 'field-row';

  const label = document.createElement('span');
  label.className = 'field-label';
  label.textContent = 'Usual start time';
  row.appendChild(label);

  const display = document.createElement('div');
  display.className = 'start-time-row';
  const value = document.createElement('span');
  value.className = 'start-time-value';
  value.textContent = worker.usualStart != null ? PayMath.formatTime(worker.usualStart) : 'Not set';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'btn';
  editBtn.textContent = 'Edit';
  display.appendChild(value);
  display.appendChild(editBtn);
  row.appendChild(display);

  const editArea = document.createElement('div');
  editArea.className = 'start-time-edit';
  editArea.hidden = true;

  const digitsInput = document.createElement('input');
  digitsInput.type = 'text';
  digitsInput.inputMode = 'numeric';
  digitsInput.placeholder = 'e.g. 630 for 6:30';

  const meridiemWrap = document.createElement('div');
  meridiemWrap.className = 'meridiem-toggle';
  const amBtn = document.createElement('button');
  amBtn.type = 'button';
  amBtn.className = 'meridiem-btn selected';
  amBtn.textContent = 'AM';
  const pmBtn = document.createElement('button');
  pmBtn.type = 'button';
  pmBtn.className = 'meridiem-btn';
  pmBtn.textContent = 'PM';
  let meridiem = 'AM';
  amBtn.addEventListener('click', () => {
    meridiem = 'AM';
    amBtn.classList.add('selected');
    pmBtn.classList.remove('selected');
  });
  pmBtn.addEventListener('click', () => {
    meridiem = 'PM';
    pmBtn.classList.add('selected');
    amBtn.classList.remove('selected');
  });
  meridiemWrap.appendChild(amBtn);
  meridiemWrap.appendChild(pmBtn);

  const hint = document.createElement('p');
  hint.className = 'field-hint';
  hint.textContent = 'Enter a valid time, e.g. 630 for 6:30.';

  const actions = document.createElement('div');
  actions.className = 'start-time-actions';
  const setBtn = document.createElement('button');
  setBtn.type = 'button';
  setBtn.className = 'btn btn-confirm';
  setBtn.textContent = 'Set';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn';
  clearBtn.textContent = 'Clear';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  actions.appendChild(setBtn);
  actions.appendChild(clearBtn);
  actions.appendChild(cancelBtn);

  editArea.appendChild(digitsInput);
  editArea.appendChild(meridiemWrap);
  editArea.appendChild(hint);
  editArea.appendChild(actions);
  row.appendChild(editArea);

  editBtn.addEventListener('click', () => {
    editArea.hidden = !editArea.hidden;
    if (!editArea.hidden) {
      digitsInput.value = '';
      digitsInput.classList.remove('field-invalid');
      hint.classList.remove('show');
      meridiem = 'AM';
      amBtn.classList.add('selected');
      pmBtn.classList.remove('selected');
      digitsInput.focus();
    }
  });
  cancelBtn.addEventListener('click', () => { editArea.hidden = true; });
  setBtn.addEventListener('click', () => {
    const parsed = PayMath.parseTimeDigits(digitsInput.value.trim(), meridiem);
    if (parsed === null) {
      digitsInput.classList.add('field-invalid');
      hint.classList.add('show');
      setTimeout(() => {
        digitsInput.classList.remove('field-invalid');
        hint.classList.remove('show');
      }, 1200);
      return;
    }
    worker.usualStart = parsed;
    Store.save(state.data);
    value.textContent = PayMath.formatTime(parsed);
    editArea.hidden = true;
  });
  clearBtn.addEventListener('click', () => {
    worker.usualStart = null;
    Store.save(state.data);
    value.textContent = 'Not set';
    editArea.hidden = true;
  });

  return row;
}

function deleteCurrentWorker() {
  const worker = getCurrentWorker();
  if (!worker) return;
  if (!confirm(`Delete ${worker.name}? This removes all their hours too.`)) return;
  state.data.workers = state.data.workers.filter((w) => w.id !== worker.id);
  delete state.data.entries[worker.id];
  state.currentWorkerId = null;
  Store.save(state.data);
  navigateTo('screen-workers');
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

  // screen-workers static controls
  document.getElementById('addWorkerBtn').addEventListener('click', showAddWorkerForm);
  document.getElementById('paydaySummaryBtn').addEventListener('click', () => navigateTo('screen-payday'));
  document.getElementById('settingsBtn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.busy) return;
    btn.dataset.busy = '1';
    const original = btn.textContent;
    btn.textContent = 'Settings — coming soon';
    setTimeout(() => { btn.textContent = original; delete btn.dataset.busy; }, 1500);
  });

  // screen-worker static controls
  document.getElementById('enterHoursBtn').addEventListener('click', () => {
    state.currentMonday = Store.mondayOf(todayIso());
    navigateTo('screen-week');
  });
  document.getElementById('deleteWorkerBtn').addEventListener('click', deleteCurrentWorker);
});
