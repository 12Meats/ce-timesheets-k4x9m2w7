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
  'screen-payday':  { title: 'Payday',  back: 'screen-workers', render: () => renderPayday() },
  'screen-settings': { title: 'Settings', back: 'screen-workers', render: () => renderSettings() },
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

  // Screens toggle via [hidden] rather than a real navigation, so the
  // document scroll position from whatever screen was showing before
  // carries over otherwise — e.g. scrolling down a long worker history then
  // tapping "Enter hours" would land on the week screen already scrolled
  // past its own header. Every screen should start at the top.
  window.scrollTo(0, 0);

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

// Guards against a second panel opening on top of the first from a fast
// double-tap. WebKit's hit-test/click timing on iOS Safari can let a second
// tap land before the first panel's overlay has fully blocked the tap
// target, so this checks a flag rather than relying on that timing.
let timePanelOpen = false;

// opts: { title, current, allowClear = true, onDone }.
// current is minutes-since-midnight or null. onDone(minutes) fires on Done
// with the parsed minutes, or on Clear with null (only when allowClear);
// it is never called on Cancel. The panel always starts with an EMPTY digit
// buffer even when `current` is set — retyping is faster than editing — but
// shows the old value as "was 6:30 AM" so the prior entry isn't a mystery.
function promptTime(opts) {
  if (timePanelOpen) return;
  timePanelOpen = true;

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

  // Paper sheets say "6:30" meaning AM and "3:00" meaning PM — hours 5-11
  // preselect AM, hours 12 and 1-4 preselect PM, so dad doesn't have to tap
  // AM/PM for the obvious cases. Recomputed on every digit change unless the
  // user has explicitly tapped AM/PM (meridiemLocked). Pure hour-guessing
  // logic lives in PayMath.guessMeridiem so it's testable outside the DOM.
  function recomputeMeridiem() {
    if (meridiemLocked) return;
    meridiem = PayMath.guessMeridiem(digits);
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
    timePanelOpen = false;
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

// ISO date string -> Date object anchored at noon local time, timezone-safe
// (dodges DST edges the way storage.js's own date math does). Every date
// formatter in this file (formatWeekRange, formatFlagDate, formatShortDate)
// and the backup-banner staleness check build on this shared construction
// rather than repeating `new Date(iso + 'T12:00:00')` themselves.
function isoNoon(iso) {
  return new Date(iso + 'T12:00:00');
}

function getCurrentWorker() {
  return state.data.workers.find((w) => w.id === state.currentWorkerId) || null;
}

function formatWeekRange(mondayIso) {
  const start = isoNoon(mondayIso);
  const end = isoNoon(Store.weekDates(mondayIso)[6]);
  const fmt = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return fmt(start) + ' – ' + fmt(end);
}

// Shared by renderWeek (Task 6) and renderPayday (Task 7): the ◀ label ▶
// header. mondayIso is the week currently shown; onNav(newMondayIso) fires
// when either arrow is tapped (caller updates state and re-renders). topLabel
// is an optional bold line above the date range (renderWeek passes the
// worker's name; renderPayday omits it since the screen spans all workers).
function buildWeekNavHeader(mondayIso, onNav, topLabel) {
  const nav = document.createElement('div');
  nav.className = 'week-nav';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'week-nav-btn';
  prevBtn.textContent = '◀';
  prevBtn.setAttribute('aria-label', 'Previous week');
  prevBtn.addEventListener('click', () => onNav(addDaysIso(mondayIso, -7)));

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'week-nav-btn';
  nextBtn.textContent = '▶';
  nextBtn.setAttribute('aria-label', 'Next week');
  nextBtn.addEventListener('click', () => onNav(addDaysIso(mondayIso, 7)));

  const navLabel = document.createElement('div');
  navLabel.className = 'week-nav-label';
  if (topLabel) {
    const nameEl = document.createElement('div');
    nameEl.className = 'week-worker-name';
    nameEl.textContent = topLabel;
    navLabel.appendChild(nameEl);
  }
  const rangeEl = document.createElement('div');
  rangeEl.className = 'week-range';
  rangeEl.textContent = formatWeekRange(mondayIso);
  navLabel.appendChild(rangeEl);

  nav.appendChild(prevBtn);
  nav.appendChild(navLabel);
  nav.appendChild(nextBtn);
  return nav;
}

// $1,168.64 — 2 decimals with thousands separators, for the payday screen's
// "est." line. The value passed in is already rounded to whole cents by
// PayMath.grossEstimate, so this only formats for display.
function formatMoney(n) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  renderBackupBanner();

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
  const extrasEl = document.getElementById('workerExtras');
  fieldsEl.textContent = '';
  historyEl.textContent = '';
  extrasEl.textContent = '';

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

  extrasEl.appendChild(buildAttendanceSection(worker));
  extrasEl.appendChild(buildHoursChart(worker));
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
// Task 8: Attendance flags + weekly hours chart (inside workerExtras)
// ---------------------------------------------------------------------------

const ATTENDANCE_WEEKS_BACK = 8;
const ATTENDANCE_GRACE_MIN = 15;
const ATTENDANCE_ROW_CAP = 10;

// "Tue Aug 11" — short weekday + short month + day, used only for flag rows
// (the week-history/nav "8/10" numeric style is formatShortDate, kept
// separate since it reads better in a dense list here).
function formatFlagDate(iso) {
  const d = isoNoon(iso);
  const dayIdx = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6, matches DAY_NAMES_SHORT
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return DAY_NAMES_SHORT[dayIdx] + ' ' + month + ' ' + d.getDate();
}

function buildFlagRow(item, worker) {
  const row = document.createElement('div');
  row.className = 'flag-row';
  const text = document.createElement('span');
  if (item.kind === 'late') {
    text.textContent = formatFlagDate(item.date) + ' — in at ' + PayMath.formatTime(item.start) +
      ' (usual ' + PayMath.formatTime(worker.usualStart) + ')';
  } else {
    text.textContent = formatFlagDate(item.date) + ' — no hours (others worked)';
  }
  row.appendChild(text);
  return row;
}

// Renders up to ATTENDANCE_ROW_CAP rows (already sorted newest-first by the
// caller) plus a "+N more" line when the list runs over the cap.
function buildFlagList(items, worker) {
  const list = document.createElement('div');
  list.className = 'flag-list';
  items.slice(0, ATTENDANCE_ROW_CAP).forEach((item) => list.appendChild(buildFlagRow(item, worker)));
  if (items.length > ATTENDANCE_ROW_CAP) {
    const more = document.createElement('p');
    more.className = 'flag-more';
    more.textContent = '+' + (items.length - ATTENDANCE_ROW_CAP) + ' more';
    list.appendChild(more);
  }
  return list;
}

// Amber "information, not alarm" flags for late starts and missed weekdays.
// Both derive from existing entries/worker data — nothing new is stored.
function buildAttendanceSection(worker) {
  const wrap = document.createElement('div');
  const today = todayIso();
  const missed = Store.missedDays(state.data, worker.id, today, ATTENDANCE_WEEKS_BACK);

  // No usual start time on file -> lateDays is meaningless, so show only a
  // missed-days section, and only when there's actually something to flag
  // (no heading/noise for a worker with a clean record).
  if (worker.usualStart == null) {
    if (missed.length === 0) return wrap;
    const heading = document.createElement('h3');
    heading.className = 'section-heading';
    heading.textContent = 'Missed days (last ' + ATTENDANCE_WEEKS_BACK + ' weeks)';
    wrap.appendChild(heading);
    const items = missed.slice().sort((a, b) => (a < b ? 1 : -1)).map((date) => ({ date, kind: 'missed' }));
    wrap.appendChild(buildFlagList(items, worker));
    return wrap;
  }

  const late = Store.lateDays(state.data, worker.id, worker.usualStart, today, ATTENDANCE_WEEKS_BACK, ATTENDANCE_GRACE_MIN);

  const heading = document.createElement('h3');
  heading.className = 'section-heading';
  heading.textContent = 'Attendance (last ' + ATTENDANCE_WEEKS_BACK + ' weeks)';
  wrap.appendChild(heading);

  if (late.length === 0 && missed.length === 0) {
    const ok = document.createElement('p');
    ok.className = 'attendance-ok';
    ok.textContent = 'No late or missed days in the last ' + ATTENDANCE_WEEKS_BACK + ' weeks.';
    wrap.appendChild(ok);
    return wrap;
  }

  const combined = late.map((l) => ({ date: l.date, kind: 'late', start: l.start }))
    .concat(missed.map((date) => ({ date, kind: 'missed' })))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  wrap.appendChild(buildFlagList(combined, worker));
  return wrap;
}

const HOURS_CHART_MAX_PX = 120;
const HOURS_CHART_MIN_SCALE_MIN = 2400; // 40h floor so a light stretch doesn't look dramatic
const HOURS_CHART_WEEKS = 8;

// Ascending Mondays, oldest to newest, ending with the Monday of refIso.
function lastNMondays(refIso, n) {
  const lastMonday = Store.mondayOf(refIso);
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDaysIso(lastMonday, -7 * i));
  return out;
}

// Pure HTML/CSS bar chart, no libraries: one column per week (oldest left),
// bar height proportional to paid hours scaled to the max week in range
// (floored at 40h so a quiet 8 weeks doesn't read as a huge swing), value
// label on top (hidden at 0), short Monday-date label beneath, and a dashed
// 40h reference line across the plot.
function buildHoursChart(worker) {
  const wrap = document.createElement('div');
  const heading = document.createElement('h3');
  heading.className = 'section-heading';
  heading.textContent = 'Hours per week';
  wrap.appendChild(heading);

  const mondays = lastNMondays(todayIso(), HOURS_CHART_WEEKS);
  const weekMins = mondays.map((m) => Store.weekMinutes(state.data, worker.id, m));

  if (weekMins.every((m) => m === 0)) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No hours recorded yet.';
    wrap.appendChild(p);
    return wrap;
  }

  const maxScale = Math.max(HOURS_CHART_MIN_SCALE_MIN, ...weekMins);

  const plot = document.createElement('div');
  plot.className = 'hours-chart-plot';

  const barsRow = document.createElement('div');
  barsRow.className = 'hours-chart-bars-row';

  const lineTop = HOURS_CHART_MAX_PX - (HOURS_CHART_MIN_SCALE_MIN / maxScale) * HOURS_CHART_MAX_PX;
  const line = document.createElement('div');
  line.className = 'hours-chart-40line';
  line.style.top = lineTop + 'px';
  barsRow.appendChild(line);

  const lineLabel = document.createElement('span');
  lineLabel.className = 'hours-chart-40label';
  lineLabel.textContent = '40';
  lineLabel.style.top = Math.max(0, lineTop - 7) + 'px';
  barsRow.appendChild(lineLabel);

  weekMins.forEach((mins) => {
    const col = document.createElement('div');
    col.className = 'hours-chart-col-bar';

    const valueEl = document.createElement('div');
    valueEl.className = 'hours-chart-value';
    valueEl.textContent = mins > 0 ? PayMath.toDecimal(mins).toFixed(1) : '';

    const bar = document.createElement('div');
    if (mins > 0) {
      bar.className = 'hours-chart-bar';
      bar.style.height = Math.max(2, (mins / maxScale) * HOURS_CHART_MAX_PX) + 'px';
    } else {
      bar.className = 'hours-chart-bar hours-chart-bar-zero';
      bar.style.height = '2px';
    }

    col.appendChild(valueEl);
    col.appendChild(bar);
    barsRow.appendChild(col);
  });

  plot.appendChild(barsRow);

  const labelsRow = document.createElement('div');
  labelsRow.className = 'hours-chart-labels-row';
  mondays.forEach((m) => {
    const lbl = document.createElement('span');
    lbl.className = 'hours-chart-col-label';
    lbl.textContent = formatShortDate(m);
    labelsRow.appendChild(lbl);
  });
  plot.appendChild(labelsRow);

  wrap.appendChild(plot);
  return wrap;
}

