/* TickLocal v4 — lõi thuần: ngày tháng, parser, bộ lặp, normalize, reducer, selector. Không đụng DOM, không đụng lưu trữ. */

// ==========================================
// 1A. NGÀY THÁNG — luôn theo giờ địa phương, chuỗi YYYY-MM-DD
// (v2 dùng toISOString() = giờ UTC nên lệch 1 ngày ở GMT+7)
// ==========================================
const pad2 = (n) => String(n).padStart(2, '0');
const toDateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDateStr = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const isDateStr = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && toDateStr(parseDateStr(s)) === s;
const isTimeStr = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const todayStr = () => toDateStr(new Date());
const addDays = (s, n) => { const d = parseDateStr(s); d.setDate(d.getDate() + n); return toDateStr(d); };
const diffDays = (a, b) => Math.round((parseDateStr(a) - parseDateStr(b)) / 86400000);
const isoToLocalDate = (iso) => { const d = new Date(iso); return isNaN(d) ? null : toDateStr(d); };
// Cộng tháng có kẹp ngày: 31/01 + 1 tháng = 28/02 (v2 nhảy sang 03/03)
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
  if (diff === 0) return 'Hôm nay';
  if (diff === 1) return 'Ngày mai';
  if (diff === -1) return 'Hôm qua';
  const [y, m, d] = s.split('-');
  return y === today.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${y}`;
};

// ==========================================
// 1B. HẰNG SỐ
// ==========================================
const SCHEMA = 4;
const STORAGE_KEY = 'TICKLOCAL_IOS_DB_V4'; // chỉ dùng khi trình duyệt không có IndexedDB
const LEGACY_KEYS = ['TICKLOCAL_IOS_DB_V3', 'TICKLOCAL_IOS_DB_V2'];
const TIMER_KEY = 'TICKLOCAL_TIMER_V4';
const RULES = ['NONE', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY'];
const RULE_LABEL = { NONE: 'Không lặp', DAILY: 'Hàng ngày', WEEKDAYS: 'Ngày thường (T2–T6)', WEEKLY: 'Hàng tuần', MONTHLY: 'Hàng tháng' };
const WEEKDAY_SHORT = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const ruleLabel = (t) => {
  const n = t.recurrenceInterval || 1;
  if (n === 1 || t.recurrenceRule === 'WEEKDAYS' || t.recurrenceRule === 'NONE') return RULE_LABEL[t.recurrenceRule];
  return `Mỗi ${n} ${{ DAILY: 'ngày', WEEKLY: 'tuần', MONTHLY: 'tháng' }[t.recurrenceRule]}`;
};
const PALETTE = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#0EA5E9', '#EC4899', '#64748B'];
const EMOJIS = ['🔥', '💧', '📚', '🧘', '💻', '🏃', '🎯', '🚀', '🏆', '🛡️', '🎂', '✈️'];
const NOISES = [['OFF', 'Tắt'], ['WHITE', 'Ồn trắng'], ['PINK', 'Ồn hồng'], ['BROWN', 'Ồn nâu']];
const PRIORITY = {
  3: { label: 'Cao', border: 'border-red-500', hex: '#EF4444' },
  2: { label: 'Trung bình', border: 'border-amber-500', hex: '#F59E0B' },
  1: { label: 'Thấp', border: 'border-blue-500', hex: '#3B82F6' },
  0: { label: 'Không', border: 'border-slate-400', hex: '#94A3B8' }
};
const DEFAULT_SETTINGS = { darkMode: true, focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, noise: 'OFF', beep: true, viewMode: 'list', remind: true, remindLead: 10, lastBackupAt: null };
const SMART = {
  SMART_TODAY: 'Hôm nay', SMART_NEXT7: '7 ngày tới', SMART_INBOX: 'Hộp thư đến', SMART_ALL: 'Tất cả công việc',
  SMART_NOTES: 'Sổ tay ghi chú', SMART_COUNTDOWN: 'Đếm ngược', SMART_TRASH: 'Thùng rác'
};

let uidSeq = 0;
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${(uidSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clampInt = (v, lo, hi, dflt) => { const n = v === '' || v == null ? NaN : Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };

// ==========================================
// 1C. PARSER NHẬP NHANH (thuần, không AI)
// ==========================================
// Ranh giới từ có hỗ trợ tiếng Việt, không dùng lookbehind để chạy được trên Safari cũ
const tok = (pattern, flags = 'iu') => new RegExp(`(^|[^\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, flags);
const WEEKDAY = { 'hai': 1, '2': 1, 'ba': 2, '3': 2, 'tư': 3, 'tu': 3, '4': 3, 'năm': 4, 'nam': 4, '5': 4, 'sáu': 5, 'sau': 5, '6': 5, 'bảy': 6, 'bay': 6, '7': 6 };

const FRACTIONS = new Set(['1/2', '1/3', '2/3', '1/4', '3/4']);
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/[^a-z0-9]/g, '');
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// Thẻ có sẵn gần giống tên vừa gõ (bỏ dấu, sai ≤ 2 ký tự, hoặc thừa đuôi) → gợi ý thay vì tạo thẻ rác
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
  // Duyệt từng chỗ khớp; fn trả false = không phải thứ cần tìm, thử chỗ khớp kế tiếp
  const take = (re, fn) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m;
    while ((m = g.exec(text)) !== null) {
      if (fn(m) !== false) { text = `${text.slice(0, m.index)}${m[1]} ${text.slice(m.index + m[0].length)}`; return true; }
    }
    return false;
  };

  take(/(^|\s)!(high|cao|3|medium|med|tb|2|low|thap|thấp|1|none|0)(?=\s|$)/iu, (m) => {
    const v = m[2].toLowerCase();
    out.priority = ['high', 'cao', '3'].includes(v) ? 3 : ['medium', 'med', 'tb', '2'].includes(v) ? 2 : ['low', 'thap', 'thấp', '1'].includes(v) ? 1 : 0;
  });

  text = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_, pre, name) => {
    const slug = name.toLowerCase();
    const found = tags.find((t) => t.name.toLowerCase() === slug);
    if (found) { if (!out.tagIds.includes(found.id)) out.tagIds.push(found.id); }
    else if (!out.newTagNames.includes(slug)) out.newTagNames.push(slug);
    return `${pre} `;
  });

  const setRule = (rule) => () => { out.recurrence = rule; };
  take(tok('(?:mỗi|moi|every) (\\d{1,2}) (ngày|ngay|days?|tuần|tuan|weeks?|tháng|thang|months?)'), (m) => {
    const n = Number(m[2]), u = m[3].toLowerCase();
    if (n < 1) return false;
    out.recurrence = /^(ng|day)/.test(u) ? 'DAILY' : /^(tu|week)/.test(u) ? 'WEEKLY' : 'MONTHLY';
    out.interval = n;
    return true;
  })
    || take(tok('ngày thường|ngay thuong|weekdays?|thứ 2-6|t2-t6|thứ 2 đến thứ 6|thứ hai đến thứ sáu'), setRule('WEEKDAYS'))
    || take(tok('every day|daily|hàng ngày|hang ngay|mỗi ngày|moi ngay'), setRule('DAILY'))
    || take(tok('every week|weekly|hàng tuần|hang tuan|mỗi tuần|moi tuan'), setRule('WEEKLY'))
    || take(tok('every month|monthly|hàng tháng|hang thang|mỗi tháng|moi thang'), setRule('MONTHLY'));

  const setDate = (d) => () => { out.dueDate = d; };
  take(tok('hôm nay|hom nay|today|tod'), setDate(today))
    || take(tok('ngày kia|ngay kia|mốt'), setDate(addDays(today, 2)))
    || take(tok('ngày mai|ngay mai|tomorrow|tmr'), setDate(addDays(today, 1)))
    || take(tok('mai', 'u'), setDate(addDays(today, 1))) // chỉ khớp "mai" viết thường, tránh tên riêng "Mai"
    || take(tok('chủ nhật|chu nhat'), () => { const wd = parseDateStr(today).getDay(); out.dueDate = addDays(today, ((7 - wd) % 7) || 7); })
    || take(tok('thứ (hai|ba|tư|tu|năm|nam|sáu|sau|bảy|bay|[2-7])'), (m) => {
      const wd = parseDateStr(today).getDay();
      out.dueDate = addDays(today, ((WEEKDAY[m[2].toLowerCase()] - wd + 7) % 7) || 7);
    })
    || take(tok('(?:(ngày|ngay) )?(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}))?'), (m) => {
      // "1/2 viên", "3/4 liều" là phân số, không phải ngày — trừ khi viết rõ "ngày 1/2" hoặc có năm
      if (!m[2] && !m[5] && FRACTIONS.has(`${Number(m[3])}/${Number(m[4])}`)) return false;
      const year = m[5] ? Number(m[5]) : Number(today.slice(0, 4));
      let d = `${year}-${pad2(m[4])}-${pad2(m[3])}`;
      if (!isDateStr(d)) return false;
      if (!m[5] && d < today) d = addMonths(d, 12);
      out.dueDate = d;
      return true;
    });

  // Giờ: "14:30", "9h30" luôn là giờ. "9h" trần chỉ là giờ khi có "lúc" đứng trước hoặc sáng/trưa/chiều/tối đứng sau;
  // nếu không thì đó là thời lượng ("backtest 2h") và được giữ nguyên trong tiêu đề.
  take(tok('(?:(lúc|luc|vào lúc|vao luc) )?(\\d{1,2})(?:(:)(\\d{2})|h(\\d{2})?)(?: ?(am|pm|sáng|sang|trưa|trua|chiều|chieu|tối|toi|đêm|dem))?'), (m) => {
    if (!m[2] && !m[4] && !m[6] && !m[7]) return false;
    let h = Number(m[3]);
    const min = Number(m[5] || m[6] || 0);
    const sfx = (m[7] || '').toLowerCase();
    if (['pm', 'chiều', 'chieu', 'tối', 'toi'].includes(sfx) && h < 12) h += 12;
    else if (['trưa', 'trua'].includes(sfx) && h < 10) h += 12;
    else if (['đêm', 'dem'].includes(sfx) && h >= 6 && h < 12) h += 12;
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
// 1D. BỘ MÁY LẶP
// ==========================================
// Việc lặp hàng tháng giữ "ngày gốc" (recurrenceDay): hẹn ngày 31 → 28/02 → 31/03, không trôi dần về 28 như v3
function nextDueDate(t, today) {
  const rule = t.recurrenceRule, n = Math.max(1, t.recurrenceInterval || 1), fromDone = t.recurrenceType === 1;
  if (!RULES.includes(rule) || rule === 'NONE') return t.dueDate;
  const step = (s) => {
    if (rule === 'DAILY') return addDays(s, n);
    if (rule === 'WEEKLY') return addDays(s, 7 * n);
    if (rule === 'MONTHLY') {
      const anchor = fromDone ? undefined : t.recurrenceDay || undefined;
      // Hạn đang bị dời tạm trước ngày gốc trong cùng tháng → kỳ kế tiếp là ngày gốc của chính tháng đó
      const sameMonth = anchor && n === 1 ? addMonths(s, 0, anchor) : s;
      return sameMonth > s ? sameMonth : addMonths(s, n, anchor);
    }
    let d = addDays(s, 1); // WEEKDAYS: bỏ qua thứ Bảy, Chủ nhật
    while ([0, 6].includes(parseDateStr(d).getDay())) d = addDays(d, 1);
    return d;
  };
  if (fromDone || !t.dueDate) return step(today);
  let next = step(t.dueDate);
  // Quá hạn nhiều kỳ: nhảy thẳng tới kỳ chưa trôi qua thay vì bắt bấm hoàn thành từng kỳ
  for (let i = 0; i < 2000 && next < today; i++) next = step(next);
  return next;
}
const withAnchor = (t) => {
  const day = t.recurrenceRule === 'MONTHLY' && t.dueDate ? Number(t.dueDate.slice(8)) : null;
  return t.recurrenceDay === day ? t : { ...t, recurrenceDay: day };
};

// ==========================================
// 1E. DỮ LIỆU MẪU + NORMALIZE (một hàm dùng chung cho nạp / import / kiểm tra toàn vẹn)
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
    folders: [{ id: 'f-1', name: 'Công việc' }, { id: 'f-2', name: 'Cá nhân' }],
    lists: [
      { id: 'l-1', name: 'Dự án iOS Local-First', color: '#3B82F6', folderId: 'f-1' },
      { id: 'l-2', name: 'Vận hành & Họp', color: '#8B5CF6', folderId: 'f-1' },
      { id: 'l-3', name: 'Sức khỏe & Đời sống', color: '#10B981', folderId: 'f-2' },
      { id: 'l-4', name: 'Đọc sách & Học tập', color: '#F59E0B', folderId: 'f-2' }
    ],
    tags: [
      { id: 't-1', name: 'urgent', color: '#EF4444' }, { id: 't-2', name: 'deep-work', color: '#6366F1' },
      { id: 't-3', name: 'quick', color: '#10B981' }, { id: 't-4', name: 'coding', color: '#0EA5E9' }
    ],
    tasks: [
      t({ id: 'task-1', title: 'Thiết kế Database Schema GRDB với WAL mode', content: 'Cấu hình Write-Ahead Logging để tránh lock database khi Widget và App cùng truy cập.', listId: 'l-1', priority: 3, dueDate: today, dueTime: '10:00', tags: ['t-1', 't-4'],
        subtasks: [{ id: 'sub-1', title: 'Định nghĩa bảng TASK và SUBTASK', isCompleted: true }, { id: 'sub-2', title: 'Thiết lập Foreign Key Cascade Delete', isCompleted: true }, { id: 'sub-3', title: 'Viết Unit Test cho Concurrency', isCompleted: false }] }),
      t({ id: 'task-2', title: 'Viết Recurring Task Engine (clone lịch sử)', content: 'Hoàn thành task lặp → nhân bản 1 bản ghi Completed để giữ lịch sử, rồi dời DueDate của task gốc.', listId: 'l-1', priority: 3, dueDate: today, dueTime: '14:30', recurrenceRule: 'DAILY', recurrenceType: 1, tags: ['t-2', 't-4'] }),
      t({ id: 'task-3', title: 'Tập thể dục 30 phút', content: 'Chạy bộ hoặc nhảy dây tại nhà.', listId: 'l-3', priority: 2, dueDate: today, dueTime: '17:30', recurrenceRule: 'DAILY', tags: ['t-3'] }),
      t({ id: 'task-4', title: 'Kiểm tra giới hạn 64 Local Notifications của iOS', content: 'Chỉ đăng ký thông báo cho 14 ngày gần nhất qua BGAppRefreshTask.', listId: 'l-1', priority: 1, dueDate: addDays(today, 1), dueTime: '09:00', tags: ['t-4'] }),
      t({ id: 'task-5', title: 'Thanh toán hóa đơn Internet & Điện nước', content: 'Kiểm tra biên lai trên ứng dụng ngân hàng.', priority: 2, dueDate: addDays(today, -1), recurrenceRule: 'MONTHLY', tags: ['t-1'] }),
      t({ id: 'task-6', title: 'Ghi chú kiến trúc: vì sao không dùng AI trong bản Local-First?', content: '1. Riêng tư tuyệt đối, 100% offline.\n2. Không phụ thuộc API key hay phí server.\n3. Parser quy tắc là đủ để bóc ngày giờ tiếng Việt/Anh cơ bản.', listId: 'l-4', tags: ['t-2'], isNote: true })
    ],
    habits: [
      { id: 'h-1', name: 'Uống đủ 2L nước', icon: '💧', color: '#0EA5E9', logs: { [addDays(today, -2)]: 1, [addDays(today, -1)]: 1, [today]: 1 } },
      { id: 'h-2', name: 'Đọc sách 20 trang', icon: '📚', color: '#F59E0B', logs: { [addDays(today, -3)]: 1, [addDays(today, -1)]: 1 } },
      { id: 'h-3', name: 'Thiền định', icon: '🧘', color: '#10B981', logs: {} },
      { id: 'h-4', name: 'Viết DevLog', icon: '💻', color: '#8B5CF6', logs: { [addDays(today, -1)]: 1, [today]: 1 } }
    ],
    countdowns: [
      { id: 'cd-1', title: 'Ra mắt App iOS', targetDate: addDays(today, 30), icon: '🚀' },
      { id: 'cd-2', title: 'Backup năm & bảo dưỡng thiết bị', targetDate: addDays(today, 90), icon: '🛡️' }
    ],
    smartFilters: [{ id: 'sf-1', name: '🔥 Việc gấp & Deep Work', priority: 3, tagId: 't-2', onlyOverdueOrToday: true }],
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

  const folders = coll('folders').map((f) => ({ id: f.id, name: str(f.name, 'Thư mục') }));
  const folderIds = new Set(folders.map((f) => f.id));
  const lists = coll('lists').map((l) => {
    let folderId = l.folderId ?? null;
    if (folderId && !folderIds.has(folderId)) { folderId = null; fixes.orphanFolders++; }
    return { id: l.id, name: str(l.name, 'Danh sách'), color: str(l.color, PALETTE[0]), folderId };
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
      id: t.id, title: str(t.title).trim() || '(Không tiêu đề)', content: str(t.content), listId,
      isCompleted, isDeleted: !!t.isDeleted,
      priority: [0, 1, 2, 3].includes(Number(t.priority)) ? Number(t.priority) : 0,
      dueDate,
      // v2 có cờ isAllDay riêng; v3 quy ước "không có giờ = cả ngày"
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
    return { id: h.id, name: str(h.name, 'Thói quen'), icon: str(h.icon, '🔥'), color: str(h.color, PALETTE[0]), days: days.length ? days : ALL_DAYS, logs };
  });
  const countdowns = coll('countdowns').filter((c) => isDateStr(c.targetDate) || (fixes.dropped++, false))
    .map((c) => ({ id: c.id, title: str(c.title, 'Sự kiện'), targetDate: c.targetDate, icon: str(c.icon, '🎯') }));
  const smartFilters = coll('smartFilters').map((f) => {
    let tagId = f.tagId ?? null;
    if (tagId && !tagIds.has(tagId)) { tagId = null; fixes.orphanTags++; }
    return { id: f.id, name: str(f.name, 'Bộ lọc'), priority: [-1, 0, 1, 2, 3].includes(Number(f.priority)) ? Number(f.priority) : -1, tagId, onlyOverdueOrToday: !!f.onlyOverdueOrToday };
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
// 1F. REDUCER — thuần tuyệt đối (id, thời gian đều do action mang vào)
// ==========================================
function reducer(db, a) {
  const mapTask = (id, fn) => ({ ...db, tasks: db.tasks.map((t) => (t.id === id ? fn(t) : t)) });
  switch (a.type) {
    case 'REPLACE': return a.db;
    case 'ADD_TASK': return { ...db, tasks: [withAnchor(a.task), ...db.tasks], tags: a.newTags?.length ? [...db.tags, ...a.newTags] : db.tags };
    // keepAnchor: dời hạn tạm thời ("sang mai") không được đổi ngày gốc của việc lặp hàng tháng
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
    case 'UNDO_PATCH': { // hoàn tác đúng một thao tác, giữ nguyên mọi thay đổi diễn ra sau nó
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
        for (const d of a.habitDays[h.id] || []) if (!logs[d]) logs[d] = 2; // 2 = bản ghi giả lập, gỡ được
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
// Ghi lại đúng những bản ghi mà một thao tác đã thêm / sửa / xoá, để hoàn tác riêng thao tác đó
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
// 1G. SELECTOR — một hàm khớp view dùng cho cả lọc lẫn đếm badge (v2 đếm "7 ngày tới" sai)
// ==========================================
function matchesView(task, viewId, ctx) {
  if (viewId === 'SMART_TRASH') return task.isDeleted;
  if (task.isDeleted) return false;
  if (viewId === 'SEARCH_ALL') return true; // tìm toàn bộ, gồm cả ghi chú
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

// Đếm toàn bộ badge trong MỘT lượt duyệt (v2 duyệt lại cả mảng ~12 lần mỗi lần render)
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

// Chuỗi thói quen tính theo lịch của từng thói quen: ngày không nằm trong lịch không làm đứt chuỗi
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
    const name = !s.taskId ? 'Phiên tự do' : listName.get(taskList.get(s.taskId)) || 'Hộp thư đến';
    acc.set(name, (acc.get(name) || 0) + s.duration);
  }
  return [...acc].map(([name, sec]) => ({ name, minutes: Math.round(sec / 60) })).sort((a, b) => b.minutes - a.minutes);
}

// Việc đã xong và phiên tập trung cũ hơn mốc cutoff → đủ điều kiện đưa ra file lưu trữ
function selectArchivable(db, cutoff) {
  const tasks = db.tasks.filter((t) => !t.isNote && t.isCompleted && ((t.completedAt && isoToLocalDate(t.completedAt)) || t.dueDate || isoToLocalDate(t.createdAt) || '9999') < cutoff);
  const sessions = db.focusSessions.filter((s) => (isoToLocalDate(s.startTime) || '9999') < cutoff);
  return { tasks, sessions };
}

// File .ics để iPhone tự nhắc giờ qua app Lịch — cách nhắc duy nhất không cần máy chủ
function buildIcs(tasks, leadMin, nowIso) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const stamp = `${nowIso.replace(/[-:]/g, '').slice(0, 15)}Z`;
  const ymd = (d) => d.replace(/-/g, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TickLocal//v4//VI', 'CALSCALE:GREGORIAN'];
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
    const k = listName.get(t.listId) || 'Hộp thư đến';
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

  let md = `# Tổng kết ${days} ngày (${start} → ${today})\n\n`;
  md += `## 1. Chỉ số chính\n- Hoàn thành: **${completed.length} việc**\n- Đến hạn/quá hạn chưa xong: **${pending.length} việc**\n- Tập trung: **${focusMinutes} phút** (${sessions.length} phiên)\n- Thói quen trung bình: **${habitRate}%**\n\n`;
  md += `## 2. Việc đã xong theo danh sách\n`;
  if (!groups.size) md += `_Chưa có việc nào hoàn thành trong giai đoạn này._\n`;
  for (const [name, items] of groups) {
    md += `### ${name} (${items.length})\n`;
    items.slice(0, 15).forEach((t) => { md += `- [x] ${t.title}\n`; });
    if (items.length > 15) md += `- … và ${items.length - 15} việc khác\n`;
  }
  md += `\n## 3. Thói quen\n`;
  habits.forEach((h) => { md += `- ${h.icon} ${h.name}: ${h.done}/${h.planned} ngày theo lịch (${h.rate}%)\n`; });
  if (byList.length) {
    md += `\n## Giờ tập trung theo danh sách\n`;
    byList.forEach((r) => { md += `- ${r.name}: ${r.minutes} phút\n`; });
  }
  if (pending.length) {
    md += `\n## 4. Cần xử lý tiếp\n`;
    pending.slice(0, 8).forEach((t) => { md += `- [ ] ${t.title} (hạn ${t.dueDate})\n`; });
  }
  return { days, start, end: today, completedCount: completed.length, pendingCount: pending.length, focusMinutes, sessionsCount: sessions.length, habitRate, byList, markdown: md, title: `Tổng kết ${days} ngày (${start} → ${today})` };
}

// Timer tính theo mốc thời gian thật, không đếm tick → không trôi khi khoá máy / chuyển tab
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
  pad2, toDateStr, parseDateStr, isDateStr, isTimeStr, todayStr, addDays, addMonths, diffDays, isoToLocalDate, fmtDate,
  SCHEMA, STORAGE_KEY, LEGACY_KEYS, TIMER_KEY, RULES, RULE_LABEL, WEEKDAY_SHORT, ALL_DAYS, ruleLabel, PALETTE, EMOJIS, NOISES, PRIORITY,
  DEFAULT_SETTINGS, SMART, uid, clampInt, nearestTag, parseQuickAdd, nextDueDate, makeTask, seedData, normalizeDb, reducer,
  diffDb, matchesView, compareTasks, selectTasks, computeCounts, habitStats, focusByList, selectArchivable, buildIcs, buildReview,
  IDLE_TIMER, phaseMs, timerMs, fmtClock
};
