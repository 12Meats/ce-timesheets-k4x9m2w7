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
  'screen-week':    { title: 'Week',    back: 'screen-worker',  render: () => renderWeek() },
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
// Task 6: promptTime — reusable full-screen keypad time-entry panel
// ---------------------------------------------------------------------------

// opts: { title, current, allowClear = true, onDone }.
// current is minutes-since-midnight or null. onDone(minutes) fires on Done
// with the parsed minutes, or on Clear with null (only when allowClear);
// it is never called on Cancel. The panel always starts with an EMPTY digit
// buffer even when `current` is set — retyping is faster than editing — but
// shows the old value as "was 6:30 AM" so the prior entry isn't a mystery.
function promptTime(opts) {
  const onDone = opts.onDone;
  const current = opts.current;
  const allowClear = opts.allowClear !== false;

  let digits = '';
  let meridiem = null;        // 'AM' | 'PM' | null (no selection yet)
  let meridiemLocked = false; // true once the user explicitly taps AM/PM; stops auto-preselect

  const overlay = document.createElement('div');
  overlay.className = 'time-panel-overlay';

  const titleEl = document.createElement('h2');
  titleEl.className = 'time-panel-title';
  titleEl.textContent = opts.title;

  const wasEl = document.createElement('p');
  wasEl.className = 'time-panel-was';
  wasEl.textContent = current != null ? ('was ' + PayMath.formatTime(current)) : 'was not set';

  const previewEl = document.createElement('div');
  previewEl.className = 'time-panel-preview';

  const digitsEl = document.createElement('div');
  digitsEl.className = 'time-panel-digits';

  const keypad = document.createElement('div');
  keypad.className = 'keypad time-panel-keypad';
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', null, '0', 'back'].forEach((k) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (k === null) {
      btn.className = 'key key-blank';
      btn.tabIndex = -1;
      btn.setAttribute('aria-hidden', 'true');
      btn.disabled = true;
    } else if (k === 'back') {
      btn.className = 'key key-back';
      btn.setAttribute('aria-label', 'Backspace');
      btn.textContent = '⌫';
      btn.addEventListener('click', () => {
        digits = digits.slice(0, -1);
        recomputeMeridiem();
        renderPreview();
      });
    } else {
      btn.className = 'key';
      btn.textContent = k;
      btn.addEventListener('click', () => {
        if (digits.length >= 4) return;
        digits += k;
        recomputeMeridiem();
        renderPreview();
      });
    }
    keypad.appendChild(btn);
  });

  const meridiemWrap = document.createElement('div');
  meridiemWrap.className = 'time-panel-meridiem';
  const amBtn = document.createElement('button');
  amBtn.type = 'button';
  amBtn.className = 'meridiem-btn';
  amBtn.textContent = 'AM';
  const pmBtn = document.createElement('button');
  pmBtn.type = 'button';
  pmBtn.className = 'meridiem-btn';
  pmBtn.textContent = 'PM';
  amBtn.addEventListener('click', () => {
    meridiem = 'AM';
    meridiemLocked = true;
    renderPreview();
  });
  pmBtn.addEventListener('click', () => {
    meridiem = 'PM';
    meridiemLocked = true;
    renderPreview();
  });
  meridiemWrap.appendChild(amBtn);
  meridiemWrap.appendChild(pmBtn);

  const actions = document.createElement('div');
  actions.className = 'time-panel-actions';
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn btn-confirm';
  doneBtn.textContent = 'Done';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'btn';
  clearBtn.textContent = 'Clear';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn';
  cancelBtn.textContent = 'Cancel';
  actions.appendChild(doneBtn);
  if (allowClear) actions.appendChild(clearBtn);
  actions.appendChild(cancelBtn);

  overlay.appendChild(titleEl);
  overlay.appendChild(wasEl);
  overlay.appendChild(previewEl);
  overlay.appendChild(digitsEl);
  overlay.appendChild(keypad);
  overlay.appendChild(meridiemWrap);
  overlay.appendChild(actions);
  document.body.appendChild(overlay);

  // Hour derived the same way PayMath.parseTimeDigits derives it, used only
  // to pick a smart default meridiem while digits are still coming in.
  function typedHour() {
    if (digits === '') return null;
    return digits.length <= 2 ? parseInt(digits, 10) : parseInt(digits.slice(0, -2), 10);
  }

  // Paper sheets say "6:30" meaning AM and "3:00" meaning PM — hours 5-11
  // preselect AM, hours 12 and 1-4 preselect PM, so dad doesn't have to tap
  // AM/PM for the obvious cases. Recomputed on every digit change unless the
  // user has explicitly tapped AM/PM (meridiemLocked).
  function recomputeMeridiem() {
    if (meridiemLocked) return;
    const h = typedHour();
    if (h === null) { meridiem = null; return; }
    if (h >= 5 && h <= 11) meridiem = 'AM';
    else if (h === 12 || (h >= 1 && h <= 4)) meridiem = 'PM';
    else meridiem = null;
  }

  // If digits form a valid 24h time (e.g. "1400") and no meridiem is
  // selected, parseTimeDigits(digits, null) reads it as 24h entry.
  function computeParsed() {
    if (digits === '') return null;
    return PayMath.parseTimeDigits(digits, meridiem);
  }

  function renderPreview() {
    digitsEl.textContent = digits;
    amBtn.classList.toggle('selected', meridiem === 'AM');
    pmBtn.classList.toggle('selected', meridiem === 'PM');
    const parsed = computeParsed();
    previewEl.textContent = parsed != null ? PayMath.formatTime(parsed) : '—';
  }

  function shakePreview() {
    previewEl.classList.remove('shake');
    void previewEl.offsetWidth; // force reflow so the animation restarts if triggered twice in a row
    previewEl.classList.add('shake');
    previewEl.addEventListener('animationend', () => previewEl.classList.remove('shake'), { once: true });
  }

  function close() {
    overlay.remove();
  }

  doneBtn.addEventListener('click', () => {
    const parsed = computeParsed();
    if (parsed === null) {
      shakePreview();
      return;
    }
    close();
    onDone(parsed);
  });
  clearBtn.addEventListener('click', () => {
    close();
    onDone(null);
  });
  cancelBtn.addEventListener('click', close);

  renderPreview();
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
  const end = new Date(Store.weekDates(mondayIso)[6] + 'T12:00:00');
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
      total.textContent = PayMath.toDecimal(Store.weekMinutes(state.data, worker.id, mondayIso)).toFixed(2) + ' hrs';

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