// ---------------------------------------------------------------------------
// Task 6: Week entry (screen-week)
// ---------------------------------------------------------------------------

const DAY_NAMES_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_NAMES_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function addDaysIso(iso, delta) {
  const d = isoNoon(iso);
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

function formatShortDate(iso) {
  const d = isoNoon(iso);
  return (d.getMonth() + 1) + '/' + d.getDate();
}

// In-memory per-day draft for the week currently on screen, keyed by ISO
// date: { start: minutes|null, end: minutes|null, lunch: minutes|undefined }.
// Lives outside the storage contract deliberately — an invalid/incomplete
// pair (e.g. end <= start) must stay visible with its "end before start"
// note even though it is never written to state.data.entries. Rebuilt only
// when the worker or week being viewed changes (see weekDraftKey below), so
// edits survive re-renders triggered by promptTime while browsing the same
// week.
//
// lunch handling: a day copied from an existing stored entry carries that
// entry's lunch value AS IS, including 0 or undefined (legacy entries
// written before this feature never had a lunch key — undefined means "no
// deduction", never guessed at). A day with no stored entry yet is preloaded
// with lunch: 30 so the first time it becomes a complete pair, it commits
// with the default 30-minute deduction already in place.
let weekDraft = null;
let weekDraftKey = null;

function buildWeekDraft(worker, mondayIso) {
  const stored = state.data.entries[worker.id] || {};
  const draft = {};
  Store.weekDates(mondayIso).forEach((date) => {
    const e = stored[date];
    draft[date] = { start: e ? e.start : null, end: e ? e.end : null, lunch: e ? e.lunch : 30 };
  });
  return draft;
}

// STORAGE CONTRACT: only complete valid pairs (both set, end > start) are
// ever written; anything else (missing side, or end <= start) means the
// date key is deleted entirely — absent = no work, never a half/wrong entry.
// The validity predicate itself lives in PayMath.isValidPair so both the UI
// and any future non-UI code (e.g. an import/export path) share one rule.
//
// lunch is written straight from the draft: for a brand-new complete entry
// the draft was preloaded with 30 (see buildWeekDraft), and for an existing
// entry whose times are being edited the draft's lunch was copied unchanged
// from storage, so it's preserved across the edit. The lunch chip's own
// handler flips entry.lunch before calling this, so that path writes the
// toggled value the same way. The one case that DOES need special-casing:
// when a day is deleted (its pair became invalid, e.g. a cleared end time),
// the draft's lunch is reset back to the 30-min default. Without that reset,
// a deleted-then-recompleted day would silently inherit whatever lunch value
// was sitting in the draft (possibly 0, from a toggle before the delete)
// instead of being treated as the brand-new entry it now is.
function commitDay(worker, date) {
  const entry = weekDraft[date];
  const valid = PayMath.isValidPair(entry.start, entry.end);
  const stored = state.data.entries[worker.id];
  const hadEntry = !!(stored && date in stored);
  if (!valid && !hadEntry) return; // nothing to persist and nothing to remove

  if (valid) {
    if (!stored) state.data.entries[worker.id] = {};
    state.data.entries[worker.id][date] = { start: entry.start, end: entry.end, lunch: entry.lunch };
  } else {
    delete stored[date];
    entry.lunch = 30; // deleted day resets to the default for its next commit
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
  // Asymmetric on purpose: the draft survives re-renders for the SAME
  // worker+week (e.g. navigating to screen-worker and back via history, or
  // promptTime committing a day) so in-progress/invalid entries aren't lost,
  // but it resets the moment the key changes (paging weeks with </>, or a
  // different worker) since there's nothing worth carrying over. Either way
  // it's memory-only — never persisted, never read back after a reload.
  if (key !== weekDraftKey) {
    weekDraft = buildWeekDraft(worker, mondayIso);
    weekDraftKey = key;
  }

  // ---- Top: worker name, week range, prev/next ----
  container.appendChild(buildWeekNavHeader(mondayIso, (newMonday) => {
    state.currentMonday = newMonday;
    renderWeek();
  }, worker.name));

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
  const paid = PayMath.paidMinutes(entry.start, entry.end, entry.lunch);
  hours.textContent = paid != null ? PayMath.toDecimal(paid).toFixed(2) : '—';

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

  // Lunch toggle chip: only for a day with a complete, valid entry. Missing
  // lunch (legacy days with no lunch key) renders as "off" — no deduction is
  // exactly what's already happening, and a tap normalizes the entry to the
  // explicit 30-minute default.
  if (PayMath.isValidPair(entry.start, entry.end)) {
    const on = !!entry.lunch;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'lunch-chip ' + (on ? 'lunch-chip-on' : 'lunch-chip-off');
    chip.textContent = on ? 'Lunch 30 min' : 'No lunch';
    chip.setAttribute('aria-pressed', String(on));
    chip.addEventListener('click', () => {
      entry.lunch = on ? 0 : 30;
      commitDay(worker, date);
      renderWeek();
    });
    row.appendChild(chip);
  }

  return row;
}

// ---------------------------------------------------------------------------
// Task 7: Payday summary (screen-payday)
// ---------------------------------------------------------------------------

// The screen the owner reads straight into ADP: one row per worker with
// hours this week, showing the exact rounded-decimal numbers he types in
// (Reg / OT), plus an unofficial gross estimate when a rate is on file.
function renderPayday() {
  if (!state.currentMonday) state.currentMonday = Store.mondayOf(todayIso());
  const mondayIso = state.currentMonday;

  const container = document.getElementById('paydayContent');
  container.textContent = '';

  container.appendChild(buildWeekNavHeader(mondayIso, (newMonday) => {
    state.currentMonday = newMonday;
    renderPayday();
  }));

  const rows = [];
  state.data.workers.forEach((worker) => {
    const mins = Store.weekMinutes(state.data, worker.id, mondayIso);
    if (mins > 0) rows.push({ worker, mins });
  });

  if (rows.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No hours entered for this week yet.';
    container.appendChild(p);
    return;
  }

  let totalRegMin = 0;
  let totalOtMin = 0;
  rows.forEach(({ worker, mins }) => {
    const split = PayMath.splitOvertime(mins);
    totalRegMin += split.regMin;
    totalOtMin += split.otMin;
    container.appendChild(buildPaydayRow(worker, split));
  });

  container.appendChild(buildPaydayTotals(totalRegMin, totalOtMin));
}

function buildPaydayRow(worker, split) {
  const row = document.createElement('div');
  row.className = 'payday-row';

  const name = document.createElement('div');
  name.className = 'payday-name';
  name.textContent = worker.name;
  row.appendChild(name);

  const reg = document.createElement('div');
  reg.className = 'payday-figure';
  reg.textContent = 'Reg ' + PayMath.toDecimal(split.regMin).toFixed(2);
  row.appendChild(reg);

  if (split.otMin > 0) {
    const ot = document.createElement('div');
    ot.className = 'payday-figure';
    ot.textContent = 'OT ' + PayMath.toDecimal(split.otMin).toFixed(2);
    row.appendChild(ot);
  }

  if (worker.rate != null) {
    const est = PayMath.grossEstimate(split.regMin, split.otMin, worker.rate);
    if (est != null) {
      const estEl = document.createElement('div');
      estEl.className = 'payday-est';
      estEl.textContent = 'est. $' + formatMoney(est) + ' — ADP is official';
      row.appendChild(estEl);
    }
  }

  return row;
}

// totalRegMin/totalOtMin are raw summed minutes across workers — converted to
// decimal hours only here, never summed as already-rounded decimals (Store.
// weekMinutes/PayMath.splitOvertime give exact minutes; rounding per-worker
// first and adding those would drift from ADP's own weekly totals).
function buildPaydayTotals(totalRegMin, totalOtMin) {
  const row = document.createElement('div');
  row.className = 'payday-totals';
  row.textContent = 'Total: Reg ' + PayMath.toDecimal(totalRegMin).toFixed(2) +
    ' / OT ' + PayMath.toDecimal(totalOtMin).toFixed(2);
  return row;
}

// ---------------------------------------------------------------------------
// Task 7: Backup reminder banner (rendered inside screen-workers)
// ---------------------------------------------------------------------------

// Separate localStorage key from Store.KEY on purpose: this is app metadata
// (when did the owner last export?), never part of the timesheet data itself,
// so it must never pass through Store.validateImport / a backup round-trip.
const BACKUP_META_KEY = 'ce-timesheets-meta';
const BACKUP_REMINDER_DAYS = 30;

// Module variable, not persisted: dismissing the banner only hides it until
// the next app load (page reload), per spec.
let backupBannerDismissed = false;

function getBackupMeta() {
  try {
    const raw = localStorage.getItem(BACKUP_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.lastExport !== 'string') return null;
    // A lastExport that doesn't parse to a real date (corrupted value written
    // by some future/older version, manual tampering, etc.) must NOT
    // permanently suppress the reminder — treat it the same as "never
    // exported" rather than returning meta that daysSince() can't use.
    if (isNaN(isoNoon(parsed.lastExport).getTime())) return null;
    return parsed;
  } catch {
    return null; // corrupted meta reads the same as "never exported"
  }
}

function recordExport() {
  try {
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify({ lastExport: todayIso() }));
  } catch {
    // localStorage unavailable — nothing to do, matches Store.save's fallback
  }
}

function daysSince(iso) {
  const then = isoNoon(iso);
  const now = isoNoon(todayIso());
  return Math.round((now - then) / 86400000);
}

function renderBackupBanner() {
  const area = document.getElementById('backupBannerArea');
  area.textContent = '';
  if (backupBannerDismissed) return;
  if (state.data.workers.length === 0) return;

  const meta = getBackupMeta();
  const stale = !meta || daysSince(meta.lastExport) > BACKUP_REMINDER_DAYS;
  if (!stale) return;

  const banner = document.createElement('div');
  banner.className = 'backup-banner';

  const text = document.createElement('span');
  text.className = 'backup-banner-text';
  text.textContent = "It's been a while since your last backup — tap Send Data in Settings.";

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.className = 'backup-banner-dismiss';
  dismissBtn.textContent = '✕';
  dismissBtn.setAttribute('aria-label', 'Dismiss');
  dismissBtn.addEventListener('click', () => {
    backupBannerDismissed = true;
    area.textContent = '';
  });

  banner.appendChild(text);
  banner.appendChild(dismissBtn);
  area.appendChild(banner);
}

// ---------------------------------------------------------------------------
// Task 7: Settings (screen-settings) — Send Data / Import / Change PIN
// ---------------------------------------------------------------------------

// Nothing on this screen depends on which worker/week is current, so there's
// no per-visit computation — the static controls are wired once at boot,
// same pattern as screen-workers/screen-worker's static buttons. Registered
// as SCREENS' render anyway so navigateTo('screen-settings') has a hook if a
// later task needs one.
function renderSettings() {}

// Guards against a second Send Data tap firing a second share/download while
// the first is still in flight (e.g. the share sheet takes a moment to open,
// or a fast double-tap) — same rationale as promptTime's timePanelOpen guard.
let sendDataBusy = false;

async function handleSendData() {
  if (sendDataBusy) return;
  sendDataBusy = true;

  const filename = 'ce-timesheets-' + todayIso() + '.json';
  const file = new File([JSON.stringify(state.data)], filename, { type: 'application/json' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'CE Timesheets backup' });
      recordExport();
    } catch (err) {
      // User cancelling the share sheet throws AbortError — swallow
      // silently and do NOT record an export, since nothing was actually
      // sent. Any other failure (permission denied, OS share error, etc.)
      // did send nothing either, but the owner should know it didn't work.
      if (!(err && err.name === 'AbortError')) {
        alert('Backup could not be sent — try again.');
      }
    } finally {
      sendDataBusy = false;
    }
    return;
  }

  // Fallback for browsers without the Web Share API (typical on desktop):
  // build a temporary object-URL download link, click it, then clean up.
  // This branch has no natural await point, so sendDataBusy is deliberately
  // released inside the deferred revoke below rather than synchronously here
  // — releasing it immediately would let a same-tick second tap (or a
  // script-driven double click()) sail through the guard before it ever saw
  // sendDataBusy flip back to false.
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  recordExport(); // fallback path has no cancel signal, so record immediately
  setTimeout(() => {
    URL.revokeObjectURL(url);
    sendDataBusy = false;
  }, 0);
}

