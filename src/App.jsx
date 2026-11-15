import React, { useState, useEffect, useMemo, useRef, useReducer, useCallback, useDeferredValue, createContext, useContext, memo } from 'react';
import {
  CheckCircle2, Plus, Calendar as CalendarIcon, Clock, Folder, List as ListIcon, Flame,
  Trash2, Edit3, Play, Pause, RotateCcw, Search, Filter, Layers, LayoutGrid,
  Kanban as KanbanIcon, CheckSquare, Download, Upload, Moon, Sun, ShieldCheck, RefreshCw, X, Check,
  Inbox, Star, CalendarDays, Hourglass, Database, Wrench, ArchiveRestore, Zap,
  FileText, Copy, ChevronLeft, ChevronRight, Bell, Archive
} from 'lucide-react';
import {
  toDateStr, parseDateStr, todayStr, addDays, addMonths, diffDays, isoToLocalDate, fmtDate,
  TIMER_KEY, RULES, RULE_LABEL, WEEKDAY_SHORT, ALL_DAYS, ruleLabel, PALETTE, EMOJIS, NOISES, PRIORITY, SMART,
  uid, clampInt, nearestTag, parseQuickAdd, nextDueDate, makeTask, seedData, normalizeDb, reducer,
  diffDb, compareTasks, selectTasks, computeCounts, habitStats, selectArchivable, buildIcs, buildReview,
  IDLE_TIMER, phaseMs, timerMs, fmtClock
} from './core.js';
import { safeStorage, openStore, requestPersistence, storageEstimate } from './storage.js';

/* TickLocal v4.0 — giao diện. Lõi thuần ở core.js, lưu trữ ở storage.js. */

const LONG_SESSION_MS = 3 * 3600000;

const loadTimer = () => {
  try {
    const t = JSON.parse(safeStorage.getItem(TIMER_KEY) || 'null');
    if (t && (t.mode === 'POMODORO' || t.mode === 'STOPWATCH')) return { ...IDLE_TIMER, ...t };
  } catch (e) { /* bỏ qua */ }
  return IDLE_TIMER;
};

const audio = (() => {
  let ctx = null, src = null, current = 'OFF';
  const ensure = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!ctx) ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch (e) { return null; }
  };
  const makeBuffer = (type) => {
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'BROWN') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3; }
      else if (type === 'PINK') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.06; }
      else d[i] = w * 0.2;
    }
    return buf;
  };
  const stop = () => { try { if (src) src.stop(); } catch (e) { /* đã dừng */ } src = null; };
  return {
    unlock: ensure, // phải gọi trong thao tác chạm của người dùng (yêu cầu của iOS Safari)
    setNoise(type) {
      if (type === current && (type === 'OFF' || src)) return;
      stop();
      current = type;
      if (type === 'OFF' || !ensure()) return;
      src = ctx.createBufferSource();
      src.buffer = makeBuffer(type);
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start();
    },
    beep() {
      if (!ensure()) return;
      [0, 0.25, 0.5].forEach((delay) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.25, ctx.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.2);
        o.connect(g); g.connect(ctx.destination);
        o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + 0.2);
      });
    }
  };
})();

// Bản xem thử trên claude.ai chạy trong khung sandbox: tải file phải qua capability "downloads", không có .ics
// eslint-disable-next-line no-undef
const IN_PREVIEW = typeof __TL_ARTIFACT__ !== 'undefined' && __TL_ARTIFACT__;

