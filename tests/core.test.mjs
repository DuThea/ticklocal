// Chạy test theo giờ Việt Nam trên mọi máy (PowerShell không hỗ trợ cú pháp TZ=... trước lệnh)
process.env.TZ = 'Asia/Ho_Chi_Minh';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core.js';

const T = '2026-11-16'; // thứ Hai
const tags = [{ id: 'bn', name: 'bệnh-nhân' }, { id: 'k', name: 'khmer' }, { id: 'u', name: 'urgent' }];
const P = (s) => C.parseQuickAdd(s, tags, T);
const task = (p) => C.makeTask({ id: 'x', title: 't', ...p }, '2026-11-16T01:00:00.000Z');

test('múi giờ test là GMT+7', () => assert.equal(new Date().getTimezoneOffset(), -420));
test('ngày địa phương', () => {
  assert.equal(C.toDateStr(new Date(2026, 10, 16, 1, 0)), T);
  assert.equal(C.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(C.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(C.addMonths('2026-02-28', 1, 31), '2026-03-31');
});

test('lặp: ngày, tuần, mỗi N', () => {
  assert.equal(C.nextDueDate(task({ dueDate: T, recurrenceRule: 'DAILY' }), T), '2026-11-17');
  assert.equal(C.nextDueDate(task({ dueDate: T, recurrenceRule: 'WEEKLY' }), T), '2026-11-23');
  assert.equal(C.nextDueDate(task({ dueDate: T, recurrenceRule: 'DAILY', recurrenceInterval: 3 }), T), '2026-11-19');
  assert.equal(C.nextDueDate(task({ dueDate: T, recurrenceRule: 'WEEKLY', recurrenceInterval: 2 }), T), '2026-11-30');
  assert.equal(C.nextDueDate(task({ dueDate: '2026-11-01', recurrenceRule: 'DAILY', recurrenceType: 1 }), T), '2026-11-17');
  assert.equal(C.nextDueDate(task({ dueDate: '2026-11-10', recurrenceRule: 'DAILY' }), T), T);
});
test('lặp ngày thường bỏ qua cuối tuần', () => {
  assert.equal(C.nextDueDate(task({ dueDate: '2026-11-20', recurrenceRule: 'WEEKDAYS' }), '2026-11-20'), '2026-11-23');
  assert.equal(C.nextDueDate(task({ dueDate: '2026-11-18', recurrenceRule: 'WEEKDAYS' }), '2026-11-18'), '2026-11-19');
  // 3 năm hoàn thành liên tục: không bao giờ rơi vào thứ Bảy/Chủ nhật
  let t = task({ dueDate: T, recurrenceRule: 'WEEKDAYS' });
  for (let i = 0; i < 800; i++) { const d = C.nextDueDate(t, t.dueDate); assert.ok(![0, 6].includes(C.parseDateStr(d).getDay())); t = { ...t, dueDate: d }; }
});
test('lặp hàng tháng giữ ngày gốc 31 (lỗi trôi về 28 của v3)', () => {
  let t = task({ dueDate: '2026-12-31', recurrenceRule: 'MONTHLY' });
  assert.equal(t.recurrenceDay, 31);
  const seen = [];
  for (let i = 0; i < 14; i++) { const d = C.nextDueDate(t, t.dueDate); seen.push(d.slice(5)); t = { ...t, dueDate: d }; }
  assert.deepEqual(seen, ['01-31', '02-28', '03-31', '04-30', '05-31', '06-30', '07-31', '08-31', '09-30', '10-31', '11-30', '12-31', '01-31', '02-29']);
});
test('reducer: dời hạn tạm không đổi ngày gốc, sửa hạn thật thì đổi', () => {
  let db = C.normalizeDb({ tasks: [] }).db;
  db = C.reducer(db, { type: 'ADD_TASK', task: task({ dueDate: '2026-12-31', recurrenceRule: 'MONTHLY' }) });
  db = C.reducer(db, { type: 'UPDATE_TASK', id: 'x', patch: { dueDate: '2027-01-02' }, keepAnchor: true });
  assert.equal(db.tasks[0].recurrenceDay, 31);
  db = C.reducer(db, { type: 'TOGGLE_TASK', id: 'x', now: 'N', today: '2027-01-02', histId: 'h' });
  assert.equal(db.tasks.find((t) => t.id === 'x').dueDate, '2027-01-31');
  db = C.reducer(db, { type: 'UPDATE_TASK', id: 'x', patch: { dueDate: '2027-02-15' } });
  assert.equal(db.tasks.find((t) => t.id === 'x').recurrenceDay, 15);
  db = C.reducer(db, { type: 'UPDATE_TASK', id: 'x', patch: { recurrenceRule: 'NONE' } });
  assert.equal(db.tasks.find((t) => t.id === 'x').recurrenceDay, null);
});

test('parser: câu đầy đủ', () => {
  assert.deepEqual(P('Đưa BN S. khám tim mạch mai 9h30 #bệnh-nhân !cao'), { title: 'Đưa BN S. khám tim mạch', priority: 3, dueDate: '2026-11-17', dueTime: '09:30', recurrence: null, interval: 1, tagIds: ['bn'], newTagNames: [] });
});
test('parser: "2h" là thời lượng, không phải giờ hẹn (lỗi v3)', () => {
  for (const s of ['Backtest setup breakout 2h #khmer', 'Học 3h', 'Chạy bộ 1h mỗi ngày']) { const p = P(s); assert.equal(p.dueTime, null, s); assert.match(p.title, /\dh/); }
  assert.equal(P('Backtest 2h').dueDate, null);
});
test('parser: giờ hợp lệ', () => {
  const cases = { 'Họp 14:30': '14:30', 'Khám 9h30': '09:30', 'Đón BN lúc 7h': '07:00', 'Họp 3h chiều': '15:00', 'Giao ca 9h tối': '21:00', 'Ăn 12h trưa': '12:00', 'Gọi 8h sáng': '08:00', 'Trực 11h đêm': '23:00', 'Backtest 2h lúc 20h': '20:00', 'Họp 9am': null };
  for (const [s, want] of Object.entries(cases)) if (want) assert.equal(P(s).dueTime, want, s);
  assert.equal(P('Backtest 2h lúc 20h').title, 'Backtest 2h');
  assert.equal(P('Lúc 7h30 đón BN').title, 'đón BN');
  assert.equal(P('Họp 14:30').dueDate, T);
});
test('parser: phân số không phải ngày (lỗi v3), ngày thật vẫn nhận', () => {
  for (const s of ['Uống 1/2 viên thuốc', 'Giảm 3/4 liều', 'Pha 1/3 gói']) { assert.equal(P(s).dueDate, null, s); }
  assert.equal(P('Uống 1/2 viên thuốc').title, 'Uống 1/2 viên thuốc');
  assert.equal(P('Nộp hồ sơ ngày 1/2').dueDate, '2027-02-01');
  assert.equal(P('Nộp bản dịch 20/11').dueDate, '2026-11-20');
  assert.equal(P('Thi 5/3/2027').dueDate, '2027-03-05');
  assert.equal(P('Tết 1/1').dueDate, '2027-01-01');
  assert.equal(P('tỉ lệ 45/99').dueDate, null);
});
test('parser: ngày tương đối và thứ', () => {
  assert.equal(P('báo cáo thứ 5').dueDate, '2026-11-19');
  assert.equal(P('báo cáo thứ 2').dueDate, '2026-11-23');
  assert.equal(P('đi chơi chủ nhật').dueDate, '2026-11-22');
  assert.equal(P('Gọi BN mốt 15h30').dueDate, '2026-11-18');
  assert.equal(P('Gọi chị Mai').dueDate, null);
});
test('parser: kiểu lặp mới', () => {
  assert.deepEqual([P('Checklist phiên ngày thường').recurrence, P('Checklist phiên ngày thường').dueDate], ['WEEKDAYS', T]);
  assert.equal(C.parseQuickAdd('Checklist thứ 2-6', tags, '2026-11-21').dueDate, '2026-11-23');
  assert.deepEqual([P('Tưới cây mỗi 2 ngày').recurrence, P('Tưới cây mỗi 2 ngày').interval, P('Tưới cây mỗi 2 ngày').title], ['DAILY', 2, 'Tưới cây']);
  assert.deepEqual([P('Họp nhóm mỗi 2 tuần thứ 6').recurrence, P('Họp nhóm mỗi 2 tuần thứ 6').interval, P('Họp nhóm mỗi 2 tuần thứ 6').dueDate], ['WEEKLY', 2, '2026-11-20']);
  assert.equal(P('Đóng tiền nhà 28/11 hàng tháng').recurrence, 'MONTHLY');
  assert.equal(P('thiền mỗi ngày').recurrence, 'DAILY');
});
test('gợi ý thẻ gần giống', () => {
  assert.equal(C.nearestTag('benh-nhan', tags).id, 'bn');
  assert.equal(C.nearestTag('benh-nhan12', tags).id, 'bn');
  assert.equal(C.nearestTag('urgnet', tags).id, 'u');
  assert.equal(C.nearestTag('kmer', tags).id, 'k');
  assert.equal(C.nearestTag('deep-work', tags), null);
  assert.equal(C.nearestTag('ខ្មែរ', tags), null);
});

const seed = C.seedData(T, '2026-11-16T03:00:00.000Z');
test('dữ liệu mẫu sạch và normalize ổn định', () => {
  const r = C.normalizeDb(seed); assert.equal(r.fixCount, 0); assert.deepEqual(r.db, { ...seed, lastUpdatedAt: r.db.lastUpdatedAt });
  assert.equal(seed.schemaVersion, 4); assert.deepEqual(seed.habits[0].days, [0, 1, 2, 3, 4, 5, 6]);
});
test('normalize sửa dữ liệu rác kiểu v2', () => {
  const r = C.normalizeDb({ tasks: [{ id: 'a', title: 'x', listId: 'nope', tags: ['zz'], dueDate: '2026-13-40', dueTime: '16:00', isAllDay: true, recurrenceRule: 'MONTHLY', recurrenceDay: null }, { id: 'a' }, null, { title: 'no id' }], habits: [{ id: 'h', days: [9, 1, 1, 'x'], logs: { bad: 1, '2026-11-01': 1 } }], focusSessions: [{ id: 's', taskId: 'gone', duration: '90' }], settings: { focusMin: null, remindLead: 0 } });
  const k = r.db.tasks[0];
  assert.deepEqual([r.db.tasks.length, k.listId, k.tags, k.dueDate, k.dueTime, k.recurrenceDay, k.recurrenceInterval], [1, null, [], null, null, null, 1]);
  assert.deepEqual(r.fixes, { orphanLists: 1, orphanTags: 1, orphanSessions: 1, orphanFolders: 0, dropped: 2, dupIds: 1 });
  assert.deepEqual(r.db.habits[0].days, [1]); assert.deepEqual(r.db.habits[0].logs, { '2026-11-01': 1 });
  assert.deepEqual([r.db.settings.focusMin, r.db.settings.remindLead, r.db.settings.lastBackupAt], [25, 0, null]);
  assert.deepEqual(r.db.archive, { tasks: 0, sessions: 0, focusSec: 0, lastAt: null });
});
test('reducer: việc lặp, xóa danh sách/thẻ, gộp thẻ', () => {
  let d = C.reducer(seed, { type: 'TOGGLE_TASK', id: 'task-3', now: 'N', today: T, histId: 'H' });
  assert.equal(d.tasks.find((x) => x.id === 'task-3').dueDate, '2026-11-17');
  assert.ok(d.tasks.find((x) => x.id === 'H').isCompleted);
  d = C.reducer(seed, { type: 'DELETE', coll: 'lists', id: 'l-1' }); assert.equal(C.normalizeDb(d).fixCount, 0);
  d = C.reducer(seed, { type: 'MERGE_TAG', from: 't-4', to: 't-1' });
  assert.ok(!d.tags.some((t) => t.id === 't-4')); assert.deepEqual(d.tasks.find((x) => x.id === 'task-1').tags, ['t-1']); assert.equal(C.normalizeDb(d).fixCount, 0);
  d = C.reducer(seed, { type: 'MERGE_TAG', from: 't-2', to: 't-3' }); assert.equal(d.smartFilters[0].tagId, 't-3');
});
test('đếm badge khớp với bộ lọc; tìm toàn bộ gồm ghi chú', () => {
  const c = C.computeCounts(seed, T);
  for (const v of ['SMART_TODAY', 'SMART_NEXT7', 'SMART_INBOX', 'SMART_ALL']) assert.equal(c[v], C.selectTasks(seed, v, '', T).filter((x) => !x.isCompleted).length, v);
  assert.equal(C.selectTasks(seed, 'SMART_ALL', 'kiến trúc', T).length, 0);
  assert.equal(C.selectTasks(seed, 'SEARCH_ALL', 'kiến trúc', T).length, 1);
});
test('thói quen theo lịch: cuối tuần không làm đứt chuỗi', () => {
  const wk = { days: [1, 2, 3, 4, 5], logs: {} };
  for (const d of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16']) wk.logs[d] = 1;
  assert.deepEqual([C.habitStats(wk, T).current, C.habitStats(wk, T).best], [6, 6]);
  assert.equal(C.habitStats({ days: [0, 1, 2, 3, 4, 5, 6], logs: wk.logs }, T).current, 1);
  const all = { logs: { '2026-11-16': 1, '2026-11-15': 1, '2026-11-14': 1, '2026-11-10': 1, '2026-11-09': 1, '2026-11-08': 1, '2026-11-07': 1 } };
  assert.deepEqual([C.habitStats(all, T).current, C.habitStats(all, T).best, C.habitStats(all, T).total], [3, 4, 7]);
  assert.equal(C.habitStats({ logs: { '2026-11-15': 1 } }, T).current, 1);
  assert.equal(C.habitStats({ logs: { '2026-11-14': 1 } }, T).current, 0);
  const full = { days: [1, 2, 3, 4, 5], logs: {} }; for (let i = 0; i < 30; i++) { const d = C.addDays(T, -i); if (![0, 6].includes(C.parseDateStr(d).getDay())) full.logs[d] = 1; }
  assert.equal(C.habitStats(full, T).rate30, 100);
});
test('lưu trữ việc cũ: chỉ lấy việc đã xong trước mốc, cộng dồn bộ đếm', () => {
  const old = new Date(2025, 5, 1, 9).toISOString(), recent = new Date(2026, 10, 1, 9).toISOString();
  let d = C.normalizeDb({ tasks: [{ id: 'o1', title: 'cũ', isCompleted: true, completedAt: old }, { id: 'o2', title: 'ghi chú cũ', isNote: true, createdAt: old }, { id: 'n1', title: 'mới', isCompleted: true, completedAt: recent }, { id: 'open', title: 'đang mở', createdAt: old }],
    focusSessions: [{ id: 's1', taskId: 'o1', duration: 1500, startTime: old }, { id: 's2', taskId: 'o1', duration: 600, startTime: recent }] }).db;
  const sel = C.selectArchivable(d, '2025-11-16'); assert.deepEqual([sel.tasks.map((t) => t.id), sel.sessions.map((s) => s.id)], [['o1'], ['s1']]);
  d = C.reducer(d, { type: 'ARCHIVE', cutoff: '2025-11-16', at: 'A' });
  assert.deepEqual(d.tasks.map((t) => t.id), ['o2', 'n1', 'open']);
  assert.deepEqual(d.focusSessions.map((s) => [s.id, s.taskId]), [['s2', null]]);
  assert.deepEqual(d.archive, { tasks: 1, sessions: 1, focusSec: 1500, lastAt: 'A' }); assert.equal(C.normalizeDb(d).fixCount, 0);
});
test('file .ics', () => {
  const ics = C.buildIcs([task({ id: 'a', title: 'Khám; tim, mạch', dueDate: '2026-11-17', dueTime: '09:00' }), task({ id: 'b', title: 'Cả ngày', dueDate: '2026-11-18', recurrenceRule: 'WEEKDAYS' }), task({ id: 'c', title: 'không hạn' })], 10, '2026-11-16T03:00:00.000Z');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /DTSTART:20261117T090000\r\nDURATION:PT30M/); assert.ok(ics.includes('SUMMARY:Khám\\; tim\\, mạch\r\n'));
  assert.match(ics, /TRIGGER:-PT10M/); assert.match(ics, /DTSTART;VALUE=DATE:20261118\r\nDTEND;VALUE=DATE:20261119/); assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR/);
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 2); assert.match(ics, /DTSTAMP:20261116T030000Z/);
});
test('báo cáo có giờ tập trung theo danh sách', () => {
  let d = C.reducer(seed, { type: 'TOGGLE_TASK', id: 'task-1', now: new Date(2026, 10, 16, 0, 30).toISOString(), today: T, histId: 'H' });
  d = C.reducer(d, { type: 'ADD_SESSION', session: { id: 'fs', taskId: 'task-1', duration: 1500, startTime: new Date(2026, 10, 16, 8).toISOString(), endTime: 'x', mode: 'POMODORO' } });
  const r = C.buildReview(d, 7, T); assert.equal(r.completedCount, 1); assert.deepEqual(r.byList, [{ name: 'Dự án iOS Local-First', minutes: 25 }]); assert.match(r.markdown, /Giờ tập trung theo danh sách/);
});
test('đồng hồ', () => {
  const s = seed.settings; assert.equal(C.timerMs(C.IDLE_TIMER, s, 0), 1500000);
  assert.equal(C.timerMs({ ...C.IDLE_TIMER, mode: 'STOPWATCH', running: true, startedAt: 1000, elapsedMs: 500 }, s, 3000), 2500);
  assert.equal(C.fmtClock(3723000, true), '1:02:03');
});
test('hoàn tác chỉ đảo đúng một thao tác, giữ thay đổi diễn ra sau đó', () => {
  const a1 = { type: 'TOGGLE_TASK', id: 'task-3', now: 'N', today: T, histId: 'H' };
  const after1 = C.reducer(seed, a1); const patch = C.diffDb(seed, after1);
  let d = C.reducer(after1, { type: 'ADD_TASK', task: C.makeTask({ id: 'later', title: 'thêm sau' }, 'N') });
  d = C.reducer(d, { type: 'UPDATE_TASK', id: 'task-1', patch: { title: 'sửa sau' } });
  d = C.reducer(d, { type: 'UNDO_PATCH', patch });
  assert.equal(d.tasks.find((x) => x.id === 'task-3').dueDate, T); assert.ok(!d.tasks.some((x) => x.id === 'H'));
  assert.ok(d.tasks.some((x) => x.id === 'later')); assert.equal(d.tasks.find((x) => x.id === 'task-1').title, 'sửa sau');
  const del = { type: 'DELETE', coll: 'tags', id: 't-2' }; const p2 = C.diffDb(seed, C.reducer(seed, del));
  const back = C.reducer(C.reducer(seed, del), { type: 'UNDO_PATCH', patch: p2 });
  assert.deepEqual(back.tags.map((x) => x.id).sort(), seed.tags.map((x) => x.id).sort()); assert.deepEqual(back.tasks, seed.tasks); assert.deepEqual(back.smartFilters, seed.smartFilters);
  const rep = { type: 'REPLACE', db: C.normalizeDb({ tasks: [] }).db }; const p3 = C.diffDb(seed, C.reducer(seed, rep));
  const back3 = C.reducer(C.reducer(seed, rep), { type: 'UNDO_PATCH', patch: p3 }); assert.equal(back3.tasks.length, seed.tasks.length); assert.equal(C.normalizeDb(back3).fixCount, 0);
});