function handleImportFileChange(e) {
  const input = e.currentTarget;
  const file = input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const imported = Store.validateImport(String(reader.result));
    if (imported === null) {
      alert("That file isn't a CE Timesheets backup — nothing was changed.");
      input.value = '';
      return;
    }
    if (confirm('Replace ALL current data with this backup? This cannot be undone.')) {
      state.data = imported;
      Store.save(state.data);
      navigateTo('screen-workers');
    }
    input.value = ''; // allow re-picking the same file next time
  };
  reader.onerror = () => {
    alert("That file isn't a CE Timesheets backup — nothing was changed.");
    input.value = '';
  };
  reader.readAsText(file);
}

function handleChangePin() {
  state.data.pin = null;
  Store.save(state.data);
  // navigateTo('screen-pin') alone wouldn't reset pinMode/buffer — screen-pin
  // is registered with render: null (see SCREENS) since boot is the only
  // other caller and it always pairs navigateTo with an explicit
  // initPinScreen() first. Do the same here so this shows choose+confirm.
  initPinScreen();
  navigateTo('screen-pin');
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

  // Scoped to the static PIN keypad by id — promptTime()'s panel builds its
  // own dynamic .keypad per-open, and the two must never be confused.
  document.getElementById('pinKeypad').addEventListener('click', (e) => {
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
  document.getElementById('paydaySummaryBtn').addEventListener('click', () => {
    state.currentMonday = Store.mondayOf(todayIso());
    navigateTo('screen-payday');
  });
  document.getElementById('settingsBtn').addEventListener('click', () => navigateTo('screen-settings'));

  // screen-settings static controls
  document.getElementById('sendDataBtn').addEventListener('click', handleSendData);
  document.getElementById('importFileInput').addEventListener('change', handleImportFileChange);
  document.getElementById('changePinBtn').addEventListener('click', handleChangePin);

  // screen-worker static controls
  document.getElementById('enterHoursBtn').addEventListener('click', () => {
    state.currentMonday = Store.mondayOf(todayIso());
    navigateTo('screen-week');
  });
  document.getElementById('deleteWorkerBtn').addEventListener('click', deleteCurrentWorker);
});

if ('serviceWorker' in navigator) {
  // Home-screen apps on iOS resume from the background far more often than
  // they cold-launch, and iOS's own periodic SW update check is unreliable
  // there. So we don't just register-and-forget: pull for updates right
  // after registering, and again every time the app comes back to the
  // foreground.
  let reloadedForNewWorker = false; // guards against a reload loop

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then((reg) => {
        reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            reg.update().catch(() => {});
          }
        });
      })
      .catch(() => {});
  });

  // When a new worker takes control, reload once to pick it up. Everything
  // the user has already committed lives in localStorage (instant-save
  // design) — a reload here can only lose an incomplete, not-yet-saved
  // in-panel time entry, which is an acceptable trade for staying current.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForNewWorker) return;
    reloadedForNewWorker = true;
    location.reload();
  });
}