// Uses the Task 6 promptTime() keypad panel — this function was kept small
// and swappable from Task 5 specifically for this replacement.
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
  editBtn.addEventListener('click', () => {
    promptTime({
      title: 'Usual start time',
      current: worker.usualStart,
      allowClear: true,
      onDone: (minutes) => {
        worker.usualStart = minutes; // null means cleared
        Store.save(state.data);
        value.textContent = minutes != null ? PayMath.formatTime(minutes) : 'Not set';
      },
    });
  });
  display.appendChild(value);
  display.appendChild(editBtn);
  row.appendChild(display);

  return row;
}

// ---------------------------------------------------------------------------
// Task 6: Week entry (screen-week)
// ---------------------------------------------------------------------------

const DAY_NAMES_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_NAMES_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function addDaysIso(iso, delta) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatShortDate(iso) {
  const d = new Date(iso + 'T12:00:00');
  return (d.getMonth() + 1) + '/' + d.getDate();
}

// In-memory per-day draft for the week currently on screen, keyed by ISO
// date: { start: minutes|null, end: minutes|null }. Lives outside the
// storage contract deliberately — an invalid/incomplete pair (e.g. end <=
// start) must stay visible with its "end before start" note even though it
// is never written to state.data.entries. Rebuilt only when the worker or
// week being viewed changes (see weekDraftKey below), so edits survive
// re-renders triggered by promptTime while browsing the same week.
let weekDraft = null;
let weekDraftKey = null;

function buildWeekDraft(worker, mondayIso) {
  const stored = state.data.entries[worker.id] || {};
  const draft = {};
  Store.weekDates(mondayIso).forEach((date) => {
    const e = stored[date];
    draft[date] = { start: e ? e.start : null, end: e ? e.end : null };
  });
  return draft;
}

// STORAGE CONTRACT: only complete valid pairs (both set, end > start) are
// ever written; anything else (missing side, or end <= start) means the
// date key is deleted entirely — absent = no work, never a half/wrong entry.
function commitDay(worker, date) {
  const entry = weekDraft[date];
  const valid = entry.start != null && entry.end != null && entry.end > entry.start;
  if (valid) {
    if (!state.data.entries[worker.id]) state.data.entries[worker.id] = {};
    state.data.entries[worker.id][date] = { start: entry.start, end: entry.end };
  } else if (state.data.entries[worker.id]) {
    delete state.data.entries[worker.id][date];
  }
  Store.save(state.data);
}

