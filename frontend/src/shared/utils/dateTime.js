/**
 * Single timezone strategy for exam scheduling (ProctoX):
 *
 * - Administrators enter and read exam times as Asia/Kolkata (IST) wall-clock.
 * - The API payload carries the instant explicitly (ISO 8601 with +05:30),
 *   converted exactly once here. The backend (USE_TZ=True, TIME_ZONE=UTC)
 *   stores it as UTC in PostgreSQL `timestamptz` and rejects naive input.
 * - Display converts the stored instant back to Asia/Kolkata explicitly, so
 *   every browser and deployment shows the same time — never the viewer's
 *   local zone, never a double-shifted value.
 *
 * Deliberately no `new Date(value).toISOString()` on the write path: that
 * interprets the wall-clock in the *browser's* zone, which is only correct
 * when the browser itself runs in IST.
 */

export const APP_TIME_ZONE = 'Asia/Kolkata';
export const IST_OFFSET = '+05:30';

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const OFFSET_RE = /([zZ]|[+-]\d{2}:?\d{2})$/;

/**
 * Interpret a `datetime-local` wall-clock value as IST and return an
 * unambiguous ISO 8601 string, e.g. "2026-10-16T10:20" →
 * "2026-10-16T10:20:00+05:30". Pure string transform: midnight-safe and
 * independent of the browser's timezone. Values that already carry an
 * offset pass through untouched (still exactly one conversion).
 */
export const fromDateTimeLocalToISO = (value) => {
  if (value == null || value === '') return value;
  const raw = String(value).trim();
  if (OFFSET_RE.test(raw)) return raw;
  const m = LOCAL_RE.exec(raw);
  if (!m) throw new Error('Invalid date-time value');
  const [, y, mo, d, h, mi, s] = m;
  for (const [part, max] of [[mo, 12], [d, 31], [h, 23], [mi, 59], [s ?? '00', 59]]) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new Error('Invalid date-time value');
  }
  void y;
  return `${y}-${mo}-${d}T${h}:${mi}:${s ?? '00'}${IST_OFFSET}`;
};

/** Extract Asia/Kolkata wall-clock parts for an absolute instant. */
const istParts = (iso) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: APP_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    day: get('day'),
    month: get('month'),
    year: get('year'),
    hour: get('hour'),
    minute: get('minute'),
    dayPeriod: get('dayPeriod').toUpperCase(),
  };
};

/**
 * Display an exam instant as "16 October 2026, 10:20 AM IST" regardless of
 * the viewer's timezone. Returns '—' for missing/invalid input (never a
 * raw "15:48:00"-style string).
 */
export const formatExamDateTime = (iso) => {
  if (!iso) return '—';
  const p = istParts(iso);
  if (!p || !p.day || !p.month || !p.year) return '—';
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} ${p.dayPeriod} IST`;
};

/**
 * Convert a stored instant back to a `datetime-local` value expressed in
 * IST, for editing flows. Returns '' for missing/invalid input.
 */
export const toDateTimeLocalValue = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  let h = get('hour');
  if (h === '24') h = '00';
  if (!y || !mo || !d) return '';
  return `${y}-${mo}-${d}T${h}:${get('minute')}`;
};