const downloadText = (name, text, mime) => {
  const a = document.createElement('a');
  let url = null;
  try { url = URL.createObjectURL(new Blob([text], { type: mime })); a.href = url; }
  catch (e) { a.href = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`; }
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  if (url) setTimeout(() => URL.revokeObjectURL(url), 2000);
};

async function saveFile(name, text, mime) {
  if (!IN_PREVIEW) { downloadText(name, text, mime); return { ok: true }; }
  let dl = null;
  try { dl = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
  if (!dl) return { ok: false, reason: 'Trang xem thử không cho tải file ở đây' };
  try { await dl.save({ filename: name, data: text }); return { ok: true }; }
  catch (e) {
    const code = e && e.code;
    return { ok: false, reason: code === 'declined' ? 'Đã huỷ tải file' : code === 'rejected_extension' ? 'Trang xem thử không tải được loại file này' : 'Không tải được file' };
  }
}

// Thông báo hệ thống: chỉ hoạt động khi app đang mở (hoặc vừa bị ẩn) và người dùng đã cấp quyền
const systemNotify = (title, body) => {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then((r) => r.showNotification(title, { body, tag: title })).catch(() => {});
    else new Notification(title, { body });
  } catch (e) { /* trình duyệt không hỗ trợ */ }
};

// ==========================================
// THÀNH PHẦN DÙNG CHUNG
// ==========================================
const THEMES = {
  dark: { app: 'bg-slate-950 text-slate-100', bar: 'bg-slate-900/95 border-slate-800', card: 'bg-slate-900 border-slate-800', inset: 'bg-slate-950 border-slate-800', field: 'bg-slate-950 border-slate-800 text-slate-100', ghost: 'text-slate-300 hover:bg-slate-800/70', chip: 'bg-slate-800 text-slate-300', soft: 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700', line: 'border-slate-800', muted: 'text-slate-400', hex: '#020617' },
  light: { app: 'bg-slate-100 text-slate-800', bar: 'bg-white/95 border-slate-200', card: 'bg-white border-slate-200', inset: 'bg-slate-50 border-slate-200', field: 'bg-slate-50 border-slate-200 text-slate-800', ghost: 'text-slate-700 hover:bg-slate-100', chip: 'bg-slate-200 text-slate-600', soft: 'bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200', line: 'border-slate-200', muted: 'text-slate-500', hex: '#f1f5f9' }
};
const ThemeCtx = createContext(THEMES.dark);
const useTheme = () => useContext(ThemeCtx);
const cx = (...parts) => parts.filter(Boolean).join(' ');
// text-base trên mobile: ô nhập < 16px làm iOS Safari tự zoom khi focus
const FIELD = 'w-full px-3 py-2 rounded-xl border outline-none text-base sm:text-sm focus:border-blue-500';

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return active ? now : Date.now();
}

function TimerText({ timer, settings, className }) {
  const now = useNow(timer.running);
  return <span className={className}>{fmtClock(timerMs(timer, settings, now), timer.mode === 'STOPWATCH')}</span>;
}

function TimerRing({ timer, settings }) {
  const now = useNow(timer.running);
  const frac = timer.mode === 'STOPWATCH' ? 0 : 1 - timerMs(timer, settings, now) / phaseMs(timer.phase, settings);
  const R = 118, C = 2 * Math.PI * R;
  return (
    <svg viewBox="0 0 256 256" className="absolute inset-0 w-full h-full -rotate-90" aria-hidden="true">
      <circle cx="128" cy="128" r={R} fill="none" stroke="currentColor" strokeWidth="8" className="opacity-10" />
      <circle cx="128" cy="128" r={R} fill="none" strokeWidth="8" strokeLinecap="round" stroke={timer.phase === 'FOCUS' ? '#F59E0B' : '#10B981'} strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, Math.max(0, frac)))} />
    </svg>
  );
}

// Ô số: gõ tự do, chỉ kẹp giá trị khi rời ô (v3 kẹp ngay từng phím nên xoá số là nhảy về 1)
function NumField({ value, min, max, onCommit, className, label }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  const commit = () => {
    const n = clampInt(text, min, max, value);
    setText(String(n));
    if (n !== value) onCommit(n);
  };
  return <input type="number" inputMode="numeric" min={min} max={max} value={text} aria-label={label} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} className={className} />;
}

function Modal({ children, onClose, wide, sheet }) {
  const th = useTheme();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={cx('fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-center', sheet ? 'items-end sm:items-center p-0 sm:p-4' : 'items-center p-4')} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className={cx('w-full border p-5 space-y-4 max-h-[88dvh] overflow-y-auto', wide ? 'max-w-lg' : 'max-w-md', sheet ? 'rounded-t-3xl sm:rounded-3xl' : 'rounded-3xl', th.card)} style={sheet ? { paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' } : undefined}>
        {children}
      </div>
    </div>
  );
}

function ConfirmDialog({ confirm, onClose }) {
  const th = useTheme();
  return (
    <Modal onClose={onClose}>
      <h3 className="font-bold text-sm">{confirm.title}</h3>
      <p className={cx('text-xs leading-relaxed whitespace-pre-line', th.muted)}>{confirm.body}</p>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={cx('px-4 py-2 rounded-xl text-xs font-semibold border', th.soft)}>Hủy</button>
        <button onClick={() => { confirm.onOk(); onClose(); }} className={cx('px-4 py-2 rounded-xl text-xs font-bold text-white', confirm.danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500')}>{confirm.okLabel || 'Đồng ý'}</button>
      </div>
    </Modal>
  );
}

// Hỏi trước khi tạo thẻ mới — v3 tự tạo nên sau 3 năm có 55 thẻ rác do gõ nhầm
function TagPrompt({ prompt, onClose }) {
  const th = useTheme();
  const [choice, setChoice] = useState(() => Object.fromEntries(prompt.names.map((n) => [n.name, n.suggest ? 'use' : 'new'])));
  return (
    <Modal onClose={onClose}>
      <h3 className="font-bold text-sm text-blue-400">Thẻ chưa có trong danh mục</h3>
      {prompt.names.map((n) => (
        <label key={n.name} className="block text-xs font-semibold">
          <span>#{n.name}</span>
          <select value={choice[n.name]} onChange={(e) => setChoice({ ...choice, [n.name]: e.target.value })} aria-label={`Xử lý thẻ ${n.name}`} className={cx(FIELD, 'mt-1', th.field)}>
            {n.suggest && <option value="use">Dùng thẻ có sẵn #{n.suggest.name}</option>}
            <option value="new">Tạo thẻ mới #{n.name}</option>
            <option value="skip">Bỏ thẻ này</option>
          </select>
        </label>
      ))}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className={cx('px-4 py-2 rounded-xl text-xs font-semibold border', th.soft)}>Quay lại sửa</button>
        <button onClick={() => { prompt.onDone(choice); onClose(); }} className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500">Thêm việc</button>
      </div>
    </Modal>
  );
}

const ENTITY = {
  FOLDER: { coll: 'folders', label: 'Thư mục', prefix: 'f' },
  LIST: { coll: 'lists', label: 'Danh sách', prefix: 'l' },
  TAG: { coll: 'tags', label: 'Thẻ', prefix: 't' },
  HABIT: { coll: 'habits', label: 'Thói quen', prefix: 'h' },
  COUNTDOWN: { coll: 'countdowns', label: 'Sự kiện đếm ngược', prefix: 'cd' },
  FILTER: { coll: 'smartFilters', label: 'Bộ lọc thông minh', prefix: 'sf' }
};

function EntityModal({ draft, db, onSave, onDelete, onMerge, onClose }) {
  const th = useTheme();
  const [d, setD] = useState(draft);
  const [mergeTo, setMergeTo] = useState('');
  const set = (patch) => setD((prev) => ({ ...prev, ...patch }));
  const meta = ENTITY[d.type];
  const submit = (e) => { e.preventDefault(); if (d.name.trim()) onSave({ ...d, name: d.name.trim() }); };
  const days = d.days || ALL_DAYS;
  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-blue-400">{d.id ? 'Sửa' : 'Tạo'} {meta.label.toLowerCase()}</h3>
          <button type="button" onClick={onClose} aria-label="Đóng" className={cx('p-1.5 rounded-lg', th.chip)}><X className="w-4 h-4" /></button>
        </div>
        <label className="block text-xs font-semibold">
          <span className={th.muted}>Tên gọi</span>
          <input autoFocus required value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Nhập tên..." className={cx(FIELD, 'mt-1', th.field)} />
        </label>
        {(d.type === 'LIST' || d.type === 'TAG' || d.type === 'HABIT') && (
          <div>
            <span className={cx('text-xs font-semibold', th.muted)}>Màu</span>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {PALETTE.map((c) => (
                <button type="button" key={c} onClick={() => set({ color: c })} aria-label={`Màu ${c}`} className={cx('w-8 h-8 rounded-full border-2', d.color === c ? 'border-white ring-2 ring-blue-500' : 'border-transparent')} style={{ backgroundColor: c }} />
              ))}
            </div>
          </div>
        )}
        {d.type === 'LIST' && (
          <label className="block text-xs font-semibold">
            <span className={th.muted}>Thư mục</span>
            <select value={d.folderId || ''} onChange={(e) => set({ folderId: e.target.value || null })} className={cx(FIELD, 'mt-1', th.field)}>
              <option value="">Không thuộc thư mục</option>
              {db.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        )}
        {(d.type === 'HABIT' || d.type === 'COUNTDOWN') && (
          <div>
            <span className={cx('text-xs font-semibold', th.muted)}>Biểu tượng</span>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {EMOJIS.map((ic) => (
                <button type="button" key={ic} onClick={() => set({ icon: ic })} className={cx('w-9 h-9 rounded-xl border flex items-center justify-center text-lg', d.icon === ic ? 'border-blue-500 bg-blue-500/20' : th.inset)}>{ic}</button>
              ))}
            </div>
          </div>
        )}
        {d.type === 'HABIT' && (
          <div>
            <span className={cx('text-xs font-semibold', th.muted)}>Làm vào các ngày</span>
            <div className="grid grid-cols-7 gap-1 mt-1.5">
              {[1, 2, 3, 4, 5, 6, 0].map((wd) => {
                const on = days.includes(wd);
                return <button type="button" key={wd} aria-pressed={on} onClick={() => { const next = on ? days.filter((x) => x !== wd) : [...days, wd].sort(); if (next.length) set({ days: next }); }} className={cx('py-2 rounded-lg border text-xs font-bold', on ? 'bg-blue-600 text-white border-blue-500' : th.soft)}>{WEEKDAY_SHORT[wd]}</button>;
              })}
            </div>
            <div className="flex gap-3 mt-2 text-xs text-blue-500">
              <button type="button" onClick={() => set({ days: [1, 2, 3, 4, 5] })}>Chỉ ngày thường</button>
              <button type="button" onClick={() => set({ days: ALL_DAYS })}>Mỗi ngày</button>
            </div>
          </div>
        )}
        {d.type === 'COUNTDOWN' && (
          <label className="block text-xs font-semibold">
            <span className={th.muted}>Ngày mục tiêu</span>
            <input type="date" required value={d.targetDate} onChange={(e) => set({ targetDate: e.target.value })} className={cx(FIELD, 'mt-1', th.field)} />
          </label>
        )}
        {d.type === 'FILTER' && (
          <>
            <label className="block text-xs font-semibold">
              <span className={th.muted}>Mức ưu tiên</span>
              <select value={d.priority} onChange={(e) => set({ priority: Number(e.target.value) })} className={cx(FIELD, 'mt-1', th.field)}>
                <option value={-1}>Tất cả</option><option value={3}>🔴 Cao</option><option value={2}>🟡 Trung bình</option><option value={1}>🔵 Thấp</option><option value={0}>Không đặt</option>
              </select>
            </label>
            <label className="block text-xs font-semibold">
              <span className={th.muted}>Thẻ</span>
              <select value={d.tagId || ''} onChange={(e) => set({ tagId: e.target.value || null })} className={cx(FIELD, 'mt-1', th.field)}>
                <option value="">Bất kỳ</option>
                {db.tags.map((t) => <option key={t.id} value={t.id}>#{t.name}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!d.onlyOverdueOrToday} onChange={(e) => set({ onlyOverdueOrToday: e.target.checked })} />
              Chỉ việc đến hạn hôm nay hoặc quá hạn
            </label>
          </>
        )}
        {d.type === 'TAG' && d.id && db.tags.length > 1 && (
          <div className={cx('p-3 rounded-xl border space-y-2', th.inset)}>
            <span className={cx('text-xs font-semibold', th.muted)}>Gộp thẻ này vào thẻ khác (mọi việc chuyển sang thẻ đích)</span>
            <div className="flex gap-2">
              <select value={mergeTo} onChange={(e) => setMergeTo(e.target.value)} aria-label="Thẻ đích" className={cx(FIELD, th.field)}>
                <option value="">Chọn thẻ đích…</option>
                {db.tags.filter((t) => t.id !== d.id).map((t) => <option key={t.id} value={t.id}>#{t.name}</option>)}
              </select>
              <button type="button" disabled={!mergeTo} onClick={() => onMerge(d.id, mergeTo)} className="px-3 py-2 rounded-xl text-xs font-bold bg-amber-500 text-slate-950 disabled:opacity-40 shrink-0">Gộp</button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          {d.id ? <button type="button" onClick={() => onDelete(d)} className="px-3 py-2 rounded-xl text-xs font-semibold bg-red-500/10 text-red-400 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Xóa</button> : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={cx('px-4 py-2 rounded-xl text-xs font-semibold border', th.soft)}>Hủy</button>
            <button type="submit" className="px-5 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white">Lưu</button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

const TaskRow = memo(function TaskRow({ task, list, tagsById, today, onOpen, onToggle, onFocus, onRestore, onPurge }) {
  const th = useTheme();
  const overdue = !task.isCompleted && task.dueDate && task.dueDate < today;
  const doneSubs = task.subtasks.filter((s) => s.isCompleted).length;
  return (
    <div onClick={() => onOpen(task.id)} className={cx('p-3.5 rounded-2xl border cursor-pointer flex items-start gap-3', th.card, task.isCompleted && 'opacity-60')}>
      {task.isNote ? (
        <div className="mt-0.5 p-1 rounded-lg bg-purple-500/10 text-purple-400"><Edit3 className="w-4 h-4" /></div>
      ) : (
        <button onClick={(e) => { e.stopPropagation(); onToggle(task.id); }} aria-label={task.isCompleted ? 'Bỏ hoàn thành' : 'Hoàn thành'}
          className={cx('mt-0.5 w-6 h-6 rounded-md border-2 flex items-center justify-center shrink-0', task.isCompleted ? 'bg-emerald-500 border-emerald-500 text-white' : PRIORITY[task.priority].border)}>
          {task.isCompleted && <Check className="w-4 h-4" strokeWidth={3} />}
        </button>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <h3 className={cx('text-sm font-medium truncate', task.isCompleted && 'line-through')}>{task.title}</h3>
          {list && <span className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0 max-w-[40%] truncate" style={{ backgroundColor: `${list.color}22`, color: list.color }}>{list.name}</span>}
        </div>
        {task.content && <p className={cx('text-xs truncate mt-0.5', th.muted)}>{task.content}</p>}
        {(task.dueDate || task.recurrenceRule !== 'NONE' || task.subtasks.length > 0 || task.tags.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
            {task.dueDate && (
              <span className={cx('flex items-center gap-1 px-2 py-0.5 rounded-md font-medium', overdue ? 'bg-red-500/15 text-red-400' : task.dueDate === today ? 'bg-emerald-500/15 text-emerald-500' : th.chip)}>
                <CalendarIcon className="w-3 h-3" />{overdue ? `Quá hạn ${fmtDate(task.dueDate, today)}` : fmtDate(task.dueDate, today)}{task.dueTime ? ` ${task.dueTime}` : ''}
              </span>
            )}
            {task.recurrenceRule !== 'NONE' && <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-400 font-medium"><RefreshCw className="w-3 h-3" />{ruleLabel(task)}</span>}
            {task.subtasks.length > 0 && <span className={cx('flex items-center gap-1 px-2 py-0.5 rounded-md', th.chip)}><CheckSquare className="w-3 h-3" />{doneSubs}/{task.subtasks.length}</span>}
            {task.tags.map((id) => tagsById.get(id) && <span key={id} className="font-medium" style={{ color: tagsById.get(id).color }}>#{tagsById.get(id).name}</span>)}
          </div>
        )}
      </div>
      {task.isDeleted ? (
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={(e) => { e.stopPropagation(); onRestore(task.id); }} className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-500 text-xs font-semibold flex items-center gap-1"><ArchiveRestore className="w-3.5 h-3.5" /> Khôi phục</button>
          <button onClick={(e) => { e.stopPropagation(); onPurge(task.id); }} aria-label="Xóa vĩnh viễn" className="p-2 rounded-lg bg-red-500/15 text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      ) : (!task.isNote && !task.isCompleted && (
        <button onClick={(e) => { e.stopPropagation(); onFocus(task.id); }} aria-label="Tập trung vào việc này" className="p-2 rounded-xl bg-amber-500/10 text-amber-500 shrink-0"><Play className="w-4 h-4 fill-current" /></button>
      ))}
    </div>
  );
});

function TaskSheet({ task, db, today, dispatch, onClose, onTrash, onRestore, onFocus, onDuplicate, onIcs }) {
  const th = useTheme();
  const [newSub, setNewSub] = useState('');
  const patch = useCallback((p, extra) => dispatch({ type: 'UPDATE_TASK', id: task.id, patch: p, ...extra }), [dispatch, task.id]);
  // Tiêu đề và mô tả gõ vào bản nháp; 300 ms sau mới ghi vào state chung → gõ không còn khựng khi dữ liệu lớn
  const [draft, setDraft] = useState({ title: task.title, content: task.content });
  const draftRef = useRef(draft); draftRef.current = draft;
  const taskRef = useRef(task); taskRef.current = task;
  const commit = useCallback(() => {
    const d = draftRef.current, t = taskRef.current, p = {};
    if (d.title !== t.title && d.title.trim()) p.title = d.title;
    if (d.content !== t.content) p.content = d.content;
    if (Object.keys(p).length) patch(p);
  }, [patch]);
  useEffect(() => { const id = setTimeout(commit, 300); return () => clearTimeout(id); }, [draft, commit]);
  useEffect(() => () => commit(), [commit]);

  // Bản đang hiển thị = dữ liệu đã lưu + phần nháp chưa kịp ghi (dùng cho Nhân bản và xuất lịch)
  const live = { ...task, title: draft.title.trim() || task.title, content: draft.content };
  const setSubs = (subtasks) => patch({ subtasks });
  const addSub = (e) => {
    e.preventDefault();
    if (!newSub.trim()) return;
    setSubs([...task.subtasks, { id: uid('sub'), title: newSub.trim(), isCompleted: false }]);
    setNewSub('');
  };
  const moveDue = (d) => patch({ dueDate: d }, { keepAnchor: true });
  const toNote = () => patch(task.isNote ? { isNote: false } : { isNote: true, dueDate: null, dueTime: null, recurrenceRule: 'NONE', priority: 0, isCompleted: false, completedAt: null });
  const sel = cx(FIELD, 'mt-1', th.field);
  const quick = cx('px-2.5 py-1.5 rounded-lg border text-xs font-semibold', th.soft);
  const hasInterval = ['DAILY', 'WEEKLY', 'MONTHLY'].includes(task.recurrenceRule);
  return (
    <Modal onClose={onClose} wide sheet>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-wider text-blue-400">{task.isNote ? 'Ghi chú' : 'Công việc'}{task.isDeleted ? ' (trong thùng rác)' : ''}</span>
        <div className="flex items-center gap-2">
          {!task.isNote && !task.isDeleted && !task.isCompleted && <button onClick={() => onFocus(task.id)} aria-label="Tập trung" className="p-2 rounded-lg bg-amber-500/10 text-amber-500"><Play className="w-4 h-4 fill-current" /></button>}
          {task.isDeleted
            ? <button onClick={() => onRestore(task.id)} className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-500 text-xs font-semibold">Khôi phục</button>
            : <button onClick={() => onTrash(task.id)} aria-label="Chuyển vào thùng rác" className="p-2 rounded-lg bg-red-500/10 text-red-400"><Trash2 className="w-4 h-4" /></button>}
          <button onClick={onClose} aria-label="Đóng" className={cx('p-2 rounded-lg', th.chip)}><X className="w-4 h-4" /></button>
        </div>
      </div>
      <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Tiêu đề" className={cx(FIELD, 'font-semibold', th.field)} />
      <textarea rows={task.isNote ? 10 : 3} value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} aria-label="Mô tả" placeholder="Mô tả chi tiết..." className={cx(FIELD, th.field)} />
      {!task.isDeleted && (
        <div className="flex flex-wrap gap-1.5">
          {!task.isNote && !task.isCompleted && (
            <>
              <button onClick={() => moveDue(today)} className={quick}>Hôm nay</button>
              <button onClick={() => moveDue(addDays(today, 1))} className={quick}>Dời sang mai</button>
              <button onClick={() => moveDue(addDays(task.dueDate && task.dueDate > today ? task.dueDate : today, 7))} className={quick}>+7 ngày</button>
            </>
          )}
          <button onClick={() => onDuplicate(live)} className={cx(quick, 'flex items-center gap-1')}><Copy className="w-3 h-3" /> Nhân bản</button>
          <button onClick={toNote} className={quick}>{task.isNote ? 'Chuyển thành việc' : 'Chuyển thành ghi chú'}</button>
          {!task.isNote && task.dueDate && !IN_PREVIEW && <button onClick={() => onIcs([live])} className={cx(quick, 'flex items-center gap-1')}><Bell className="w-3 h-3" /> Thêm vào Lịch iPhone</button>}
        </div>
      )}
      <label className="block text-[11px] font-semibold"><span className={th.muted}>Danh sách</span>
        <select value={task.listId || ''} onChange={(e) => patch({ listId: e.target.value || null })} className={sel}>
          <option value="">Hộp thư đến</option>
          {db.lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      {!task.isNote && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[11px] font-semibold"><span className={th.muted}>Ưu tiên</span>
            <select value={task.priority} onChange={(e) => patch({ priority: Number(e.target.value) })} className={sel}>
              <option value={0}>Không</option><option value={1}>🔵 Thấp</option><option value={2}>🟡 Trung bình</option><option value={3}>🔴 Cao</option>
            </select>
          </label>
          <label className="block text-[11px] font-semibold"><span className={th.muted}>Ngày đến hạn</span>
            <input type="date" value={task.dueDate || ''} onChange={(e) => patch(e.target.value ? { dueDate: e.target.value } : { dueDate: null, dueTime: null })} className={sel} />
          </label>
          <label className="block text-[11px] font-semibold"><span className={th.muted}>Giờ (bỏ trống = cả ngày)</span>
            <input type="time" value={task.dueTime || ''} onChange={(e) => patch({ dueTime: e.target.value || null, dueDate: task.dueDate || today })} className={sel} />
          </label>
          <label className="block text-[11px] font-semibold"><span className={th.muted}>Lặp lại</span>
            <select value={task.recurrenceRule} onChange={(e) => patch({ recurrenceRule: e.target.value, recurrenceInterval: e.target.value === 'WEEKDAYS' ? 1 : task.recurrenceInterval, dueDate: e.target.value !== 'NONE' && !task.dueDate ? today : task.dueDate })} className={sel}>
              {RULES.map((r) => <option key={r} value={r}>{RULE_LABEL[r]}</option>)}
            </select>
          </label>
          {hasInterval && (
            <label className="block text-[11px] font-semibold"><span className={th.muted}>Cách mỗi (1 = kỳ nào cũng lặp)</span>
              <NumField value={task.recurrenceInterval || 1} min={1} max={365} onCommit={(n) => patch({ recurrenceInterval: n })} label="Khoảng lặp" className={sel} />
            </label>
          )}
          {task.recurrenceRule !== 'NONE' && (
            <label className={cx('block text-[11px] font-semibold', !hasInterval && 'col-span-2')}><span className={th.muted}>Kỳ tiếp theo tính từ</span>
              <select value={task.recurrenceType} onChange={(e) => patch({ recurrenceType: Number(e.target.value) })} className={sel}>
                <option value={0}>Ngày đến hạn</option><option value={1}>Ngày hoàn thành</option>
              </select>
            </label>
          )}
        </div>
      )}
      {db.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {db.tags.map((t) => {
            const on = task.tags.includes(t.id);
            return <button key={t.id} onClick={() => patch({ tags: on ? task.tags.filter((x) => x !== t.id) : [...task.tags, t.id] })} className={cx('text-xs px-2.5 py-1 rounded-lg border', on ? 'text-white border-transparent' : th.soft)} style={on ? { backgroundColor: t.color } : undefined}>#{t.name}</button>;
          })}
        </div>
      )}
      {!task.isNote && (
        <div className={cx('space-y-2 pt-3 border-t', th.line)}>
          <span className="text-xs font-bold">Checklist ({task.subtasks.filter((s) => s.isCompleted).length}/{task.subtasks.length})</span>
          {task.subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <input type="checkbox" checked={sub.isCompleted} onChange={() => setSubs(task.subtasks.map((s) => (s.id === sub.id ? { ...s, isCompleted: !s.isCompleted } : s)))} className="w-4 h-4" />
              <input value={sub.title} onChange={(e) => setSubs(task.subtasks.map((s) => (s.id === sub.id ? { ...s, title: e.target.value } : s)))} aria-label="Tên bước" className={cx('flex-1 min-w-0 text-base sm:text-sm bg-transparent outline-none py-0.5', sub.isCompleted && 'line-through opacity-60')} />
              <button onClick={() => setSubs(task.subtasks.filter((s) => s.id !== sub.id))} aria-label="Xóa bước" className={cx('p-1', th.muted)}><X className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <form onSubmit={addSub} className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-blue-500 shrink-0" />
            <input value={newSub} onChange={(e) => setNewSub(e.target.value)} placeholder="Thêm bước rồi Enter" className="flex-1 min-w-0 text-base sm:text-sm bg-transparent outline-none py-1" />
          </form>
        </div>
      )}
    </Modal>
  );
}

function QuickAdd({ db, today, viewId, onAdd }) {
  const th = useTheme();
  const [text, setText] = useState('');
  const [priority, setPriority] = useState(0);
  const [date, setDate] = useState('');
  const [recurrence, setRecurrence] = useState('NONE');
  const [asNote, setAsNote] = useState(false);
  const isList = db.lists.some((l) => l.id === viewId);
  const noteMode = asNote || viewId === 'SMART_NOTES';
  const preview = useMemo(() => (text.trim() && !noteMode ? parseQuickAdd(text, db.tags, today) : null), [text, db.tags, today, noteMode]);
  const submit = (e) => {
    e.preventDefault();
    onAdd(text, {
      isNote: noteMode, priority, recurrence, listId: isList ? viewId : null,
      dueDate: date || (viewId === 'SMART_TODAY' || viewId === 'SMART_NEXT7' ? today : null),
      tagIds: viewId.startsWith('TAG_') ? [viewId.slice(4)] : []
    }, () => setText(''));
  };
  const sel = cx('px-2 py-1.5 rounded-lg border outline-none text-base sm:text-xs', th.field);
  return (
    <form onSubmit={submit} className={cx('p-3 rounded-2xl border focus-within:border-blue-500', th.card)}>
      <div className="flex items-center gap-2.5">
        <Plus className="w-5 h-5 text-blue-500 shrink-0" />
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Thêm việc mới" placeholder={noteMode ? 'Tiêu đề ghi chú...' : "Thêm việc... vd: 'Họp nhóm mai 9h30 !cao #urgent'"} className="w-full min-w-0 bg-transparent text-base sm:text-sm outline-none" />
        <button type="submit" disabled={!text.trim()} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold shrink-0">Thêm</button>
      </div>
      {preview && (preview.priority !== null || preview.dueDate || preview.recurrence || preview.tagIds.length > 0 || preview.newTagNames.length > 0) && (
        <div className="mt-2 px-2.5 py-1.5 rounded-xl bg-blue-500/10 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="font-semibold">"{preview.title || '…'}"</span>
          {preview.priority !== null && <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-500">Ưu tiên: {PRIORITY[preview.priority].label}</span>}
          {preview.dueDate && <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600">Hạn: {fmtDate(preview.dueDate, today)}{preview.dueTime ? ` ${preview.dueTime}` : ''}</span>}
          {preview.recurrence && <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600">Lặp: {ruleLabel({ recurrenceRule: preview.recurrence, recurrenceInterval: preview.interval })}</span>}
          {preview.tagIds.map((id) => <span key={id} className="text-blue-500">#{db.tags.find((t) => t.id === id)?.name}</span>)}
          {preview.newTagNames.map((n) => <span key={n} className="text-amber-500">#{n} (chưa có — sẽ hỏi lại)</span>)}
        </div>
      )}
      {!noteMode && (
        <div className={cx('flex flex-wrap items-center gap-2 mt-2.5 pt-2 border-t text-[11px]', th.line, th.muted)}>
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} aria-label="Ưu tiên" className={sel}>
            <option value={0}>Ưu tiên: Không</option><option value={1}>🔵 Thấp</option><option value={2}>🟡 Trung bình</option><option value={3}>🔴 Cao</option>
          </select>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Ngày đến hạn" className={sel} />
          <select value={recurrence} onChange={(e) => setRecurrence(e.target.value)} aria-label="Lặp lại" className={sel}>
            {RULES.map((r) => <option key={r} value={r}>{RULE_LABEL[r]}</option>)}
          </select>
          {viewId !== 'SMART_NOTES' && <label className="flex items-center gap-1 cursor-pointer"><input type="checkbox" checked={asNote} onChange={(e) => setAsNote(e.target.checked)} /> Ghi chú</label>}
        </div>
      )}
      {noteMode && viewId !== 'SMART_NOTES' && <label className={cx('flex items-center gap-1 cursor-pointer text-[11px] mt-2', th.muted)}><input type="checkbox" checked={asNote} onChange={(e) => setAsNote(e.target.checked)} /> Ghi chú</label>}
    </form>
  );
}

// ==========================================
// KHỞI ĐỘNG: mở kho dữ liệu (bất đồng bộ) rồi mới dựng giao diện
// ==========================================
export default function App() {
  const [store, setStore] = useState(null);
  useEffect(() => {
    let live = true;
    openStore().then((s) => { if (live) setStore(s); });
    return () => { live = false; };
  }, []);
  if (!store) return <div className="fixed inset-0 flex items-center justify-center bg-slate-950 text-slate-400 text-sm">Đang mở dữ liệu…</div>;
  return <Main store={store} />;
}

function Main({ store }) {
  const [db, dispatch] = useReducer(reducer, store.initial);
  const dbRef = useRef(db);
  dbRef.current = db;
  const settings = db.settings;
  const th = settings.darkMode ? THEMES.dark : THEMES.light;

  const [tab, setTab] = useState('tasks');
  const [viewSel, setViewSel] = useState('SMART_TODAY');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const [limit, setLimit] = useState(50);
  const [openTaskId, setOpenTaskId] = useState(null);
  const [query, setQuery] = useState('');
  const [searchAll, setSearchAll] = useState(true);
  const [toast, setToast] = useState(null);
  const [undo, setUndo] = useState(null);
  const [entityDraft, setEntityDraft] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [tagPrompt, setTagPrompt] = useState(null);
  const [longStop, setLongStop] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [report, setReport] = useState(null);
  const [review, setReview] = useState(null);
  const [calDate, setCalDate] = useState(todayStr);
  const [calText, setCalText] = useState('');
  const [save, setSave] = useState(store.mode === 'memory' ? 'memory' : 'saved');
  const [notifPerm, setNotifPerm] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const fileRef = useRef(null);

  // "Hôm nay" tự cập nhật khi qua nửa đêm hoặc khi mở lại app
  const [today, setToday] = useState(todayStr);
  useEffect(() => {
    const check = () => setToday((prev) => (prev === todayStr() ? prev : todayStr()));
    const id = setInterval(check, 60000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, []);

  // ---------- Thông báo + Hoàn tác (nút Hoàn tác sống 8 giây, không bị thông báo khác xoá mất như v3) ----------
  const toastTimer = useRef(null);
  const undoTimer = useRef(null);
  const notify = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);
  const withUndo = useCallback((msg, action) => {
    const prev = dbRef.current;
    const patch = diffDb(prev, reducer(prev, action)); // reducer thuần nên tính trước được phần sẽ thay đổi
    dispatch(action);
    clearTimeout(undoTimer.current);
    setUndo({ run: () => dispatch({ type: 'UNDO_PATCH', patch }) });
    undoTimer.current = setTimeout(() => setUndo(null), 8000);
    notify(msg);
  }, [notify]);

  // ---------- Lưu trữ: gom 300 ms, chỉ ghi các bản ghi đã đổi ----------
  const savedRef = useRef(store.saved);
  const busy = useRef(false);
  const flush = useCallback(async () => {
    if (busy.current || store.mode === 'memory') return;
    const cur = dbRef.current;
    if (savedRef.current === cur) return;
    busy.current = true;
    let ok = true;
    try { await store.save(savedRef.current, cur); savedRef.current = cur; } catch (e) { ok = false; }
    busy.current = false;
    if (!ok) { setSave('error'); return; }
    if (dbRef.current === cur) setSave('saved'); else setTimeout(flush, 200);
  }, [store]);
  useEffect(() => {
    if (savedRef.current === db || store.mode === 'memory') return undefined;
    setSave((s) => (s === 'saving' ? s : 'saving'));
    const id = setTimeout(flush, 300);
    return () => clearTimeout(id);
  }, [db, flush, store.mode]);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', flush); };
  }, [flush]);
  useEffect(() => {
    if (store.origin === 'migrated') notify('Đã chuyển dữ liệu từ bản cũ sang kho v4 (bản cũ vẫn được giữ nguyên)');
    if (store.origin === 'corrupt') notify('Dữ liệu cũ bị hỏng — đã giữ bản gốc trong bộ nhớ máy và nạp dữ liệu mẫu');
    requestPersistence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Dữ liệu dẫn xuất ----------
  const listsById = useMemo(() => new Map(db.lists.map((l) => [l.id, l])), [db.lists]);
  const tagsById = useMemo(() => new Map(db.tags.map((t) => [t.id, t])), [db.tags]);
  const counts = useMemo(() => computeCounts(db, today), [db, today]);
  const viewId = useMemo(() => {
    if (SMART[viewSel] || listsById.has(viewSel)) return viewSel;
    if (viewSel.startsWith('TAG_') && tagsById.has(viewSel.slice(4))) return viewSel;
    if (viewSel.startsWith('FILTER_') && db.smartFilters.some((f) => f.id === viewSel.slice(7))) return viewSel;
    return 'SMART_TODAY';
  }, [viewSel, listsById, tagsById, db.smartFilters]);
  // Ô tìm kiếm cập nhật ngay; danh sách kết quả tính sau, nên gõ không bị khựng khi có nhiều ghi chú dài
  const deferredQuery = useDeferredValue(query);
  const searching = deferredQuery.trim() !== '' && searchAll && viewId !== 'SMART_TRASH' && viewId !== 'SMART_COUNTDOWN';
  const visible = useMemo(() => selectTasks(db, searching ? 'SEARCH_ALL' : viewId, deferredQuery, today), [db, viewId, deferredQuery, today, searching]);
  const active = useMemo(() => visible.filter((t) => !t.isCompleted), [visible]);
  const completed = useMemo(() => visible.filter((t) => t.isCompleted), [visible]);
  const openTask = openTaskId ? db.tasks.find((t) => t.id === openTaskId) : null;
  const viewTitle = SMART[viewId] || listsById.get(viewId)?.name
    || (viewId.startsWith('TAG_') ? `#${tagsById.get(viewId.slice(4))?.name}` : db.smartFilters.find((f) => f.id === viewId.slice(7))?.name);
  const backupAge = settings.lastBackupAt ? diffDays(today, isoToLocalDate(settings.lastBackupAt) || today) : null;
  const backupDue = db.tasks.length > 10 && (backupAge === null || backupAge >= 7);

  const selectView = (id) => { setViewSel(id); setTab('tasks'); setSidebarOpen(false); setLimit(50); setShowCompleted(false); setQuery(''); };

  // ---------- Thao tác với việc ----------
  const addTask = useCallback((text, d = {}, clear) => {
    const cur = dbRef.current, day = todayStr(), raw = text.trim(), nowIso = new Date().toISOString();
    if (!raw) return;
    if (d.isNote) { // ghi chú giữ nguyên tiêu đề, không chạy parser (v3 cắt mất "mai", "9h", "20/11")
      dispatch({ type: 'ADD_TASK', task: makeTask({ id: uid('note'), title: raw, listId: d.listId ?? null, isNote: true, tags: d.tagIds || [] }, nowIso) });
      notify('Đã lưu ghi chú');
      if (clear) clear();
      return;
    }
    const p = parseQuickAdd(raw, cur.tags, day);
    const title = p.title || raw;
    const finish = (extraTagIds, newTags) => {
      const rule = p.recurrence || d.recurrence || 'NONE';
      const task = makeTask({
        id: uid('task'), title, listId: d.listId ?? null, priority: p.priority ?? d.priority ?? 0,
        dueDate: p.dueDate || d.dueDate || (rule !== 'NONE' ? day : null), dueTime: p.dueTime,
        recurrenceRule: rule, recurrenceInterval: p.recurrence ? p.interval : 1,
        tags: [...new Set([...(d.tagIds || []), ...p.tagIds, ...extraTagIds, ...newTags.map((t) => t.id)])]
      }, nowIso);
      dispatch({ type: 'ADD_TASK', task, newTags });
      notify(`Đã thêm "${title}"`);
      if (clear) clear();
    };
    if (!p.newTagNames.length) { finish([], []); return; }
    setTagPrompt({
      names: p.newTagNames.map((name) => ({ name, suggest: nearestTag(name, cur.tags) })),
      onDone: (choice) => {
        const use = [], created = [];
        p.newTagNames.forEach((name, i) => {
          const suggest = nearestTag(name, cur.tags);
          if (choice[name] === 'use' && suggest) use.push(suggest.id);
          else if (choice[name] === 'new') created.push({ id: uid('t'), name, color: PALETTE[(cur.tags.length + i) % PALETTE.length] });
        });
        finish(use, created);
      }
    });
  }, [notify]);

  const toggleTask = useCallback((id) => {
    const t = dbRef.current.tasks.find((x) => x.id === id);
    if (!t) return;
    const day = todayStr();
    const recurring = !t.isCompleted && t.recurrenceRule !== 'NONE';
    const msg = recurring ? `Đã xong — kỳ tiếp theo: ${fmtDate(nextDueDate(t, day), day)}` : t.isCompleted ? 'Đã mở lại công việc' : 'Đã hoàn thành';
    withUndo(msg, { type: 'TOGGLE_TASK', id, now: new Date().toISOString(), today: day, histId: uid('task-hist') });
  }, [withUndo]);
  const trashTask = useCallback((id) => { setOpenTaskId(null); withUndo('Đã chuyển vào thùng rác', { type: 'TRASH_TASK', id }); }, [withUndo]);
  const restoreTask = useCallback((id) => { dispatch({ type: 'RESTORE_TASK', id }); notify('Đã khôi phục'); }, [notify]);
  const purgeTask = useCallback((id) => { setOpenTaskId(null); withUndo('Đã xóa vĩnh viễn', { type: 'PURGE_TASK', id }); }, [withUndo]);
  const duplicateTask = useCallback((t) => {
    const copy = { ...t, id: uid(t.isNote ? 'note' : 'task'), title: `${t.title} (bản sao)`, isCompleted: false, completedAt: null, isDeleted: false, parentId: null, sim: false, createdAt: new Date().toISOString(), subtasks: t.subtasks.map((s) => ({ ...s, id: uid('sub'), isCompleted: false })) };
    dispatch({ type: 'ADD_TASK', task: copy });
    setOpenTaskId(copy.id);
    notify('Đã nhân bản — đang mở bản sao');
  }, [notify]);
  const exportIcs = useCallback((tasks) => {
    if (IN_PREVIEW) { notify('Bản xem thử không xuất được file lịch — dùng bản cài lên Màn hình chính'); return; }
    const list = tasks.filter((t) => t.dueDate);
    if (!list.length) { notify('Không có việc nào có hạn để xuất'); return; }
    downloadText(list.length === 1 ? 'TickLocal_viec.ics' : `TickLocal_lich_${todayStr()}.ics`, buildIcs(list, dbRef.current.settings.remindLead, new Date().toISOString()), 'text/calendar');
    notify(`Đã xuất ${list.length} việc ra file lịch — mở file để thêm vào app Lịch`);
  }, [notify]);
  const openTaskCb = useCallback((id) => setOpenTaskId(id), []);
  const closeTask = useCallback(() => setOpenTaskId(null), []);
  const setSettings = (patch) => dispatch({ type: 'SET_SETTINGS', patch });

  // ---------- Danh sách, thẻ, thói quen… ----------
  const saveEntity = (d) => {
    const meta = ENTITY[d.type];
    const { type, ...rest } = d;
    let item = { ...rest, id: d.id || uid(meta.prefix) };
    if (type === 'TAG') {
      item.name = item.name.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
      if (db.tags.some((t) => t.id !== item.id && t.name === item.name)) { notify(`Thẻ #${item.name} đã tồn tại`); return; }
    }
    if (type === 'HABIT' && !d.id) item = { days: ALL_DAYS, ...item, logs: {} };
    if (type === 'COUNTDOWN') { item.title = item.name; delete item.name; } // DB lưu trường "title"
    const shown = item.name || item.title;
    dispatch({ type: 'UPSERT', coll: meta.coll, item });
    setEntityDraft(null);
    notify(`Đã lưu ${meta.label.toLowerCase()} "${shown}"`);
  };
  const deleteEntity = (d) => {
    const meta = ENTITY[d.type];
    const effect = { LIST: 'Các việc trong danh sách sẽ chuyển về Hộp thư đến.', FOLDER: 'Các danh sách bên trong được giữ lại, không thuộc thư mục nào.', TAG: 'Thẻ sẽ được gỡ khỏi mọi công việc.', HABIT: 'Toàn bộ lịch sử check-in của thói quen sẽ mất.' }[d.type] || '';
    setConfirm({
      title: `Xóa ${meta.label.toLowerCase()} "${d.name}"?`, body: effect, danger: true, okLabel: 'Xóa',
      onOk: () => { setEntityDraft(null); withUndo(`Đã xóa ${meta.label.toLowerCase()}`, { type: 'DELETE', coll: meta.coll, id: d.id }); }
    });
  };
  const mergeTag = (from, to) => { setEntityDraft(null); withUndo(`Đã gộp vào #${tagsById.get(to)?.name}`, { type: 'MERGE_TAG', from, to }); };
  const editEntity = (type, x) => setEntityDraft(type === 'COUNTDOWN' ? { type, id: x.id, name: x.title, targetDate: x.targetDate, icon: x.icon } : { type, ...x });

  // ---------- Đồng hồ ----------
  const [timer, setTimerState] = useState(loadTimer);
  const timerRef = useRef(timer);
  const setTimer = useCallback((next) => { timerRef.current = next; setTimerState(next); safeStorage.setItem(TIMER_KEY, JSON.stringify(next)); }, []);
  const addSession = useCallback((t, durationMs, endMs, mode) => {
    dispatch({ type: 'ADD_SESSION', session: { id: uid('fs'), taskId: t.taskId, duration: Math.round(durationMs / 1000), startTime: new Date(t.sessionStart || endMs - durationMs).toISOString(), endTime: new Date(endMs).toISOString(), mode, sim: false } });
  }, []);
  const checkTimer = useCallback(() => {
    const t = timerRef.current;
    const s = dbRef.current.settings;
    if (t.mode !== 'POMODORO' || !t.running || Date.now() < t.endAt) return;
    const idle = { ...t, running: false, endAt: null, remainMs: null, sessionStart: null };
    if (t.phase === 'FOCUS') {
      const round = t.round + 1;
      setTimer({ ...idle, round, phase: round % s.longEvery === 0 ? 'LONG' : 'SHORT' });
      addSession(t, phaseMs('FOCUS', s), t.endAt, 'POMODORO');
      notify(`Xong 1 Pomodoro (${s.focusMin} phút) — nghỉ thôi!`);
      systemNotify('Xong 1 Pomodoro', 'Đến giờ nghỉ.');
    } else {
      setTimer({ ...idle, phase: 'FOCUS' });
      notify('Hết giờ nghỉ — sẵn sàng phiên tiếp theo');
    }
    if (s.beep) audio.beep();
  }, [addSession, notify, setTimer]);
  useEffect(() => {
    checkTimer();
    if (!timer.running || timer.mode !== 'POMODORO') return undefined;
    const id = setTimeout(checkTimer, Math.max(0, timer.endAt - Date.now()) + 50);
    document.addEventListener('visibilitychange', checkTimer);
    return () => { clearTimeout(id); document.removeEventListener('visibilitychange', checkTimer); };
  }, [timer, checkTimer]);
  const noiseOn = timer.running && (timer.mode === 'STOPWATCH' || timer.phase === 'FOCUS');
  useEffect(() => { audio.setNoise(noiseOn ? settings.noise : 'OFF'); }, [noiseOn, settings.noise]);
  useEffect(() => () => audio.setNoise('OFF'), []);

  const startTimer = () => {
    audio.unlock();
    const t = timerRef.current, now = Date.now();
    if (t.mode === 'STOPWATCH') setTimer({ ...t, running: true, startedAt: now, sessionStart: t.sessionStart || now });
    else setTimer({ ...t, running: true, endAt: now + (t.remainMs ?? phaseMs(t.phase, settings)), sessionStart: t.sessionStart || now });
  };
  const pauseTimer = () => {
    const t = timerRef.current, now = Date.now();
    if (t.mode === 'STOPWATCH') setTimer({ ...t, running: false, elapsedMs: t.elapsedMs + (now - t.startedAt), startedAt: null });
    else setTimer({ ...t, running: false, remainMs: Math.max(0, t.endAt - now), endAt: null });
  };
  const resetTimer = (t, nextMode) => setTimer({ ...IDLE_TIMER, mode: nextMode || t.mode, taskId: t.taskId, round: t.round });
  // Dừng hẳn: phần đã tập trung ≥ 1 phút được ghi. Đếm xuôi quá 3 giờ thì hỏi lại (v3 lặng lẽ ghi phiên 568 phút khi quên tắt).
  const stopTimer = (nextMode) => {
    const t = timerRef.current, now = Date.now();
    const spent = t.mode === 'STOPWATCH' ? timerMs(t, settings, now) : t.phase === 'FOCUS' ? phaseMs('FOCUS', settings) - timerMs(t, settings, now) : 0;
    if (t.mode === 'STOPWATCH' && spent > LONG_SESSION_MS) { if (t.running) pauseTimer(); setLongStop({ spent, nextMode, minutes: 60 }); return; }
    if (spent >= 60000) { addSession(t, spent, now, t.mode); notify(`Đã lưu phiên ${Math.round(spent / 60000)} phút`); }
    resetTimer(t, nextMode);
  };
  const resolveLongStop = (keepMs) => {
    const t = timerRef.current;
    if (keepMs >= 60000) {
      const start = t.sessionStart || Date.now() - longStop.spent;
      addSession({ ...t, sessionStart: start }, keepMs, start + keepMs, 'STOPWATCH');
      notify(`Đã lưu phiên ${Math.round(keepMs / 60000)} phút`);
    } else notify('Đã bỏ phiên, không ghi vào thống kê');
    resetTimer(t, longStop.nextMode);
    setLongStop(null);
  };
  const focusOn = useCallback((id) => {
    setTimer({ ...timerRef.current, taskId: id });
    setOpenTaskId(null);
    setTab('focus');
  }, [setTimer]);

  // ---------- Nhắc giờ khi app đang mở ----------
  const notified = useRef(new Set());
  useEffect(() => {
    if (!settings.remind) return undefined;
    const check = () => {
      const now = new Date(), day = toDateStr(now), mins = now.getHours() * 60 + now.getMinutes();
      const due = [];
      for (const t of dbRef.current.tasks) {
        if (t.dueDate !== day || !t.dueTime || t.isCompleted || t.isDeleted || t.isNote) continue;
        const at = Number(t.dueTime.slice(0, 2)) * 60 + Number(t.dueTime.slice(3));
        const key = `${t.id}|${day}|${t.dueTime}`;
        if (mins >= at - settings.remindLead && mins <= at + 5 && !notified.current.has(key)) { notified.current.add(key); due.push({ key, taskId: t.id, title: t.title, time: t.dueTime, left: at - mins }); }
      }
      if (!due.length) return;
      setAlerts((prev) => [...prev, ...due].slice(-4));
      if (dbRef.current.settings.beep) audio.beep();
      due.forEach((a) => systemNotify(a.title, a.left > 0 ? `Còn ${a.left} phút (${a.time})` : `Đến giờ (${a.time})`));
    };
    check();
    const id = setInterval(check, 20000);
    document.addEventListener('visibilitychange', check);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', check); };
  }, [settings.remind, settings.remindLead]);
  const askNotifPermission = async () => {
    try { setNotifPerm(await Notification.requestPermission()); } catch (e) { setNotifPerm('denied'); }
  };

  // ---------- Dữ liệu: sao lưu / lưu trữ / kiểm tra / giả lập ----------
  const exportJson = async () => {
    const nowIso = new Date().toISOString();
    const res = await saveFile(`TickLocal_Backup_${today}.json`, JSON.stringify({ ...dbRef.current, settings: { ...dbRef.current.settings, lastBackupAt: nowIso }, lastUpdatedAt: nowIso }, null, 2), 'application/json');
    if (!res.ok) { notify(res.reason); return; }
    setSettings({ lastBackupAt: nowIso });
    notify('Đã xuất file sao lưu');
  };
  const importJson = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.tasks)) { notify('File không đúng cấu trúc TickLocal (thiếu mảng tasks)'); return; }
        const res = normalizeDb(parsed);
        setConfirm({
          title: 'Thay toàn bộ dữ liệu hiện tại bằng file này?', okLabel: 'Nhập',
          body: `File có ${res.db.tasks.length} việc/ghi chú, ${res.db.habits.length} thói quen, ${res.db.focusSessions.length} phiên tập trung.${res.fixCount ? `\nĐã tự sửa ${res.fixCount} bản ghi lỗi khi đọc.` : ''}\nDữ liệu hiện tại sẽ bị thay thế (có thể Hoàn tác ngay sau đó).`,
          onOk: () => withUndo('Đã nhập dữ liệu từ file', { type: 'REPLACE', db: res.db })
        });
      } catch (err) { notify(`Không đọc được file JSON: ${err.message}`); }
    };
    reader.readAsText(file);
  };
  const archiveCutoff = addMonths(today, -12);
  const archivable = useMemo(() => (tab === 'data' ? selectArchivable(db, archiveCutoff) : null), [tab, db, archiveCutoff]);
  const runArchive = async () => {
    const old = selectArchivable(db, archiveCutoff);
    // File lưu trữ có cùng cấu trúc với file sao lưu nên mở lại được bằng "Nhập JSON" trên một máy/hồ sơ khác
    const res = await saveFile(`TickLocal_Archive_truoc_${archiveCutoff}.json`, JSON.stringify({ schemaVersion: db.schemaVersion, archiveBefore: archiveCutoff, folders: db.folders, lists: db.lists, tags: db.tags, tasks: old.tasks, focusSessions: old.sessions, habits: [], countdowns: [], smartFilters: [] }, null, 2), 'application/json');
    if (!res.ok) { notify(`${res.reason} — chưa gỡ dữ liệu nào`); return; } // chỉ gỡ khỏi app khi file đã được lưu
    withUndo(`Đã lưu trữ ${old.tasks.length} việc và ${old.sessions.length} phiên ra file`, { type: 'ARCHIVE', cutoff: archiveCutoff, at: new Date().toISOString() });
  };
  const [est, setEst] = useState(null);
  useEffect(() => { if (tab === 'data') storageEstimate().then(setEst); }, [tab, save]);
  const runIntegrity = () => {
    const res = normalizeDb(db);
    if (res.fixCount) dispatch({ type: 'REPLACE', db: res.db });
    setReport({ ...res.fixes, fixCount: res.fixCount, at: new Date().toLocaleTimeString(), sizeKB: (JSON.stringify(res.db).length / 1024).toFixed(0), tasks: res.db.tasks.length, sessions: res.db.focusSessions.length });
    notify(res.fixCount ? `Đã sửa ${res.fixCount} lỗi dữ liệu` : 'Không phát hiện lỗi dữ liệu');
  };
  const simulate = () => {
    const titles = ['Review kiến trúc SQLite WAL', 'Đọc tài liệu Apple HIG', 'Chạy bộ 5km', 'Kiểm tra ngân sách tháng', 'Tối ưu SwiftUI List', 'Viết nhật ký kỹ thuật', 'Họp đồng bộ tiến độ', 'Dọn Inbox', 'Tập cơ bụng 15 phút'];
    const tasks = Array.from({ length: 500 }, (_, i) => {
      const ago = Math.floor(Math.random() * 365);
      const iso = new Date(Date.now() - ago * 86400000).toISOString();
      return { ...makeTask({ id: uid('sim-task'), title: `${titles[i % titles.length]} (#${i + 1})`, content: 'Bản ghi giả lập.', listId: db.lists.length ? db.lists[i % db.lists.length].id : null, priority: i % 4, dueDate: addDays(today, -ago), tags: db.tags.length ? [db.tags[i % db.tags.length].id] : [] }, iso), isCompleted: true, completedAt: iso, sim: true };
    });
    const sessions = Array.from({ length: 40 }, (_, i) => ({ id: uid('sim-fs'), taskId: null, duration: 1500, startTime: new Date(Date.now() - i * 86400000 - 1500000).toISOString(), endTime: new Date(Date.now() - i * 86400000).toISOString(), mode: 'POMODORO', sim: true }));
    const habitDays = Object.fromEntries(db.habits.map((h) => [h.id, Array.from({ length: 60 }, (_, d) => addDays(today, -d)).filter(() => Math.random() > 0.15)]));
    dispatch({ type: 'SIMULATE', tasks, sessions, habitDays });
    notify('Đã nạp 500 việc, 40 phiên, 60 ngày thói quen giả lập');
  };
  const simCount = useMemo(() => db.tasks.filter((t) => t.sim).length, [db.tasks]);
  const copyReview = async () => {
    try { await navigator.clipboard.writeText(review.markdown); notify('Đã sao chép Markdown'); }
    catch (e) { notify('Trình duyệt chặn sao chép — hãy chọn và copy thủ công trong khung bên dưới'); }
  };
  const saveReviewNote = () => {
    dispatch({ type: 'ADD_TASK', task: makeTask({ id: uid('note'), title: `📊 ${review.title}`, content: review.markdown, isNote: true }, new Date().toISOString()) });
    notify('Đã lưu báo cáo vào Sổ tay');
  };

  // ---------- Dữ liệu cho từng tab (chỉ tính khi tab đang mở) ----------
  const monthCells = useMemo(() => {
    if (tab !== 'calendar') return [];
    const first = parseDateStr(`${calDate.slice(0, 7)}-01`);
    const start = addDays(toDateStr(first), -((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [tab, calDate]);
  const dayTasks = useMemo(() => (tab === 'calendar' ? db.tasks.filter((t) => !t.isDeleted && !t.isNote && t.dueDate === calDate).sort(compareTasks) : []), [tab, db.tasks, calDate]);
  const openTasks = useMemo(() => (tab === 'focus' || tab === 'matrix' ? db.tasks.filter((t) => !t.isDeleted && !t.isNote && !t.isCompleted).sort(compareTasks) : []), [tab, db.tasks]);
  const titleById = useMemo(() => (tab === 'focus' ? new Map(db.tasks.map((t) => [t.id, t.title])) : null), [tab, db.tasks]);
  const totals = useMemo(() => (tab === 'data' ? {
    focusMin: Math.round((db.focusSessions.reduce((a, s) => a + s.duration, 0) + db.archive.focusSec) / 60),
    checkins: db.habits.reduce((a, h) => a + Object.keys(h.logs).length, 0)
  } : null), [tab, db.focusSessions, db.habits, db.archive]);
  const upcomingTimed = useMemo(() => (tab === 'data' ? db.tasks.filter((t) => !t.isDeleted && !t.isNote && !t.isCompleted && t.dueDate && t.dueDate >= today && t.dueDate <= addDays(today, 14)) : []), [tab, db.tasks, today]);

  const card = cx('rounded-2xl border', th.card);
  const btnSoft = cx('px-3.5 py-2.5 rounded-xl border text-xs font-semibold flex items-center gap-2', th.soft);
  const rowProps = { tagsById, today, onOpen: openTaskCb, onToggle: toggleTask, onFocus: focusOn, onRestore: restoreTask, onPurge: purgeTask };
  const saveLabel = {
    saved: store.mode === 'ls' ? 'Đã lưu (chế độ dự phòng, dung lượng giới hạn)' : 'Đã lưu trên máy',
    saving: 'Đang lưu…', error: 'LỖI LƯU — hãy xuất file sao lưu ngay', memory: 'Trình duyệt chặn lưu trữ — dữ liệu chỉ tồn tại trong phiên này'
  }[save];
  const saveBad = save === 'error' || save === 'memory';

  const sideItem = (id, label, Icon, color, count) => {
    const on = viewId === id && tab === 'tasks';
    return (
      <button key={id} onClick={() => selectView(id)} className={cx('w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm font-medium', on ? 'bg-blue-600 text-white' : th.ghost)}>
        <span className="flex items-center gap-2.5 min-w-0"><Icon className={cx('w-4 h-4 shrink-0', on ? 'text-white' : color)} /><span className="truncate">{label}</span></span>
        {count > 0 && <span className={cx('text-xs px-2 py-0.5 rounded-full', on ? 'bg-blue-700 text-white' : th.chip)}>{count}</span>}
      </button>
    );
  };
  const listItem = (list) => {
    const on = viewId === list.id && tab === 'tasks';
    return (
      <div key={list.id} className={cx('flex items-center rounded-xl text-sm', on ? 'bg-blue-600 text-white' : th.ghost)}>
        <button onClick={() => selectView(list.id)} className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: list.color }} />
          <span className="truncate">{list.name}</span>
          {counts.lists[list.id] > 0 && <span className="text-xs opacity-75 ml-auto">{counts.lists[list.id]}</span>}
        </button>
        <button onClick={() => editEntity('LIST', list)} aria-label={`Sửa danh sách ${list.name}`} className="p-2 opacity-60"><Edit3 className="w-3.5 h-3.5" /></button>
      </div>
    );
  };
  const sideHead = (label, addLabel, onAdd) => (
    <div className="flex items-center justify-between px-2">
      <p className={cx('text-[11px] font-bold uppercase tracking-wider', th.muted)}>{label}</p>
      <button onClick={onAdd} className="text-xs text-blue-500 flex items-center gap-0.5 py-1"><Plus className="w-3 h-3" /> {addLabel}</button>
    </div>
  );
  const boardOk = settings.viewMode === 'board' && !searching && viewId !== 'SMART_TRASH' && viewId !== 'SMART_NOTES';

  return (
    <ThemeCtx.Provider value={th}>
      <div className={cx('fixed inset-0 w-full h-[100dvh] font-sans flex flex-col overflow-hidden overscroll-none', th.app)}>
        <style>{`html,body,#root{width:100%;height:100%;margin:0;padding:0;overflow:hidden;overscroll-behavior:none;background-color:${th.hex}}`}</style>

        <header className={cx('shrink-0 z-30 backdrop-blur-md border-b px-3 py-2 flex items-center justify-between gap-2', th.bar)} style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => setSidebarOpen(true)} aria-label="Mở danh mục" className={cx('p-2 rounded-xl md:hidden', th.ghost)}><Layers className="w-5 h-5 text-blue-500" /></button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm sm:text-base tracking-tight">TickLocal</span>
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500">v4.0{IN_PREVIEW ? ' · xem thử' : ''}</span>
              </div>
              <p data-save={save} className={cx('text-[11px] truncate', saveBad ? 'text-red-500 font-semibold' : th.muted)}>{saveLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {(timer.running || timer.remainMs !== null || timer.elapsedMs > 0) && (
              <button onClick={() => setTab('focus')} className="bg-black text-white px-2.5 py-1.5 rounded-full border border-amber-500/40 flex items-center gap-1.5">
                <span className={cx('w-2 h-2 rounded-full', timer.running ? 'bg-amber-500 animate-pulse' : 'bg-slate-500')} />
                <TimerText timer={timer} settings={settings} className="text-xs font-mono font-bold text-amber-400" />
              </button>
            )}
            <button onClick={() => setSettings({ darkMode: !settings.darkMode })} aria-label="Đổi giao diện sáng/tối" className={cx('p-2 rounded-xl border', th.soft)}>
              {settings.darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>

        {(alerts.length > 0 || backupDue) && (
          <div className="shrink-0 px-3 pt-2 space-y-1.5 max-w-3xl w-full mx-auto">
            {alerts.map((a) => (
              <div key={a.key} role="alert" className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500 text-slate-950 text-xs font-semibold">
                <Bell className="w-4 h-4 shrink-0" />
                <button onClick={() => { setOpenTaskId(a.taskId); setAlerts((p) => p.filter((x) => x.key !== a.key)); }} className="flex-1 min-w-0 text-left truncate">{a.left > 0 ? `Còn ${a.left} phút` : 'Đến giờ'} ({a.time}): {a.title}</button>
                <button onClick={() => setAlerts((p) => p.filter((x) => x.key !== a.key))} aria-label="Đóng nhắc"><X className="w-4 h-4" /></button>
              </div>
            ))}
            {backupDue && (
              <div className={cx('flex items-center gap-2 px-3 py-2 rounded-xl border text-xs', th.card)}>
                <ShieldCheck className="w-4 h-4 text-amber-500 shrink-0" />
                <span className="flex-1 min-w-0">{backupAge === null ? 'Chưa sao lưu lần nào' : `Đã ${backupAge} ngày chưa sao lưu`}</span>
                <button onClick={exportJson} className="px-2.5 py-1.5 rounded-lg bg-blue-600 text-white font-bold shrink-0">Xuất ngay</button>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 flex w-full max-w-6xl mx-auto overflow-hidden relative min-h-0">
          <aside className={cx('fixed md:static inset-y-0 left-0 z-40 w-72 max-w-[85vw] transition-transform duration-300 border-r flex flex-col p-4', sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0', th.card)} style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}>
            <div className="flex-1 overflow-y-auto space-y-5 pr-1">
              <div className="flex items-center justify-between md:hidden">
                <span className="font-bold text-sm text-blue-500">Danh mục</span>
                <button onClick={() => setSidebarOpen(false)} aria-label="Đóng danh mục" className={cx('p-2 rounded-lg', th.chip)}><X className="w-4 h-4" /></button>
              </div>
              <div className="space-y-1">
                {sideItem('SMART_TODAY', 'Hôm nay', Star, 'text-amber-400', counts.SMART_TODAY)}
                {sideItem('SMART_NEXT7', '7 ngày tới', CalendarDays, 'text-blue-400', counts.SMART_NEXT7)}
                {sideItem('SMART_INBOX', 'Hộp thư đến', Inbox, 'text-indigo-400', counts.SMART_INBOX)}
                {sideItem('SMART_ALL', 'Tất cả', CheckSquare, 'text-emerald-400', counts.SMART_ALL)}
                {sideItem('SMART_NOTES', 'Sổ tay', Edit3, 'text-purple-400', counts.SMART_NOTES)}
                {sideItem('SMART_COUNTDOWN', 'Đếm ngược', Hourglass, 'text-pink-400', counts.SMART_COUNTDOWN)}
                {sideItem('SMART_TRASH', 'Thùng rác', Trash2, 'text-red-400', counts.SMART_TRASH)}
              </div>
              <div className="space-y-1.5">
                {sideHead('Danh sách', 'Danh sách', () => setEntityDraft({ type: 'LIST', name: '', color: PALETTE[0], folderId: db.folders[0]?.id || null }))}
                {db.folders.map((folder) => (
                  <div key={folder.id}>
                    <button onClick={() => editEntity('FOLDER', folder)} className={cx('flex items-center gap-2 px-2 py-1.5 text-xs font-semibold w-full text-left', th.muted)}><Folder className="w-3.5 h-3.5" /><span className="truncate">{folder.name}</span></button>
                    <div className={cx('pl-2 ml-3 border-l space-y-0.5', th.line)}>{db.lists.filter((l) => l.folderId === folder.id).map(listItem)}</div>
                  </div>
                ))}
                {db.lists.filter((l) => !l.folderId).map(listItem)}
                <button onClick={() => setEntityDraft({ type: 'FOLDER', name: '' })} className="text-xs text-blue-500 flex items-center gap-0.5 px-2 py-1"><Plus className="w-3 h-3" /> Thư mục</button>
              </div>
              <div className="space-y-2">
                {sideHead('Thẻ', 'Thẻ', () => setEntityDraft({ type: 'TAG', name: '', color: PALETTE[2] }))}
                <div className="flex flex-wrap gap-1.5 px-2">
                  {db.tags.map((t) => {
                    const on = viewId === `TAG_${t.id}` && tab === 'tasks';
                    return (
                      <span key={t.id} className={cx('text-xs rounded-lg border flex items-center', on ? 'bg-blue-600 text-white border-blue-500' : th.soft)}>
                        <button onClick={() => selectView(`TAG_${t.id}`)} className="pl-2.5 py-1.5 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.color }} />#{t.name}</button>
                        <button onClick={() => editEntity('TAG', t)} aria-label={`Sửa thẻ ${t.name}`} className="px-2 py-1.5 opacity-60"><Edit3 className="w-3 h-3" /></button>
                      </span>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1">
                {sideHead('Bộ lọc', 'Bộ lọc', () => setEntityDraft({ type: 'FILTER', name: '', priority: 3, tagId: null, onlyOverdueOrToday: true }))}
                {db.smartFilters.map((f) => {
                  const on = viewId === `FILTER_${f.id}` && tab === 'tasks';
                  return (
                    <div key={f.id} className={cx('flex items-center rounded-xl text-sm', on ? 'bg-blue-600 text-white' : th.ghost)}>
                      <button onClick={() => selectView(`FILTER_${f.id}`)} className="flex-1 min-w-0 flex items-center gap-2 px-3 py-2 text-left"><Filter className="w-3.5 h-3.5 opacity-60 shrink-0" /><span className="truncate">{f.name}</span></button>
                      <button onClick={() => editEntity('FILTER', f)} aria-label={`Sửa bộ lọc ${f.name}`} className="p-2 opacity-60"><Edit3 className="w-3.5 h-3.5" /></button>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>
          {sidebarOpen && <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 bg-black/60 z-30 md:hidden" />}

          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain pb-8 px-3.5 pt-3.5 md:px-6">
            {/* ===== TAB: CÔNG VIỆC ===== */}
            {tab === 'tasks' && (
              <div className="space-y-4 max-w-3xl mx-auto">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h1 className="text-xl font-bold tracking-tight truncate">{searching ? 'Kết quả tìm kiếm' : viewTitle}</h1>
                    {viewId !== 'SMART_COUNTDOWN' && <p className={cx('text-xs', th.muted)}>{active.length} đang mở • {completed.length} đã xong</p>}
                  </div>
                  {viewId !== 'SMART_COUNTDOWN' && (
                    <div className="flex items-center gap-2">
                      <div className={cx('flex items-center px-3 py-1.5 rounded-xl border flex-1 sm:w-52', th.card)}>
                        <Search className={cx('w-4 h-4 mr-2 shrink-0', th.muted)} />
                        <input value={query} onChange={(e) => { setQuery(e.target.value); setLimit(50); }} aria-label="Tìm kiếm" placeholder="Tìm việc, ghi chú..." className="bg-transparent outline-none w-full min-w-0 text-base sm:text-sm" />
                        {query && <button onClick={() => setQuery('')} aria-label="Xóa tìm kiếm"><X className={cx('w-4 h-4', th.muted)} /></button>}
                      </div>
                      {viewId !== 'SMART_TRASH' && viewId !== 'SMART_NOTES' && !searching && (
                        <div className={cx('p-1 rounded-xl border flex', th.card)}>
                          {[['list', ListIcon, 'Danh sách'], ['board', KanbanIcon, 'Bảng']].map(([mode, Icon, label]) => (
                            <button key={mode} onClick={() => setSettings({ viewMode: mode })} aria-label={`Xem dạng ${label}`} className={cx('p-2 rounded-lg', settings.viewMode === mode ? 'bg-blue-600 text-white' : th.muted)}><Icon className="w-4 h-4" /></button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                {query.trim() !== '' && viewId !== 'SMART_TRASH' && viewId !== 'SMART_COUNTDOWN' && (
                  <div className="flex gap-2 text-xs">
                    {[[true, 'Tìm trong tất cả (gồm ghi chú)'], [false, `Chỉ trong "${viewTitle}"`]].map(([val, label]) => (
                      <button key={String(val)} onClick={() => setSearchAll(val)} aria-pressed={searchAll === val} className={cx('px-3 py-1.5 rounded-lg border font-semibold truncate', searchAll === val ? 'bg-blue-600 text-white border-blue-500' : th.soft)}>{label}</button>
                    ))}
                  </div>
                )}

                {viewId === 'SMART_COUNTDOWN' ? (
                  <div className="space-y-3">
                    <button onClick={() => setEntityDraft({ type: 'COUNTDOWN', name: '', targetDate: addDays(today, 30), icon: '🎯' })} className="px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Thêm sự kiện</button>
                    {db.countdowns.length === 0 && <p className={cx('text-xs py-8 text-center', th.muted)}>Chưa có sự kiện nào.</p>}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[...db.countdowns].sort((a, b) => a.targetDate.localeCompare(b.targetDate)).map((cd) => {
                        const left = diffDays(cd.targetDate, today);
                        return (
                          <button key={cd.id} onClick={() => editEntity('COUNTDOWN', cd)} className={cx('p-4 flex items-center justify-between text-left', card)}>
                            <span className="flex items-center gap-3 min-w-0"><span className="text-2xl">{cd.icon}</span><span className="min-w-0"><span className="font-bold text-sm block truncate">{cd.title}</span><span className={cx('text-xs', th.muted)}>{fmtDate(cd.targetDate, today)}</span></span></span>
                            <span className="text-right shrink-0 ml-2"><span className={cx('text-2xl font-extrabold font-mono block', left >= 0 ? 'text-blue-500' : 'text-red-500')}>{Math.abs(left)}</span><span className={cx('text-[10px] uppercase font-bold', th.muted)}>{left > 0 ? 'ngày nữa' : left === 0 ? 'hôm nay' : 'ngày trước'}</span></span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    {viewId !== 'SMART_TRASH' && !searching && <QuickAdd db={db} today={today} viewId={viewId} onAdd={addTask} />}
                    {viewId === 'SMART_TRASH' && counts.SMART_TRASH > 0 && (
                      <button onClick={() => setConfirm({ title: `Xóa vĩnh viễn ${counts.SMART_TRASH} mục trong thùng rác?`, body: 'Có thể Hoàn tác trong vài giây ngay sau khi xóa.', danger: true, okLabel: 'Dọn thùng rác', onOk: () => withUndo('Đã dọn thùng rác', { type: 'EMPTY_TRASH' }) })} className="px-3 py-2 rounded-xl bg-red-500/10 text-red-500 text-xs font-semibold flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Dọn thùng rác</button>
                    )}
                    {visible.length === 0 ? (
                      <div className={cx('p-10 text-center', card)}>
                        <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
                        <p className="font-semibold text-sm">{query ? 'Không tìm thấy kết quả' : 'Không còn gì ở đây'}</p>
                      </div>
                    ) : boardOk ? (
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        {[['Quá hạn', 'border-red-500/50', (t) => t.dueDate && t.dueDate < today], ['Hôm nay', 'border-emerald-500/50', (t) => t.dueDate === today], ['Sắp tới', 'border-blue-500/50', (t) => t.dueDate && t.dueDate > today], ['Chưa đặt hạn', 'border-slate-500/40', (t) => !t.dueDate]].map(([title, border, test]) => {
                          const items = active.filter((t) => !t.isNote && test(t));
                          return (
                            <div key={title} className={cx('p-3 border-t-4 space-y-2', card, border)}>
                              <div className="flex items-center justify-between"><h3 className="font-bold text-xs uppercase tracking-wider">{title}</h3><span className={cx('text-xs px-2 py-0.5 rounded-full', th.chip)}>{items.length}</span></div>
                              {items.slice(0, 30).map((t) => (
                                <div key={t.id} onClick={() => setOpenTaskId(t.id)} className={cx('p-2.5 rounded-xl border cursor-pointer flex items-start gap-2', th.inset)}>
                                  <button onClick={(e) => { e.stopPropagation(); toggleTask(t.id); }} aria-label="Hoàn thành" className={cx('mt-0.5 w-5 h-5 rounded border-2 shrink-0', PRIORITY[t.priority].border)} />
                                  <span className="text-xs font-medium min-w-0 break-words">{t.title}</span>
                                </div>
                              ))}
                              {items.length > 30 && <p className={cx('text-[11px]', th.muted)}>+{items.length - 30} việc khác (xem ở dạng danh sách)</p>}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {active.slice(0, limit).map((t) => <TaskRow key={t.id} task={t} list={listsById.get(t.listId)} {...rowProps} />)}
                        {active.length > limit && <button onClick={() => setLimit((l) => l + 100)} className="w-full py-2.5 text-xs text-blue-500 font-semibold">Tải thêm (còn {active.length - limit})</button>}
                        {completed.length > 0 && (
                          <div className="pt-2">
                            <button onClick={() => setShowCompleted((v) => !v)} aria-expanded={showCompleted} className={cx('w-full px-3.5 py-2.5 rounded-xl border text-xs font-bold flex items-center justify-between', th.soft)}>
                              <span>Đã hoàn thành ({completed.length})</span><span>{showCompleted ? '▲' : '▼'}</span>
                            </button>
                            {showCompleted && (
                              <div className="space-y-2 mt-2">
                                {completed.slice(0, limit).map((t) => <TaskRow key={t.id} task={t} list={listsById.get(t.listId)} {...rowProps} />)}
                                {completed.length > limit && <button onClick={() => setLimit((l) => l + 100)} className="w-full py-2.5 text-xs text-blue-500 font-semibold">Tải thêm (còn {completed.length - limit})</button>}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ===== TAB: LỊCH THÁNG ===== */}
            {tab === 'calendar' && (
              <div className="max-w-3xl mx-auto space-y-4">
                <div className="flex items-center justify-between">
                  <h1 className="text-xl font-bold">Tháng {Number(calDate.slice(5, 7))}/{calDate.slice(0, 4)}</h1>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setCalDate(addMonths(calDate, -1))} aria-label="Tháng trước" className={cx('p-2 rounded-xl border', th.soft)}><ChevronLeft className="w-4 h-4" /></button>
                    <button onClick={() => setCalDate(today)} className={cx('px-3 py-2 rounded-xl border text-xs font-semibold', th.soft)}>Hôm nay</button>
                    <button onClick={() => setCalDate(addMonths(calDate, 1))} aria-label="Tháng sau" className={cx('p-2 rounded-xl border', th.soft)}><ChevronRight className="w-4 h-4" /></button>
                  </div>
                </div>
                <div className={cx('p-2', card)}>
                  <div className={cx('grid grid-cols-7 text-center text-[10px] font-bold pb-1', th.muted)}>{['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d) => <span key={d}>{d}</span>)}</div>
                  <div className="grid grid-cols-7 gap-1">
                    {monthCells.map((d) => {
                      const sel = d === calDate, inMonth = d.slice(0, 7) === calDate.slice(0, 7);
                      return (
                        <button key={d} onClick={() => setCalDate(d)} aria-label={d} aria-pressed={sel} className={cx('h-11 rounded-xl flex flex-col items-center justify-center text-sm', sel ? 'bg-blue-600 text-white font-bold' : d === today ? 'text-blue-500 font-bold' : !inMonth && 'opacity-30')}>
                          {Number(d.slice(8))}
                          <span className={cx('w-1.5 h-1.5 rounded-full mt-0.5', counts.byDate[d] ? (sel ? 'bg-white' : d < today ? 'bg-red-500' : 'bg-blue-500') : 'bg-transparent')} />
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className={cx('p-4 space-y-3', card)}>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-blue-500">Công việc {fmtDate(calDate, today)}</h3>
                  <form onSubmit={(e) => { e.preventDefault(); addTask(calText, { dueDate: calDate }, () => setCalText('')); }} className="flex items-center gap-2">
                    <Plus className="w-4 h-4 text-blue-500 shrink-0" />
                    <input value={calText} onChange={(e) => setCalText(e.target.value)} aria-label="Thêm việc vào ngày này" placeholder="Thêm việc vào ngày này" className="flex-1 min-w-0 bg-transparent outline-none text-base sm:text-sm" />
                  </form>
                  {dayTasks.length === 0 ? <p className={cx('text-xs py-4 text-center', th.muted)}>Chưa có việc nào vào ngày này.</p>
                    : dayTasks.map((t) => <TaskRow key={t.id} task={t} list={listsById.get(t.listId)} {...rowProps} />)}
                </div>
                <div className={cx('p-4', card)}>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-amber-500 mb-3">Thói quen {fmtDate(calDate, today)}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {db.habits.map((h) => {
                      const done = !!h.logs[calDate];
                      return (
                        <button key={h.id} disabled={calDate > today} onClick={() => dispatch({ type: 'TOGGLE_HABIT', id: h.id, date: calDate })} aria-pressed={done} className={cx('p-2.5 rounded-xl border flex items-center gap-2 disabled:opacity-40', done ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600' : th.inset)}>
                          <span className="text-lg">{h.icon}</span><span className="text-xs font-medium truncate">{h.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* ===== TAB: TẬP TRUNG ===== */}
            {tab === 'focus' && (
              <div className="max-w-xl mx-auto space-y-5 text-center py-2">
                <div className={cx('inline-flex p-1 border', card)}>
                  {[['POMODORO', `🍅 Pomodoro ${settings.focusMin}p`], ['STOPWATCH', '⏱️ Đếm xuôi']].map(([mode, label]) => (
                    <button key={mode} onClick={() => timer.mode !== mode && stopTimer(mode)} className={cx('px-4 py-2 rounded-xl text-xs font-bold', timer.mode === mode ? 'bg-blue-600 text-white' : th.muted)}>{label}</button>
                  ))}
                </div>
                <label className={cx('block p-3.5 text-left', card)}>
                  <span className={cx('text-[10px] uppercase tracking-wider font-bold', th.muted)}>Gắn với công việc</span>
                  <select value={openTasks.some((t) => t.id === timer.taskId) ? timer.taskId : ''} onChange={(e) => setTimer({ ...timerRef.current, taskId: e.target.value || null })} className={cx(FIELD, 'mt-1 font-semibold', th.field)}>
                    <option value="">Phiên tự do</option>
                    {openTasks.slice(0, 200).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                </label>
                <div className="w-64 h-64 mx-auto relative flex flex-col items-center justify-center">
                  <TimerRing timer={timer} settings={settings} />
                  <span className={cx('text-xs uppercase font-bold tracking-widest', th.muted)}>
                    {timer.mode === 'STOPWATCH' ? 'Đếm xuôi' : timer.phase === 'FOCUS' ? `Tập trung • vòng ${timer.round + 1}` : timer.phase === 'SHORT' ? 'Nghỉ ngắn' : 'Nghỉ dài'}
                  </span>
                  <TimerText timer={timer} settings={settings} className="text-5xl font-mono font-extrabold tracking-tight my-2" />
                  <span className={cx('text-[11px]', th.muted)}>{timer.running ? 'Đang chạy' : timer.remainMs !== null || timer.elapsedMs > 0 ? 'Tạm dừng' : 'Sẵn sàng'}</span>
                </div>
                <div className="flex items-center justify-center gap-3">
                  <button onClick={timer.running ? pauseTimer : startTimer} className={cx('px-8 py-3.5 rounded-2xl font-bold text-sm flex items-center gap-2', timer.running ? 'bg-amber-500 text-slate-950' : 'bg-blue-600 text-white')}>
                    {timer.running ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}{timer.running ? 'Tạm dừng' : 'Bắt đầu'}
                  </button>
                  <button onClick={() => stopTimer()} aria-label="Kết thúc và đặt lại" className={cx('p-3.5 rounded-2xl border', th.soft)}><RotateCcw className="w-5 h-5" /></button>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {NOISES.map(([key, label]) => (
                    <button key={key} onClick={() => { audio.unlock(); setSettings({ noise: key }); }} aria-pressed={settings.noise === key} className={cx('px-3 py-2 rounded-xl text-xs font-medium border', settings.noise === key ? 'bg-blue-600/20 border-blue-500 text-blue-500' : th.soft)}>{label}</button>
                  ))}
                </div>
                <div className={cx('p-4 text-left', card)}>
                  <h3 className={cx('text-xs font-bold uppercase tracking-wider mb-2', th.muted)}>Lịch sử ({db.focusSessions.length} phiên)</h3>
                  {db.focusSessions.length === 0 && <p className={cx('text-xs', th.muted)}>Chưa có phiên nào.</p>}
                  <div className="max-h-56 overflow-y-auto">
                    {db.focusSessions.slice(0, 20).map((s) => (
                      <div key={s.id} className={cx('flex items-center justify-between gap-2 text-xs py-1 border-b last:border-none', th.line)}>
                        <span className="truncate flex-1 min-w-0">{s.mode === 'POMODORO' ? '🍅' : '⏱️'} {titleById.get(s.taskId) || 'Phiên tự do'}</span>
                        <span className={cx('font-mono shrink-0', th.muted)}>{fmtDate(isoToLocalDate(s.startTime), today)} • {Math.round(s.duration / 60)}p</span>
                        <button onClick={() => withUndo('Đã xóa phiên', { type: 'DELETE', coll: 'focusSessions', id: s.id })} aria-label="Xóa phiên này" className={cx('p-1.5 shrink-0', th.muted)}><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ===== TAB: THÓI QUEN ===== */}
            {tab === 'habits' && (
              <div className="max-w-3xl mx-auto space-y-4">
                <div className="flex items-center justify-between">
                  <h1 className="text-xl font-bold flex items-center gap-2"><Flame className="w-6 h-6 text-amber-500" /> Thói quen</h1>
                  <button onClick={() => setEntityDraft({ type: 'HABIT', name: '', icon: '🔥', color: PALETTE[0], days: ALL_DAYS })} className="px-3 py-2 rounded-xl bg-blue-600 text-white text-xs font-semibold flex items-center gap-1"><Plus className="w-4 h-4" /> Thêm</button>
                </div>
                {db.habits.length === 0 && <p className={cx('text-xs py-8 text-center', th.muted)}>Chưa có thói quen nào.</p>}
                {db.habits.map((habit) => {
                  const st = habitStats(habit, today);
                  const partial = habit.days.length < 7;
                  return (
                    <div key={habit.id} className={cx('p-4 space-y-3', card)}>
                      <button onClick={() => editEntity('HABIT', habit)} className="flex items-center gap-3 w-full text-left">
                        <span className="w-11 h-11 rounded-2xl flex items-center justify-center text-2xl shrink-0" style={{ backgroundColor: `${habit.color}22` }}>{habit.icon}</span>
                        <span className="min-w-0">
                          <span className="font-bold text-sm block truncate">{habit.name}{partial && <span className={cx('font-normal text-xs ml-1.5', th.muted)}>({habit.days.map((d) => WEEKDAY_SHORT[d]).join(' ')})</span>}</span>
                          <span className={cx('text-xs', th.muted)}><b className="text-amber-500">🔥 chuỗi {st.current}</b> • dài nhất {st.best} • 30 ngày: {st.rate30}%{partial ? ' số ngày theo lịch' : ''}</span>
                        </span>
                      </button>
                      <div className="grid grid-cols-7 gap-1.5">
                        {Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map((d) => {
                          const on = !!habit.logs[d];
                          const planned = habit.days.includes(parseDateStr(d).getDay());
                          return (
                            <button key={d} onClick={() => dispatch({ type: 'TOGGLE_HABIT', id: habit.id, date: d })} aria-pressed={on} aria-label={`${habit.name} ngày ${d}`} className={cx('h-12 rounded-xl border flex flex-col items-center justify-center', on ? 'bg-emerald-500 border-emerald-400 text-white' : th.inset, !on && !planned && 'opacity-40 border-dashed')}>
                              <span className="text-[9px] uppercase font-bold">{d === today ? 'Nay' : d.slice(8)}</span>
                              <Check className={cx('w-4 h-4', on ? 'opacity-100' : 'opacity-20')} strokeWidth={3} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ===== TAB: MA TRẬN ===== */}
            {tab === 'matrix' && (
              <div className="max-w-4xl mx-auto space-y-4">
                <div>
                  <h1 className="text-xl font-bold">Ma trận Eisenhower</h1>
                  <p className={cx('text-xs', th.muted)}>Quan trọng = ưu tiên Cao/Trung bình. Khẩn cấp = đến hạn trước hết ngày mai. Chạm chấm màu để đổi ưu tiên.</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {[['I. Làm ngay', 'Quan trọng & khẩn cấp', 'border-red-500/50 bg-red-500/5', true, true], ['II. Lên lịch', 'Quan trọng, chưa gấp', 'border-amber-500/50 bg-amber-500/5', true, false], ['III. Ủy quyền / làm nhanh', 'Gấp nhưng ít quan trọng', 'border-blue-500/50 bg-blue-500/5', false, true], ['IV. Cân nhắc bỏ', 'Không gấp, không quan trọng', 'border-slate-500/40 bg-slate-500/5', false, false]].map(([title, sub, color, important, urgent]) => {
                    const tomorrow = addDays(today, 1);
                    const items = openTasks.filter((t) => (t.priority >= 2) === important && (!!t.dueDate && t.dueDate <= tomorrow) === urgent);
                    return (
                      <div key={title} className={cx('p-4 rounded-2xl border-2 space-y-2 min-h-[160px]', color)}>
                        <div className="flex items-center justify-between"><div><h3 className="font-bold text-sm">{title}</h3><p className={cx('text-[11px]', th.muted)}>{sub}</p></div><span className={cx('text-xs font-bold px-2.5 py-0.5 rounded-full', th.chip)}>{items.length}</span></div>
                        {items.length === 0 && <p className={cx('text-xs italic py-4 text-center', th.muted)}>Trống</p>}
                        {items.slice(0, 12).map((t) => (
                          <div key={t.id} onClick={() => setOpenTaskId(t.id)} className={cx('p-2.5 rounded-xl border flex items-center justify-between cursor-pointer', th.card)}>
                            <span className="flex items-center gap-2 min-w-0">
                              <button onClick={(e) => { e.stopPropagation(); toggleTask(t.id); }} aria-label="Hoàn thành" className={cx('w-5 h-5 rounded border-2 shrink-0', PRIORITY[t.priority].border)} />
                              <span className="min-w-0"><span className="text-xs font-medium truncate block">{t.title}</span>{t.dueDate && <span className={cx('text-[10px]', t.dueDate < today ? 'text-red-500' : th.muted)}>{fmtDate(t.dueDate, today)}</span>}</span>
                            </span>
                            <span className="flex items-center gap-0.5 ml-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                              {[3, 2, 1, 0].map((p) => (
                                <button key={p} onClick={() => dispatch({ type: 'UPDATE_TASK', id: t.id, patch: { priority: p } })} aria-label={`Ưu tiên ${PRIORITY[p].label}`} className="p-1.5">
                                  <span className={cx('block w-3 h-3 rounded-full', t.priority === p ? 'ring-2 ring-offset-1 ring-blue-500' : 'opacity-40')} style={{ backgroundColor: PRIORITY[p].hex }} />
                                </button>
                              ))}
                            </span>
                          </div>
                        ))}
                        {items.length > 12 && <p className={cx('text-[11px]', th.muted)}>+{items.length - 12} việc khác — ô này đang quá tải</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ===== TAB: DỮ LIỆU ===== */}
            {tab === 'data' && totals && (
              <div className="max-w-3xl mx-auto space-y-5">
                <h1 className="text-xl font-bold">Dữ liệu & Tổng kết</h1>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[['Đã hoàn thành', counts.done + db.archive.tasks, 'text-emerald-500'], ['Đang mở', counts.SMART_ALL, 'text-blue-500'], ['Phút tập trung', totals.focusMin, 'text-amber-500'], ['Check-in thói quen', totals.checkins, 'text-purple-500']].map(([label, val, color]) => (
                    <div key={label} className={cx('p-4', card)}><p className={cx('text-[11px] font-medium', th.muted)}>{label}</p><p className={cx('text-2xl font-extrabold mt-1', color)}>{val}</p></div>
                  ))}
                </div>

                <section className={cx('p-5 space-y-3', card)}>
                  <h3 className="font-bold text-sm flex items-center gap-2 text-blue-500"><FileText className="w-4 h-4" /> Tổng kết tuần / tháng</h3>
                  <div className="flex gap-2">
                    {[7, 30].map((n) => <button key={n} onClick={() => setReview(buildReview(db, n, today))} className={cx('px-3.5 py-2.5 rounded-xl text-xs font-bold border', review?.days === n ? 'bg-blue-600 text-white border-blue-500' : th.soft)}>{n} ngày qua</button>)}
                  </div>
                  {review && (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        {[['Đã xong', `${review.completedCount} việc`], ['Tập trung', `${review.focusMinutes} phút`], ['Thói quen', `${review.habitRate}%`], ['Tồn đọng', `${review.pendingCount} việc`]].map(([k, v]) => (
                          <div key={k} className={cx('p-2.5 rounded-xl border', th.inset)}><span className={cx('text-[10px] uppercase font-bold', th.muted)}>{k}</span><p className="text-base font-extrabold">{v}</p></div>
                        ))}
                      </div>
                      {review.byList.length > 0 && (
                        <div className={cx('p-3 rounded-xl border space-y-1.5', th.inset)}>
                          <span className={cx('text-[10px] uppercase font-bold', th.muted)}>Giờ tập trung theo danh sách</span>
                          {review.byList.map((r) => (
                            <div key={r.name} className="flex items-center gap-2 text-xs">
                              <span className="w-32 truncate shrink-0">{r.name}</span>
                              <span className="flex-1 h-2 rounded-full bg-slate-500/20 overflow-hidden"><span className="block h-full bg-amber-500" style={{ width: `${Math.round((r.minutes / review.byList[0].minutes) * 100)}%` }} /></span>
                              <span className="font-mono shrink-0 w-14 text-right">{r.minutes}p</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <textarea readOnly rows={9} value={review.markdown} aria-label="Báo cáo Markdown" className={cx(FIELD, 'font-mono !text-xs leading-relaxed', th.field)} />
                      <div className="flex flex-wrap justify-end gap-2">
                        <button onClick={copyReview} className={btnSoft}><Copy className="w-3.5 h-3.5" /> Sao chép</button>
                        <button onClick={saveReviewNote} className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5"><Edit3 className="w-3.5 h-3.5" /> Lưu vào Sổ tay</button>
                      </div>
                    </>
                  )}
                </section>

                <section className={cx('p-5 space-y-3', card)}>
                  <h3 className="font-bold text-sm flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-blue-500" /> Sao lưu & khôi phục</h3>
                  <p className={cx('text-xs', th.muted)}>
                    Dữ liệu chỉ nằm trên máy này. Lần sao lưu gần nhất: <b>{settings.lastBackupAt ? `${fmtDate(isoToLocalDate(settings.lastBackupAt), today)} (${backupAge} ngày trước)` : 'chưa có'}</b>.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={exportJson} className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-semibold flex items-center gap-2"><Download className="w-4 h-4" /> Xuất JSON</button>
                    <input ref={fileRef} type="file" accept=".json,application/json" onChange={importJson} className="hidden" />
                    <button onClick={() => fileRef.current?.click()} className={btnSoft}><Upload className="w-4 h-4" /> Nhập JSON</button>
                    <button onClick={() => setConfirm({ title: 'Xoá trắng toàn bộ dữ liệu?', body: 'App trở về trạng thái trống, không có dữ liệu mẫu. Cài đặt được giữ lại. Có thể Hoàn tác ngay sau đó.', danger: true, okLabel: 'Xoá trắng', onOk: () => { setReport(null); withUndo('Đã xoá trắng dữ liệu', { type: 'REPLACE', db: { ...normalizeDb({ tasks: [] }).db, settings } }); } })} className={btnSoft}><Trash2 className="w-4 h-4" /> Xoá trắng</button>
                    <button onClick={() => setConfirm({ title: 'Thay bằng dữ liệu mẫu?', body: 'Mọi dữ liệu hiện tại sẽ bị thay bằng dữ liệu mẫu (có thể Hoàn tác ngay sau đó).', danger: true, okLabel: 'Nạp mẫu', onOk: () => { setReport(null); withUndo('Đã nạp dữ liệu mẫu', { type: 'REPLACE', db: { ...seedData(today, new Date().toISOString()), settings } }); } })} className={btnSoft}><RefreshCw className="w-4 h-4" /> Dữ liệu mẫu</button>
                  </div>
                </section>

                <section className={cx('p-5 space-y-3', card)}>
                  <h3 className="font-bold text-sm flex items-center gap-2 text-amber-500"><Bell className="w-4 h-4" /> Nhắc giờ</h3>
                  <p className={cx('text-xs', th.muted)}>App chỉ nhắc được khi đang mở. Muốn iPhone nhắc cả khi app đóng, hãy xuất việc sang app Lịch.</p>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.remind} onChange={(e) => setSettings({ remind: e.target.checked })} /> Hiện băng nhắc và kêu bíp khi việc có giờ sắp đến</label>
                  <label className="flex items-center gap-2 text-xs"><span>Nhắc trước</span><NumField value={settings.remindLead} min={0} max={120} onCommit={(n) => setSettings({ remindLead: n })} label="Nhắc trước (phút)" className={cx('w-20 px-2 py-1.5 rounded-lg border outline-none text-base sm:text-sm', th.field)} /><span>phút</span></label>
                  <div className="flex flex-wrap gap-2">
                    {!IN_PREVIEW && <button onClick={() => exportIcs(upcomingTimed)} className={btnSoft}><CalendarDays className="w-4 h-4" /> Xuất {upcomingTimed.length} việc 14 ngày tới sang Lịch (.ics)</button>}
                    {notifPerm === 'default' && <button onClick={askNotifPermission} className={btnSoft}><Bell className="w-4 h-4" /> Cho phép thông báo hệ thống</button>}
                  </div>
                  {IN_PREVIEW && <p className={cx('text-xs', th.muted)}>Bản xem thử không xuất được file lịch (.ics); nút này có ở bản cài lên Màn hình chính.</p>}
                  {notifPerm === 'denied' && <p className={cx('text-xs', th.muted)}>Thông báo hệ thống đang bị chặn trong cài đặt trình duyệt; băng nhắc trong app vẫn hoạt động.</p>}
                </section>

                <section className={cx('p-5 space-y-3', card)}>
                  <h3 className="font-bold text-sm flex items-center gap-2 text-amber-500"><Clock className="w-4 h-4" /> Cài đặt Pomodoro</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[['focusMin', 'Tập trung (phút)', 1, 180], ['shortMin', 'Nghỉ ngắn', 1, 60], ['longMin', 'Nghỉ dài', 1, 120], ['longEvery', 'Nghỉ dài sau (vòng)', 2, 12]].map(([key, label, lo, hi]) => (
                      <label key={key} className="block text-[11px] font-semibold"><span className={th.muted}>{label}</span>
                        <NumField value={settings[key]} min={lo} max={hi} onCommit={(n) => setSettings({ [key]: n })} label={label} className={cx(FIELD, 'mt-1', th.field)} />
                      </label>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={settings.beep} onChange={(e) => setSettings({ beep: e.target.checked })} /> Phát tiếng bíp khi hết giờ (chỉ khi app đang mở)</label>
                </section>

                <section className={cx('p-5 space-y-3', card)}>
                  <h3 className="font-bold text-sm flex items-center gap-2 text-emerald-500"><Database className="w-4 h-4" /> Kho dữ liệu</h3>
                  <p className={cx('text-xs', th.muted)}>
                    {store.mode === 'idb' ? 'Kho: IndexedDB, mỗi lần lưu chỉ ghi phần thay đổi.' : store.mode === 'ls' ? 'Kho: localStorage (dự phòng, giới hạn khoảng 5 MB).' : 'Không có kho lưu trữ.'}
                    {est && ` Trình duyệt báo app đang dùng ${est.usageMB.toFixed(1)} MB trên hạn mức ${est.quotaMB >= 1024 ? `${(est.quotaMB / 1024).toFixed(1)} GB` : `${est.quotaMB.toFixed(0)} MB`}.`}
                    {db.archive.tasks > 0 && ` Đã lưu trữ ra file: ${db.archive.tasks} việc, ${db.archive.sessions} phiên.`}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {archivable && archivable.tasks.length + archivable.sessions.length > 0 && (
                      <button onClick={() => setConfirm({ title: `Lưu trữ dữ liệu cũ hơn 12 tháng?`, body: `${archivable.tasks.length} việc đã xong và ${archivable.sessions.length} phiên tập trung trước ngày ${archiveCutoff} sẽ được xuất ra một file riêng rồi gỡ khỏi app. Tổng số trong thống kê vẫn được giữ. Hãy cất file cẩn thận; có thể Hoàn tác ngay sau đó.`, okLabel: 'Xuất file và gỡ', onOk: runArchive })} className="px-4 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-bold flex items-center gap-2"><Archive className="w-4 h-4" /> Lưu trữ {archivable.tasks.length} việc cũ</button>
                    )}
                    <button onClick={runIntegrity} className="px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-bold flex items-center gap-2"><Wrench className="w-4 h-4" /> Kiểm tra & sửa</button>
                    <button onClick={simulate} className={btnSoft}><Zap className="w-4 h-4" /> Nạp 500 việc giả lập</button>
                    {simCount > 0 && <button onClick={() => withUndo('Đã gỡ dữ liệu giả lập', { type: 'CLEAR_SIM' })} className="px-3.5 py-2.5 rounded-xl bg-red-500/10 text-red-500 text-xs font-semibold">Gỡ {simCount} việc giả lập</button>}
                  </div>
                  {report && (
                    <div className={cx('p-3.5 rounded-xl border text-xs space-y-1', th.inset)}>
                      <p className="font-bold">{report.fixCount ? `Đã sửa ${report.fixCount} lỗi` : 'Không phát hiện lỗi'} ({report.at})</p>
                      <p>Tham chiếu mồ côi: danh sách {report.orphanLists}, thẻ {report.orphanTags}, phiên tập trung {report.orphanSessions}, thư mục {report.orphanFolders}</p>
                      <p>Bản ghi hỏng bị loại: {report.dropped} • Trùng id: {report.dupIds}</p>
                      <p>Tổng {report.tasks} việc/ghi chú, {report.sessions} phiên • file sao lưu khoảng {report.sizeKB} KB</p>
                    </div>
                  )}
                </section>
              </div>
            )}
          </main>
        </div>

        {entityDraft && <EntityModal key={`${entityDraft.type}-${entityDraft.id || 'new'}`} draft={entityDraft} db={db} onSave={saveEntity} onDelete={deleteEntity} onMerge={mergeTag} onClose={() => setEntityDraft(null)} />}
        {openTask && <TaskSheet key={openTask.id} task={openTask} db={db} today={today} dispatch={dispatch} onClose={closeTask} onTrash={trashTask} onRestore={restoreTask} onFocus={focusOn} onDuplicate={duplicateTask} onIcs={exportIcs} />}
        {tagPrompt && <TagPrompt prompt={tagPrompt} onClose={() => setTagPrompt(null)} />}
        {confirm && <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />}
        {longStop && (
          <Modal onClose={() => setLongStop(null)}>
            <h3 className="font-bold text-sm">Phiên đếm xuôi dài {Math.floor(longStop.spent / 3600000)} giờ {Math.round((longStop.spent % 3600000) / 60000)} phút</h3>
            <p className={cx('text-xs', th.muted)}>Có vẻ đồng hồ đã bị quên. Anh muốn ghi bao nhiêu vào thống kê?</p>
            <label className="flex items-center gap-2 text-xs"><span>Chỉ ghi</span><NumField value={longStop.minutes} min={1} max={600} onCommit={(n) => setLongStop((p) => ({ ...p, minutes: n }))} label="Số phút thực tế" className={cx('w-20 px-2 py-1.5 rounded-lg border outline-none text-base sm:text-sm', th.field)} /><span>phút</span>
              <button onClick={() => resolveLongStop(longStop.minutes * 60000)} className="ml-auto px-3 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white">Ghi số này</button>
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => resolveLongStop(0)} className="px-3 py-2 rounded-xl text-xs font-semibold bg-red-500/10 text-red-500">Không ghi</button>
              <button onClick={() => resolveLongStop(longStop.spent)} className={cx('px-3 py-2 rounded-xl text-xs font-semibold border', th.soft)}>Ghi đủ cả phiên</button>
            </div>
          </Modal>
        )}

        {(toast || undo) && (
          <div role="status" aria-live="polite" className="fixed left-1/2 -translate-x-1/2 z-[60] max-w-[92vw] bg-slate-900 text-white border border-blue-500/40 pl-4 pr-2 py-2 rounded-2xl shadow-2xl text-xs font-medium flex items-center gap-3" style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}>
            <span className="py-1.5">{toast ? toast.msg : 'Vẫn có thể hoàn tác thao tác vừa rồi'}</span>
            {undo && <button onClick={() => { undo.run(); clearTimeout(undoTimer.current); setUndo(null); notify('Đã hoàn tác'); }} className="px-2.5 py-1.5 rounded-lg bg-blue-600 font-bold shrink-0">Hoàn tác</button>}
          </div>
        )}

        <nav className={cx('shrink-0 z-30 border-t backdrop-blur-lg px-2 pt-1.5', th.bar)} style={{ paddingBottom: 'calc(0.375rem + env(safe-area-inset-bottom))' }}>
          <div className="max-w-lg mx-auto grid grid-cols-6 gap-1">
            {[['tasks', 'Việc', CheckSquare], ['calendar', 'Lịch', CalendarIcon], ['focus', 'Tập trung', Clock], ['habits', 'Thói quen', Flame], ['matrix', 'Ma trận', LayoutGrid], ['data', 'Dữ liệu', Database]].map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} className={cx('flex flex-col items-center justify-center py-1.5 rounded-xl', tab === id ? 'text-blue-500 font-bold' : th.muted)}>
                <Icon className="w-5 h-5" strokeWidth={tab === id ? 2.5 : 2} />
                <span className="text-[10px] mt-0.5 truncate max-w-full">{label}</span>
              </button>
            ))}
          </div>
        </nav>
      </div>
    </ThemeCtx.Provider>
  );
}