function renderWeek() {
  const worker = getCurrentWorker();
  const container = document.getElementById('weekContent');
  container.textContent = '';

  if (!worker) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'Worker not found.';
    container.appendChild(p);
    return;
  }

  const mondayIso = state.currentMonday;
  const key = worker.id + '|' + mondayIso;
  if (key !== weekDraftKey) {
    weekDraft = buildWeekDraft(worker, mondayIso);
    weekDraftKey = key;
  }

  // ---- Top: worker name, week range, prev/next ----
  const nav = document.createElement('div');
  nav.className = 'week-nav';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'week-nav-btn';
  prevBtn.textContent = '◀';
  prevBtn.setAttribute('aria-label', 'Previous week');
  prevBtn.addEventListener('click', () => {
    state.currentMonday = addDaysIso(state.currentMonday, -7);
    renderWeek();
  });

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'week-nav-btn';
  nextBtn.textContent = '▶';
  nextBtn.setAttribute('aria-label', 'Next week');
  nextBtn.addEventListener('click', () => {
    state.currentMonday = addDaysIso(state.currentMonday, 7);
    renderWeek();
  });

  const navLabel = document.createElement('div');
  navLabel.className = 'week-nav-label';
  const nameEl = document.createElement('div');
  nameEl.className = 'week-worker-name';
  nameEl.textContent = worker.name;
  const rangeEl = document.createElement('div');
  rangeEl.className = 'week-range';
  rangeEl.textContent = formatWeekRange(mondayIso);
  navLabel.appendChild(nameEl);
  navLabel.appendChild(rangeEl);

  nav.appendChild(prevBtn);
  nav.appendChild(navLabel);
  nav.appendChild(nextBtn);
  container.appendChild(nav);

  // ---- One row per day, Mon..Sun ----
  Store.weekDates(mondayIso).forEach((date, i) => {
    container.appendChild(buildWeekDayRow(worker, date, DAY_NAMES_SHORT[i], DAY_NAMES_FULL[i]));
  });

  // ---- Footer: weekly total, split into regular/overtime past 40h ----
  const footer = document.createElement('div');
  footer.className = 'week-footer';
  const footerLabel = document.createElement('div');
  footerLabel.className = 'week-footer-label';
  footerLabel.textContent = 'Weekly total';
  const footerTotal = document.createElement('div');
  footerTotal.className = 'week-footer-total';

  const totalMin = Store.weekMinutes(state.data, worker.id, mondayIso);
  if (totalMin > 2400) {
    const split = PayMath.splitOvertime(totalMin);
    footerTotal.textContent = PayMath.toDecimal(split.regMin).toFixed(2) + ' regular + ' +
      PayMath.toDecimal(split.otMin).toFixed(2) + ' overtime';
  } else {
    footerTotal.textContent = PayMath.toDecimal(totalMin).toFixed(2) + ' hours';
  }

  footer.appendChild(footerLabel);
  footer.appendChild(footerTotal);
  container.appendChild(footer);
}

function buildWeekDayRow(worker, date, shortName, fullName) {
  const row = document.createElement('div');
  row.className = 'week-day-row';

  const top = document.createElement('div');
  top.className = 'week-day-top';

  const label = document.createElement('span');
  label.className = 'week-day-label';
  label.textContent = shortName + ' ' + formatShortDate(date);

  const entry = weekDraft[date];

  const times = document.createElement('div');
  times.className = 'week-day-times';

  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'btn week-time-btn';
  startBtn.textContent = entry.start != null ? PayMath.formatTime(entry.start) : '—';
  startBtn.addEventListener('click', () => {
    promptTime({
      title: fullName + ' start',
      current: entry.start,
      allowClear: true,
      onDone: (minutes) => {
        entry.start = minutes;
        commitDay(worker, date);
        renderWeek();
      },
    });
  });

  const endBtn = document.createElement('button');
  endBtn.type = 'button';
  endBtn.className = 'btn week-time-btn';
  endBtn.textContent = entry.end != null ? PayMath.formatTime(entry.end) : '—';
  endBtn.addEventListener('click', () => {
    promptTime({
      title: fullName + ' end',
      current: entry.end,
      allowClear: true,
      onDone: (minutes) => {
        entry.end = minutes;
        commitDay(worker, date);
        renderWeek();
      },
    });
  });

  times.appendChild(startBtn);
  times.appendChild(endBtn);

  const hours = document.createElement('span');
  hours.className = 'week-day-hours';
  const worked = PayMath.workedMinutes(entry.start, entry.end);
  hours.textContent = worked != null ? PayMath.toDecimal(worked).toFixed(2) : '—';

  top.appendChild(label);
  top.appendChild(times);
  top.appendChild(hours);
  row.appendChild(top);

  if (entry.start != null && entry.end != null && entry.end <= entry.start) {
    const note = document.createElement('p');
    note.className = 'week-day-note';
    note.textContent = 'End before start — not saved.';
    row.appendChild(note);
  }

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
