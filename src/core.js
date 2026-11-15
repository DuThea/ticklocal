/* TickLocal v4 — pure core: dates, parser, recurrence, normalize, reducer, selectors. No DOM, no storage. */

// ==========================================
// 1A. DATES — always local time, YYYY-MM-DD strings
// (v2 used toISOString() = UTC, which was off by one day in GMT+7)
// ==========================================
const pad2 = (n) => String(n).padStart(2, '0');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDateStr = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toDateStr(parseDateStr(s)) === s;
const isTimeStr = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const todayStr = () => toDateStr(new Date());
const addDays = (s, n) => { const d = parseDateStr(s); d.setDate(d.getDate() + n); return toDateStr(d); };
const diffDays = (a, b) => Math.round((parseDateStr(a) - parseDateStr(b)) / 86400000);
const isoToLocalDate = (iso) => { const d = new Date(iso); return isNaN(d) ? null : toDateStr(d); };
// Add months with day clamping: Jan 31 + 1 month = Feb 28 (v2 jumped to Mar 3)
const addMonths = (s, n, anchorDay) => {
  const d = parseDateStr(s);
  const day = anchorDay || d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return toDateStr(t);
};
const fmtDate = (s, today) => {
  if (!s) return '';
  const diff = diffDays(s, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const [y, m, d] = s.split('-');
  const mon = MONTHS[Number(m) - 1].slice(0, 3);
  return y === today.slice(0, 4) ? `${mon} ${Number(d)}` : `${mon} ${Number(d)}, ${y}`;
};

// ==========================================
// 1B. CONSTANTS
// ==========================================
const SCHEMA = 4;
const STORAGE_KEY = 'TICKLOCAL_IOS_DB_V4'; // only used when the browser has no IndexedDB
const LEGACY_KEYS = ['TICKLOCAL_IOS_DB_V3', 'TICKLOCAL_IOS_DB_V2'];
const TIMER_KEY = 'TICKLOCAL_TIMER_V4';
const RULES = ['NONE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY'];
const RULE_LABEL = { NONE: 'No repeat', DAILY: 'Daily', WEEKDAYS: 'Weekdays (Mon–Fri)', WEEKLY: 'Weekly', MONTHLY: 'Monthly' };
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const ruleLabel = (t) => {
  const n = t.recurrenceInterval || 1;
  if (n === 1 || t.recurrenceRule === 'WEEKDAYS' || t.recurrenceRule === 'NONE') return RULE_LABEL[t.recurrenceRule];
  return `Every ${n} ${{ DAILY: 'days', WEEKLY: 'weeks', MONTHLY: 'months' }[t.recurrenceRule]}`;
};
const PALETTE = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#0EA5E9', '#EC4899', '#64748B'];
const EMOJIS = ['🔥', '💧', '📚', '🧘', '💻', '🏃', '🎯', '🚀', '🏆', '🛡️', '🎂', '✈️'];
const NOISES = [['OFF', 'Off'], ['WHITE', 'White noise'], ['PINK', 'Pink noise'], ['BROWN', 'Brown noise']];
const PRIORITY = {
  3: { label: 'High', border: 'border-red-500', hex: '#EF4444' },
  2: { label: 'Medium', border: 'border-amber-500', hex: '#F59E0B' },
  1: { label: 'Low', border: 'border-blue-500', hex: '#3B82F6' },
  0: { label: 'None', border: 'border-slate-400', hex: '#94A3B8' }
};
const DEFAULT_SETTINGS = { darkMode: true, focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, noise: 'OFF', beep: true, viewMode: 'list', remind: true, remindLead: 10, lastBackupAt: null };
const SMART = {
  SMART_TODAY: 'Today', SMART_NEXT7: 'Next 7 days', SMART_INBOX: 'Inbox', SMART_ALL: 'All tasks',
  SMART_NOTES: 'Notebook', SMART_COUNTDOWN: 'Countdown', SMART_TRASH: 'Trash'
};

let uidSeq = 0;
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${(uidSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clampInt = (v, lo, hi, dflt) => { const n = v === '' || v == null ? NaN : Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

// ==========================================
// 1C. QUICK-ADD PARSER (pure, no AI)
// ==========================================
// Unicode-aware word boundaries, without lookbehind so it runs on older Safari
const tok = (pattern, flags = 'iu') => new RegExp(`(^|[^\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, flags);
const WEEKDAY = { sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6 };

const FRACTIONS = new Set(['1/2', '1/3', '2/3', '1/4', '3/4']);
const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replaceAll(String.fromCharCode(0x111), 'd').replace(/[^a-z0-9]/g, ''); // 0x111 = d with stroke (not decomposed by NFD)
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// Existing tag close to the typed name (accents ignored, ≤ 2 typos, or an extra suffix) → suggest it instead of creating a junk tag
function nearestTag(name, tags) {
  const f = fold(name);
  if (f.length < 3) return null;
  let best = null, bestScore = 3;
  for (const t of tags) {
    const g = fold(t.name);
    if (g.length < 3) continue;
    const score = g === f ? 0 : (f.startsWith(g) || g.startsWith(f)) ? 0.5 : editDistance(f, g);
    if (score < bestScore && score <= 2) { best = t; bestScore = score; }
  }
  return best;
}

function parseQuickAdd(rawText, tags, today) {
  let text = ` ${rawText} `;
  const out = { title: '', priority: null, dueDate: null, dueTime: null, recurrence: null, interval: 1, tagIds: [], newTagNames: [] };
  // Walk every match; fn returning false = not what we are looking for, try the next match
  const take = (re, fn) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m;
    while ((m = g.exec(text)) !== null) {
      if (fn(m) !== false) { text = `${text.slice(0, m.index)}${m[1]} ${text.slice(m.index + m[0].length)}`; return true; }
    }
    return false;
  };

  take(/(^|\s)!(high|hi|3|medium|med|2|low|lo|1|none|0)(?=\s|$)/iu, (m) => {
    const v = m[2].toLowerCase();
    out.priority = ['high', 'hi', '3'].includes(v) ? 3 : ['medium', 'med', '2'].includes(v) ? 2 : ['low', 'lo', '1'].includes(v) ? 1 : 0;
  });

  text = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_, pre, name) => {
    const slug = name.toLowerCase();
    const found = tags.find((t) => t.name.toLowerCase() === slug);
    if (found) { if (!out.tagIds.includes(found.id)) out.tagIds.push(found.id); }
    else if (!out.newTagNames.includes(slug)) out.newTagNames.push(slug);
    return `${pre} `;
  });

  const setRule = (rule) => () => { out.recurrence = rule; };
  take(tok('every (\\d{1,2}) (days?|weeks?|months?)'), (m) => {
    const n = Number(m[2]), u = m[3].toLowerCase();
    if (n < 1) return false;
    out.recurrence = u.startsWith('day') ? 'DAILY' : u.startsWith('week') ? 'WEEKLY' : 'MONTHLY';
    out.interval = n;
    return true;
  })
    || take(tok('every weekday|weekdays?|mon-fri|monday-friday|monday to friday'), setRule('WEEKDAYS'))
    || take(tok('every day|everyday|daily'), setRule('DAILY'))
    || take(tok('every week|weekly'), setRule('WEEKLY'))
    || take(tok('every month|monthly'), setRule('MONTHLY'));

  const setDate = (d) => () => { out.dueDate = d; };
  // Weekday names always mean the next occurrence (never today); short forms need "on"/"next" ("Buy sun cream" stays a title)
  const nextWeekday = (wd) => addDays(today, ((wd - parseDateStr(today).getDay() + 7) % 7) || 7);
  take(tok('today|tonight'), setDate(today))
    || take(tok('day after tomorrow'), setDate(addDays(today, 2)))
    || take(tok('tomorrow|tmrw|tmr'), setDate(addDays(today, 1)))
    || take(tok('(?:(?:on|next) )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)|(?:on|next) (sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)'), (m) => {
      out.dueDate = nextWeekday(WEEKDAY[(m[2] || m[3]).toLowerCase()]);
    })
    || take(tok('(?:(on) )?(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}))?'), (m) => {
      // Dates are day/month. "1/2 pill", "3/4 dose" are fractions, not dates — unless written as "on 1/2" or with a year
      if (!m[2] && !m[5] && FRACTIONS.has(`${Number(m[3])}/${Number(m[4])}`)) return false;
      const year = m[5] ? Number(m[5]) : Number(today.slice(0, 4));
      let d = `${year}-${pad2(m[4])}-${pad2(m[3])}`;
      if (!isDateStr(d)) return false;
      if (!m[5] && d < today) d = addMonths(d, 12);
      out.dueDate = d;
      return true;
    });

  // Times: "14:30", "9:30", "9h30" are always times. A bare number ("9", "9h") is a time only with "at" before it
  // or am/pm after it; otherwise it is a duration ("backtest 2h") and stays in the title.
  take(tok('(?:(at) )?(\\d{1,2})(?:(:)(\\d{2})|h(\\d{2})?)?(?: ?(am|pm))?'), (m) => {
    if (!m[2] && !m[4] && !m[6] && !m[7]) return false;
    let h = Number(m[3]);
    const min = Number(m[5] || m[6] || 0);
    const sfx = (m[7] || '').toLowerCase();
    if (sfx === 'pm' && h < 12) h += 12;
    else if (sfx === 'am' && h === 12) h = 0;
    if (h > 23 || min > 59) return false;
    out.dueTime = `${pad2(h)}:${pad2(min)}`;
    return true;
  });

  if (out.recurrence === 'WEEKDAYS' && !out.dueDate) {
    let d = today;
    while ([0, 6].includes(parseDateStr(d).getDay())) d = addDays(d, 1);
    out.dueDate = d;
  }
  if ((out.dueTime || out.recurrence) && !out.dueDate) out.dueDate = today;
  out.title = text.replace(/\s+/g, ' ').trim();
  return out;
}

// ==========================================
// 1D. RECURRENCE ENGINE
// ==========================================
// Monthly repeats keep the "anchor day" (recurrenceDay): due on the 31st → Feb 28 → Mar 31, no drifting to the 28th like v3
function nextDueDate(t, today) {
  const rule = t.recurrenceRule, n = Math.max(1, t.recurrenceInterval || 1), fromDone = t.recurrenceType === 1;
  if (!RULES.includes(rule) || rule === 'NONE') return t.dueDate;
  const step = (s) => {
    if (rule === 'DAILY') return addDays(s, n);
    if (rule === 'WEEKLY') return addDays(s, 7 * n);
    if (rule === 'MONTHLY') {
      const anchor = fromDone ? undefined : t.recurrenceDay || undefined;
      // Due date temporarily moved before the anchor day in the same month → the next occurrence is that month's anchor day
      const sameMonth = anchor && n === 1 ? addMonths(s, 0, anchor) : s;
      return sameMonth > s ? sameMonth : addMonths(s, n, anchor);
    }
    let d = addDays(s, 1); // WEEKDAYS: skip Saturday and Sunday
    while ([0, 6].includes(parseDateStr(d).getDay())) d = addDays(d, 1);
    return d;
  };
  if (fromDone || !t.dueDate) return step(today);
  let next = step(t.dueDate);
  // Overdue by several periods: jump straight to the next future occurrence instead of completing each one
  for (let i = 0; i < 2000 && next < today; i++) next = step(next);
  return next;
}
const withAnchor = (t) => {
  const day = t.recurrenceRule === 'MONTHLY' && t.dueDate ? Number(t.dueDate.slice(8)) : null;
  return t.recurrenceDay === day ? t : { ...t, recurrenceDay: day };
};

// ==========================================
// 1E. SAMPLE DATA + NORMALIZE (one function shared by load / import / integrity check)
// ==========================================
function makeTask(p, nowIso) {
  return {
    id: p.id, title: p.title || '', content: p.content || '', listId: p.listId ?? null,
    isCompleted: false, isDeleted: false, priority: p.priority ?? 0,
    dueDate: p.dueDate ?? null, dueTime: p.dueTime ?? null,
    recurrenceRule: p.recurrenceRule || 'NONE', recurrenceType: p.recurrenceType === 1 ? 1 : 0,
    recurrenceInterval: p.recurrenceInterval || 1,
    recurrenceDay: p.recurrenceRule === 'MONTHLY' && p.dueDate ? Number(p.dueDate.slice(8)) : null,
    tags: p.tags || [], subtasks: p.subtasks || [], isNote: !!p.isNote,
    createdAt: nowIso, completedAt: null, parentId: null, sim: false
  };
}

const seedData = (today, nowIso) => normalizeDb(seedRaw(today, nowIso)).db;
function seedRaw(today, nowIso) {
  const t = (p) => makeTask(p, nowIso);
  return {
    schemaVersion: SCHEMA, lastUpdatedAt: nowIso, settings: { ...DEFAULT_SETTINGS },
    folders: [{ id: 'f-1', name: 'Work' }, { id: 'f-2', name: 'Personal' }],
    lists: [
      { id: 'l-1', name: 'iOS Local-First Project', color: '#3B82F6', folderId: 'f-1' },
      { id: 'l-2', name: 'Operations & Meetings', color: '#8B5CF6', folderId: 'f-1' },
      { id: 'l-3', name: 'Health & Life', color: '#10B981', folderId: 'f-2' },
      { id: 'l-4', name: 'Reading & Learning', color: '#F59E0B', folderId: 'f-2' }
    ],
    tags: [
      { id: 't-1', name: 'urgent', color: '#EF4444' }, { id: 't-2', name: 'deep-work', color: '#6366F1' },
      { id: 't-3', name: 'quick', color: '#10B981' }, { id: 't-4', name: 'coding', color: '#0EA5E9' }
    ],
    tasks: [
      t({ id: 'task-1', title: 'Design the GRDB database schema with WAL mode', content: 'Configure Write-Ahead Logging to avoid database locks when the Widget and the App access it at the same time.', listId: 'l-1', priority: 3, dueDate: today, dueTime: '10:00', tags: ['t-1', 't-4'],
        subtasks: [{ id: 'sub-1', title: 'Define the TASK and SUBTASK tables', isCompleted: true }, { id: 'sub-2', title: 'Set up foreign key cascade delete', isCompleted: true }, { id: 'sub-3', title: 'Write unit tests for concurrency', isCompleted: false }] }),
      t({ id: 'task-2', title: 'Build the recurring task engine (history clones)', content: 'Completing a recurring task → clone one Completed record to keep history, then move the DueDate of the original task.', listId: 'l-1', priority: 3, dueDate: today, dueTime: '14:30', recurrenceRule: 'DAILY', recurrenceType: 1, tags: ['t-2', 't-4'] }),
      t({ id: 'task-3', title: '30-minute workout', content: 'Run or jump rope at home.', listId: 'l-3', priority: 2, dueDate: today, dueTime: '17:30', recurrenceRule: 'DAILY', tags: ['t-3'] }),
      t({ id: 'task-4', title: 'Check the iOS limit of 64 local notifications', content: 'Only schedule notifications for the next 14 days via BGAppRefreshTask.', listId: 'l-1', priority: 1, dueDate: addDays(today, 1), dueTime: '09:00', tags: ['t-4'] }),
      t({ id: 'task-5', title: 'Pay internet & utility bills', content: 'Check the receipt in the banking app.', priority: 2, dueDate: addDays(today, -1), recurrenceRule: 'MONTHLY', tags: ['t-1'] }),
      t({ id: 'task-6', title: 'Architecture note: why no AI in the Local-First version?', content: '1. Complete privacy, 100% offline.\n2. No API keys or server fees.\n3. A rule-based parser is enough to extract basic dates and times.', listId: 'l-4', tags: ['t-2'], isNote: true })
    ],
    habits: [
      { id: 'h-1', name: 'Drink 2L of water', icon: '💧', color: '#0EA5E9', logs: { [addDays(today, -2)]: 1, [addDays(today, -1)]: 1, [today]: 1 } },
      { id: 'h-2', name: 'Read 20 pages', icon: '📚', color: '#F59E0B', logs: { [addDays(today, -3)]: 1, [addDays(today, -1)]: 1 } },
      { id: 'h-3', name: 'Meditate', icon: '🧘', color: '#10B981', logs: {} },
      { id: 'h-4', name: 'Write a DevLog', icon: '💻', color: '#8B5CF6', logs: { [addDays(today, -1)]: 1, [today]: 1 } }
    ],
    countdowns: [
      { id: 'cd-1', title: 'iOS app launch', targetDate: addDays(today, 30), icon: '🚀' },
      { id: 'cd-2', title: 'Yearly backup & device maintenance', targetDate: addDays(today, 90), icon: '🛡️' }
    ],
    smartFilters: [{ id: 'sf-1', name: '🔥 Urgent & Deep Work', priority: 3, tagId: 't-2', onlyOverdueOrToday: true }],
    focusSessions: []
  };
}

function normalizeDb(raw) {
  const fixes = { orphanLists: 0, orphanTags: 0, orphanSessions: 0, orphanFolders: 0, dropped: 0, dupIds: 0 };
  const src = raw && typeof raw === 'object' ? raw : {};
  const coll = (key) => {
    const seen = new Set();
    return (Array.isArray(src[key]) ? src[key] : []).filter((x) => {
      if (!x || typeof x !== 'object' || typeof x.id !== 'string' || !x.id) { fixes.dropped++; return false; }
      if (seen.has(x.id)) { fixes.dupIds++; return false; }
      seen.add(x.id);
      return true;
    });
  };
  const str = (v, dflt = '') => (typeof v === 'string' ? v : dflt);
  const nowIso = new Date().toISOString();

  const folders = coll('folders').map((f) => ({ id: f.id, name: str(f.name, 'Folder') }));
  const folderIds = new Set(folders.map((f) => f.id));
  const lists = coll('lists').map((l) => {
    let folderId = l.folderId ?? null;
    if (folderId && !folderIds.has(folderId)) { folderId = null; fixes.orphanFolders++; }
    return { id: l.id, name: str(l.name, 'List'), color: str(l.color, PALETTE[0]), folderId };
  });
  const listIds = new Set(lists.map((l) => l.id));
  const tags = coll('tags').map((t) => ({ id: t.id, name: str(t.name, 'tag'), color: str(t.color, PALETTE[2]) }));
  const tagIds = new Set(tags.map((t) => t.id));

  const tasks = coll('tasks').map((t) => {
    let listId = t.listId ?? null;
    if (listId && !listIds.has(listId)) { listId = null; fixes.orphanLists++; }
    const taskTags = [...new Set(Array.isArray(t.tags) ? t.tags : [])].filter((id) => {
      const ok = tagIds.has(id);
      if (!ok) fixes.orphanTags++;
      return ok;
    });
    const subSeen = new Set();
    const subtasks = (Array.isArray(t.subtasks) ? t.subtasks : [])
      .filter((s) => s && typeof s.id === 'string' && !subSeen.has(s.id) && subSeen.add(s.id))
      .map((s) => ({ id: s.id, title: str(s.title), isCompleted: !!s.isCompleted }));
    const isCompleted = !!t.isCompleted;
    const dueDate = isDateStr(t.dueDate) ? t.dueDate : null;
    const rule = RULES.includes(t.recurrenceRule) ? t.recurrenceRule : 'NONE';
    return {
      id: t.id, title: str(t.title).trim() || '(Untitled)', content: str(t.content), listId,
      isCompleted, isDeleted: !!t.isDeleted,
      priority: [0, 1, 2, 3].includes(Number(t.priority)) ? Number(t.priority) : 0,
      dueDate,
      // v2 had a separate isAllDay flag; v3 treats "no time = all day"
      dueTime: t.isAllDay !== true && isTimeStr(t.dueTime) ? t.dueTime : null,
      recurrenceRule: rule,
      recurrenceType: t.recurrenceType === 1 ? 1 : 0,
      recurrenceInterval: rule === 'WEEKDAYS' ? 1 : clampInt(t.recurrenceInterval, 1, 365, 1),
      recurrenceDay: rule !== 'MONTHLY' ? null : Number.isInteger(t.recurrenceDay) && t.recurrenceDay >= 1 && t.recurrenceDay <= 31 ? t.recurrenceDay : dueDate ? Number(dueDate.slice(8)) : null,
      tags: taskTags, subtasks, isNote: !!t.isNote,
      createdAt: str(t.createdAt, nowIso),
      completedAt: isCompleted ? str(t.completedAt, '') || null : null,
      parentId: str(t.parentId, '') || null,
      sim: !!t.sim || t.id.startsWith('sim-task-')
    };
  });
  const taskIds = new Set(tasks.map((t) => t.id));

  const habits = coll('habits').map((h) => {
    const logs = {};
    if (h.logs && typeof h.logs === 'object') {
      for (const k of Object.keys(h.logs)) if (isDateStr(k) && h.logs[k]) logs[k] = h.logs[k] === 2 ? 2 : 1;
    }
    const days = [...new Set(Array.isArray(h.days) ? h.days : [])].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
    return { id: h.id, name: str(h.name, 'Habit'), icon: str(h.icon, '🔥'), color: str(h.color, PALETTE[0]), days: days.length ? days : ALL_DAYS, logs };
  });
  const countdowns = coll('countdowns').filter((c) => isDateStr(c.targetDate) || (fixes.dropped++, false))
    .map((c) => ({ id: c.id, title: str(c.title, 'Event'), targetDate: c.targetDate, icon: str(c.icon, '🎯') }));
  const smartFilters = coll('smartFilters').map((f) => {
    let tagId = f.tagId ?? null;
    if (tagId && !tagIds.has(tagId)) { tagId = null; fixes.orphanTags++; }
    return { id: f.id, name: str(f.name, 'Filter'), priority: [-1, 0, 1, 2, 3].includes(Number(f.priority)) ? Number(f.priority) : -1, tagId, onlyOverdueOrToday: !!f.onlyOverdueOrToday };
  });
  const focusSessions = coll('focusSessions').map((s) => {
    let taskId = s.taskId ?? null;
    if (taskId && !taskIds.has(taskId)) { taskId = null; fixes.orphanSessions++; }
    return {
      id: s.id, taskId, duration: Math.max(0, Math.round(Number(s.duration) || 0)),
      startTime: str(s.startTime, nowIso), endTime: str(s.endTime, nowIso),
      mode: s.mode === 'STOPWATCH' ? 'STOPWATCH' : 'POMODORO', sim: !!s.sim || s.id.startsWith('sim-fs-')
    };
  });

  const st = src.settings && typeof src.settings === 'object' ? src.settings : {};
  const settings = {
    darkMode: st.darkMode !== false,
    focusMin: clampInt(st.focusMin, 1, 180, 25), shortMin: clampInt(st.shortMin, 1, 60, 5),
    longMin: clampInt(st.longMin, 1, 120, 15), longEvery: clampInt(st.longEvery, 2, 12, 4),
    noise: NOISES.some(([k]) => k === st.noise) ? st.noise : 'OFF',
    beep: st.beep !== false, viewMode: st.viewMode === 'board' ? 'board' : 'list',
    remind: st.remind !== false, remindLead: clampInt(st.remindLead, 0, 120, 10),
    lastBackupAt: str(st.lastBackupAt, '') || null
  };
  const ar = src.archive && typeof src.archive === 'object' ? src.archive : {};
  const archive = { tasks: clampInt(ar.tasks, 0, 1e9, 0), sessions: clampInt(ar.sessions, 0, 1e9, 0), focusSec: clampInt(ar.focusSec, 0, 1e12, 0), lastAt: str(ar.lastAt, '') || null };

  const db = { schemaVersion: SCHEMA, lastUpdatedAt: str(src.lastUpdatedAt, nowIso), settings, archive, folders, lists, tags, tasks, habits, countdowns, smartFilters, focusSessions };
  return { db, fixes, fixCount: Object.values(fixes).reduce((a, b) => a + b, 0) };
}

// ==========================================
// 1F. REDUCER — strictly pure (ids and timestamps are carried in by the action)
// ==========================================
function reducer(db, a) {
  const mapTask = (id, fn) => ({ ...db, tasks: db.tasks.map((t) => (t.id === id ? fn(t) : t)) });
  switch (a.type) {
    case 'REPLACE': return a.db;
    case 'ADD_TASK': return { ...db, tasks: [withAnchor(a.task), ...db.tasks], tags: a.newTags?.length ? [...db.tags, ...a.newTags] : db.tags };
    // keepAnchor: temporarily moving the due date ("to tomorrow") must not change a monthly task's anchor day
    case 'UPDATE_TASK': return mapTask(a.id, (t) => (a.keepAnchor ? { ...t, ...a.patch } : withAnchor({ ...t, ...a.patch })));
    case 'TOGGLE_TASK': {
      const t = db.tasks.find((x) => x.id === a.id);
      if (!t || t.isNote) return db;
      if (!t.isCompleted && t.recurrenceRule !== 'NONE') {
        const history = { ...t, id: a.histId, isCompleted: true, recurrenceRule: 'NONE', completedAt: a.now, parentId: t.id };
        const next = { ...t, dueDate: nextDueDate(t, a.today), subtasks: t.subtasks.map((s) => ({ ...s, isCompleted: false })) };
        return { ...db, tasks: db.tasks.map((x) => (x.id === a.id ? next : x)).concat(history) };
      }
      return mapTask(a.id, (x) => ({ ...x, isCompleted: !x.isCompleted, completedAt: x.isCompleted ? null : a.now }));
    }
    case 'TRASH_TASK': return mapTask(a.id, (t) => ({ ...t, isDeleted: true }));
    case 'RESTORE_TASK': return mapTask(a.id, (t) => ({ ...t, isDeleted: false }));
    case 'PURGE_TASK': return {
      ...db, tasks: db.tasks.filter((t) => t.id !== a.id),
      focusSessions: db.focusSessions.map((s) => (s.taskId === a.id ? { ...s, taskId: null } : s))
    };
    case 'EMPTY_TRASH': {
      const gone = new Set(db.tasks.filter((t) => t.isDeleted).map((t) => t.id));
      return { ...db, tasks: db.tasks.filter((t) => !t.isDeleted), focusSessions: db.focusSessions.map((s) => (gone.has(s.taskId) ? { ...s, taskId: null } : s)) };
    }
    case 'TOGGLE_HABIT': return {
      ...db, habits: db.habits.map((h) => {
        if (h.id !== a.id) return h;
        const logs = { ...h.logs };
        if (logs[a.date]) delete logs[a.date]; else logs[a.date] = 1;
        return { ...h, logs };
      })
    };
    case 'UPSERT': {
      const list = db[a.coll];
      const exists = list.some((x) => x.id === a.item.id);
      return { ...db, [a.coll]: exists ? list.map((x) => (x.id === a.item.id ? { ...x, ...a.item } : x)) : [...list, a.item] };
    }
    case 'DELETE': {
      const next = { ...db, [a.coll]: db[a.coll].filter((x) => x.id !== a.id) };
      if (a.coll === 'lists') next.tasks = db.tasks.map((t) => (t.listId === a.id ? { ...t, listId: null } : t));
      if (a.coll === 'folders') next.lists = db.lists.map((l) => (l.folderId === a.id ? { ...l, folderId: null } : l));
      if (a.coll === 'tags') {
        next.tasks = db.tasks.map((t) => (t.tags.includes(a.id) ? { ...t, tags: t.tags.filter((x) => x !== a.id) } : t));
        next.smartFilters = db.smartFilters.map((f) => (f.tagId === a.id ? { ...f, tagId: null } : f));
      }
      return next;
    }
    case 'MERGE_TAG': {
      if (a.from === a.to || !db.tags.some((t) => t.id === a.to)) return db;
      return {
        ...db, tags: db.tags.filter((t) => t.id !== a.from),
        tasks: db.tasks.map((t) => (t.tags.includes(a.from) ? { ...t, tags: [...new Set(t.tags.map((x) => (x === a.from ? a.to : x)))] } : t)),
        smartFilters: db.smartFilters.map((f) => (f.tagId === a.from ? { ...f, tagId: a.to } : f))
      };
    }
    case 'ARCHIVE': {
      const old = selectArchivable(db, a.cutoff);
      if (!old.tasks.length && !old.sessions.length) return db;
      const goneT = new Set(old.tasks.map((t) => t.id)), goneS = new Set(old.sessions.map((s) => s.id));
      return {
        ...db, tasks: db.tasks.filter((t) => !goneT.has(t.id)),
        focusSessions: db.focusSessions.filter((s) => !goneS.has(s.id)).map((s) => (goneT.has(s.taskId) ? { ...s, taskId: null } : s)),
        archive: { tasks: db.archive.tasks + old.tasks.length, sessions: db.archive.sessions + old.sessions.length, focusSec: db.archive.focusSec + old.sessions.reduce((x, s) => x + s.duration, 0), lastAt: a.at }
      };
    }
    case 'UNDO_PATCH': { // undo exactly one action, keeping every change made after it
      const next = { ...db };
      for (const c of COLLECTIONS) {
        const gone = new Set(a.patch.remove[c] || []), back = a.patch.restore[c] || [];
        if (!gone.size && !back.length) continue;
        const backIds = new Map(back.map((x) => [x.id, x])), seen = new Set();
        const rows = db[c].filter((x) => !gone.has(x.id)).map((x) => (backIds.has(x.id) ? (seen.add(x.id), backIds.get(x.id)) : x));
        next[c] = [...back.filter((x) => !seen.has(x.id)), ...rows];
      }
      if (a.patch.settings) next.settings = a.patch.settings;
      if (a.patch.archive) next.archive = a.patch.archive;
      return next;
    }
    case 'ADD_SESSION': return { ...db, focusSessions: [a.session, ...db.focusSessions] };
    case 'SET_SETTINGS': return { ...db, settings: { ...db.settings, ...a.patch } };
    case 'SIMULATE': return {
      ...db, tasks: [...db.tasks, ...a.tasks], focusSessions: [...db.focusSessions, ...a.sessions],
      habits: db.habits.map((h) => {
        const logs = { ...h.logs };
        for (const d of a.habitDays[h.id] || []) if (!logs[d]) logs[d] = 2; // 2 = simulated entry, removable
        return { ...h, logs };
      })
    };
    case 'CLEAR_SIM': return {
      ...db, tasks: db.tasks.filter((t) => !t.sim), focusSessions: db.focusSessions.filter((s) => !s.sim),
      habits: db.habits.map((h) => ({ ...h, logs: Object.fromEntries(Object.entries(h.logs).filter(([, v]) => v !== 2)) }))
    };
    default: return db;
  }
}

const COLLECTIONS = ['tasks', 'focusSessions', 'habits', 'lists', 'folders', 'tags', 'countdowns', 'smartFilters'];
// Record exactly the rows an action added / changed / removed, so that action alone can be undone
function diffDb(prev, next) {
  const patch = { restore: {}, remove: {}, settings: prev.settings !== next.settings ? prev.settings : null, archive: prev.archive !== next.archive ? prev.archive : null };
  for (const c of COLLECTIONS) {
    if (prev[c] === next[c]) continue;
    const before = new Map(prev[c].map((x) => [x.id, x])), after = new Map(next[c].map((x) => [x.id, x]));
    patch.restore[c] = prev[c].filter((x) => after.get(x.id) !== x);
    patch.remove[c] = next[c].filter((x) => !before.has(x.id)).map((x) => x.id);
  }
  return patch;
}

// ==========================================
// 1G. SELECTORS — one view matcher shared by filtering and badge counts (v2 miscounted "Next 7 days")
// ==========================================
function matchesView(task, viewId, ctx) {
  if (viewId === 'SMART_TRASH') return task.isDeleted;
  if (task.isDeleted) return false;
  if (viewId === 'SEARCH_ALL') return true; // search everything, notes included
  if (viewId === 'SMART_NOTES') return task.isNote;
  if (viewId === 'SMART_ALL') return !task.isNote;
  if (viewId === 'SMART_TODAY') return !task.isNote && !!task.dueDate && task.dueDate <= ctx.today;
  if (viewId === 'SMART_NEXT7') return !task.isNote && !!task.dueDate && task.dueDate >= ctx.today && task.dueDate <= ctx.next7;
  if (viewId === 'SMART_INBOX') return !task.isNote && !task.listId;
  if (viewId.startsWith('TAG_')) return task.tags.includes(viewId.slice(4));
  if (viewId.startsWith('FILTER_')) {
    const f = ctx.filters.get(viewId.slice(7));
    if (!f || task.isNote) return false;
    if (f.priority !== -1 && task.priority !== f.priority) return false;
    if (f.tagId && !task.tags.includes(f.tagId)) return false;
    if (f.onlyOverdueOrToday && (!task.dueDate || task.dueDate > ctx.today)) return false;
    return true;
  }
  return task.listId === viewId;
}

function compareTasks(a, b) {
  if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
  if (a.isCompleted) return (b.completedAt || '').localeCompare(a.completedAt || '');
  if (b.priority !== a.priority) return b.priority - a.priority;
  const d = (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || (a.dueTime || '99').localeCompare(b.dueTime || '99');
  return d !== 0 ? d : (b.createdAt || '').localeCompare(a.createdAt || '');
}

function selectTasks(db, viewId, query, today) {
  const ctx = { today, next7: addDays(today, 7), filters: new Map(db.smartFilters.map((f) => [f.id, f])) };
  const q = query.trim().toLowerCase();
  return db.tasks
    .filter((t) => matchesView(t, viewId, ctx) && (!q || t.title.toLowerCase().includes(q) || t.content.toLowerCase().includes(q)))
    .sort(compareTasks);
}

// Count every badge in ONE pass (v2 re-scanned the whole array ~12 times per render)
function computeCounts(db, today) {
  const next7 = addDays(today, 7);
  const c = { SMART_TODAY: 0, SMART_NEXT7: 0, SMART_INBOX: 0, SMART_ALL: 0, SMART_NOTES: 0, SMART_TRASH: 0, SMART_COUNTDOWN: db.countdowns.length, lists: {}, done: 0, byDate: {} };
  for (const t of db.tasks) {
    if (t.isDeleted) { c.SMART_TRASH++; continue; }
    if (t.isNote) { c.SMART_NOTES++; continue; }
    if (t.isCompleted) { c.done++; continue; }
    c.SMART_ALL++;
    if (t.listId) c.lists[t.listId] = (c.lists[t.listId] || 0) + 1; else c.SMART_INBOX++;
    if (t.dueDate) {
      c.byDate[t.dueDate] = (c.byDate[t.dueDate] || 0) + 1;
      if (t.dueDate <= today) c.SMART_TODAY++;
      if (t.dueDate >= today && t.dueDate <= next7) c.SMART_NEXT7++;
    }
  }
  return c;
}

// Habit streaks follow each habit's schedule: unscheduled days don't break the streak
function habitStats(habit, today) {
  const days = habit.days && habit.days.length ? habit.days : ALL_DAYS;
  const sched = (d) => days.includes(parseDateStr(d).getDay());
  const has = (d) => !!habit.logs[d];
  const keys = Object.keys(habit.logs).sort();
  let current = 0, best = 0, run = 0;
  if (keys.length) {
    for (let d = today; d >= keys[0]; d = addDays(d, -1)) { if (has(d)) current++; else if (sched(d) && d !== today) break; }
    for (let d = keys[0]; d <= today; d = addDays(d, 1)) { if (has(d)) { run++; if (run > best) best = run; } else if (sched(d) && d !== today) run = 0; }
  }
  let done30 = 0, sched30 = 0;
  for (let i = 0; i < 30; i++) { const d = addDays(today, -i); if (sched(d)) sched30++; if (has(d)) done30++; }
  return { current, best, total: keys.length, rate30: sched30 ? Math.min(100, Math.round((done30 / sched30) * 100)) : 0 };
}

function focusByList(db, sessions) {
  const taskList = new Map(db.tasks.map((t) => [t.id, t.listId]));
  const listName = new Map(db.lists.map((l) => [l.id, l.name]));
  const acc = new Map();
  for (const s of sessions) {
    const name = !s.taskId ? 'Free session' : listName.get(taskList.get(s.taskId)) || 'Inbox';
    acc.set(name, (acc.get(name) || 0) + s.duration);
  }
  return [...acc].map(([name, sec]) => ({ name, minutes: Math.round(sec / 60) })).sort((a, b) => b.minutes - a.minutes);
}

// Completed tasks and focus sessions older than the cutoff → eligible for the archive file
function selectArchivable(db, cutoff) {
  const tasks = db.tasks.filter((t) => !t.isNote && t.isCompleted && ((t.completedAt && isoToLocalDate(t.completedAt)) || t.dueDate || isoToLocalDate(t.createdAt) || '9999') < cutoff);
  const sessions = db.focusSessions.filter((s) => (isoToLocalDate(s.startTime) || '9999') < cutoff);
  return { tasks, sessions };
}

// .ics file so the iPhone reminds you through the Calendar app — the only reminder method that needs no server
function buildIcs(tasks, leadMin, nowIso) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const stamp = `${nowIso.replace(/[-:]/g, '').slice(0, 15)}Z`;
  const ymd = (d) => d.replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TickLocal//v4//EN', 'CALSCALE:GREGORIAN'];
  for (const t of tasks) {
    if (!t.dueDate) continue;
    lines.push('BEGIN:VEVENT', `UID:${t.id}@ticklocal`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(t.title)}`);
    if (t.content) lines.push(`DESCRIPTION:${esc(t.content.slice(0, 500))}`);
    if (t.dueTime) lines.push(`DTSTART:${ymd(t.dueDate)}T${t.dueTime.replace(':', '')}00`, 'DURATION:PT30M');
    else lines.push(`DTSTART;VALUE=DATE:${ymd(t.dueDate)}`, `DTEND;VALUE=DATE:${ymd(addDays(t.dueDate, 1))}`);
    if (t.recurrenceRule !== 'NONE' && t.recurrenceType !== 1) {
      const n = t.recurrenceInterval || 1;
      lines.push(`RRULE:${{ DAILY: `FREQ=DAILY;INTERVAL=${n}`, WEEKLY: `FREQ=WEEKLY;INTERVAL=${n}`, MONTHLY: `FREQ=MONTHLY;INTERVAL=${n}`, WEEKDAYS: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }[t.recurrenceRule]}`);
    }
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(t.title)}`, `TRIGGER:${t.dueTime ? `-PT${Math.max(0, leadMin)}M` : 'PT8H'}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function buildReview(db, days, today) {
  const start = addDays(today, -(days - 1));
  const inRange = (d) => !!d && d >= start && d <= today;
  const live = db.tasks.filter((t) => !t.isDeleted && !t.isNote);
  const completed = live.filter((t) => t.isCompleted && inRange(t.completedAt ? isoToLocalDate(t.completedAt) : t.dueDate));
  const pending = live.filter((t) => !t.isCompleted && t.dueDate && t.dueDate <= today).sort(compareTasks);
  const listName = new Map(db.lists.map((l) => [l.id, l.name]));
  const groups = new Map();
  for (const t of completed) {
    const k = listName.get(t.listId) || 'Inbox';
    groups.set(k, [...(groups.get(k) || []), t]);
  }
  const sessions = db.focusSessions.filter((s) => inRange(isoToLocalDate(s.startTime)));
  const focusMinutes = Math.round(sessions.reduce((a, s) => a + s.duration, 0) / 60);
  const range = Array.from({ length: days }, (_, i) => addDays(start, i));
  const habits = db.habits.map((h) => {
    const done = range.filter((d) => h.logs[d]).length;
    const planned = range.filter((d) => (h.days || ALL_DAYS).includes(parseDateStr(d).getDay())).length;
    return { name: h.name, icon: h.icon, done, planned, rate: planned ? Math.min(100, Math.round((done / planned) * 100)) : 0 };
  });
  const byList = focusByList(db, sessions);
  const habitRate = habits.length ? Math.round(habits.reduce((a, h) => a + h.rate, 0) / habits.length) : 0;

  let md = `# ${days}-day review (${start} → ${today})\n\n`;
  md += `## 1. Key metrics\n- Completed: **${completed.length} tasks**\n- Due/overdue, not done: **${pending.length} tasks**\n- Focus: **${focusMinutes} min** (${sessions.length} sessions)\n- Average habit rate: **${habitRate}%**\n\n`;
  md += `## 2. Completed tasks by list\n`;
  if (!groups.size) md += `_No tasks completed in this period._\n`;
  for (const [name, items] of groups) {
    md += `### ${name} (${items.length})\n`;
    items.slice(0, 15).forEach((t) => { md += `- [x] ${t.title}\n`; });
    if (items.length > 15) md += `- … and ${items.length - 15} more\n`;
  }
  md += `\n## 3. Habits\n`;
  habits.forEach((h) => { md += `- ${h.icon} ${h.name}: ${h.done}/${h.planned} scheduled days (${h.rate}%)\n`; });
  if (byList.length) {
    md += `\n## Focus time by list\n`;
    byList.forEach((r) => { md += `- ${r.name}: ${r.minutes} min\n`; });
  }
  if (pending.length) {
    md += `\n## 4. Still to do\n`;
    pending.slice(0, 8).forEach((t) => { md += `- [ ] ${t.title} (due ${t.dueDate})\n`; });
  }
  return { days, start, end: today, completedCount: completed.length, pendingCount: pending.length, focusMinutes, sessionsCount: sessions.length, habitRate, byList, markdown: md, title: `${days}-day review (${start} → ${today})` };
}

// The timer uses real timestamps, not tick counting → no drift when the screen locks or the tab changes
const IDLE_TIMER = { mode: 'POMODORO', phase: 'FOCUS', running: false, endAt: null, remainMs: null, startedAt: null, elapsedMs: 0, sessionStart: null, taskId: null, round: 0 };
const phaseMs = (phase, s) => (phase === 'FOCUS' ? s.focusMin : phase === 'SHORT' ? s.shortMin : s.longMin) * 60000;
const timerMs = (t, s, now) => (t.mode === 'STOPWATCH'
  ? t.elapsedMs + (t.running ? now - t.startedAt : 0)
  : t.running ? Math.max(0, t.endAt - now) : (t.remainMs ?? phaseMs(t.phase, s)));
const fmtClock = (ms, up) => {
  const total = up ? Math.floor(ms / 1000) : Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
};

export {
  pad2, MONTHS, toDateStr, parseDateStr, isDateStr, isTimeStr, todayStr, addDays, addMonths, diffDays, isoToLocalDate, fmtDate,
  SCHEMA, STORAGE_KEY, LEGACY_KEYS, TIMER_KEY, RULES, RULE_LABEL, WEEKDAY_SHORT, ALL_DAYS, ruleLabel, PALETTE, EMOJIS, NOISES, PRIORITY,
  DEFAULT_SETTINGS, SMART, uid, clampInt, nearestTag, parseQuickAdd, nextDueDate, makeTask, seedData, normalizeDb, reducer,
  diffDb, matchesView, compareTasks, selectTasks, computeCounts, habitStats, focusByList, selectArchivable, buildIcs, buildReview,
  IDLE_TIMER, phaseMs, timerMs, fmtClock
};
