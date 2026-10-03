// VR-OSCE PoC  STEP 9: ログ・採点結果の出力（JSON / CSV）
// CSVはExcelで日本語が文字化けしないよう、UTF-8 BOM付きで出力する。

const pad2 = (n) => String(n).padStart(2, '0');

export function stamp(d = new Date()) {   // 端末のローカル時刻 yyyymmdd-hhmmss
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCSV = (header, rows) =>
  '﻿' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

// セッション全体（ログ＋回答＋採点＋フィードバック）
export function buildSession(logger, CASE, S) {
  const r = S.result;
  return {
    schema_version: 1,
    student_id: logger.studentId,
    station_id: logger.stationId,
    station_title: CASE.title,
    started_at: logger.startedAt,
    ended_at: S.endedAt || null,
    duration_sec: S.endMs != null && S.startMs != null ? Math.round((S.endMs - S.startMs) / 100) / 10 : null,
    time_limit_sec: CASE.time_limit_sec,
    completed: S.endReason === 'complete',
    end_reason: S.endReason || null,    // complete / finish（学生が終了） / time_up / vr_exit（VRを途中で終了）
    log: logger.entries,
    answers: S.answers,
    scores: r ? r.domains.map(d => ({ id: d.id, domain: d.label, score: d.score, max: d.max, detail: d.detail })) : [],
    feedback: r ? { good: r.good, missed: r.missed, safety: r.safety } : null,
    safety_errors: r ? r.safety_errors : [],
  };
}

export function logCSV(session) {
  const header = ['seq', 'student_id', 'station_id', 'timestamp', 'elapsed_time', 'elapsed_sec', 'action', 'selection', 'result', 'correct', 'safety_flag'];
  return toCSV(header, session.log.map(e => header.map(k => e[k])));
}

export function scoresCSV(session) {
  const header = ['student_id', 'station_id', 'domain', 'score', 'max', 'done_items', 'missed_items', 'selected_option', 'best_option'];
  const rows = session.scores.map(s => [
    session.student_id, session.station_id, s.domain, s.score, s.max,
    (s.detail.done || []).join('|'), (s.detail.missed || []).join('|'),
    s.detail.selected ?? '', s.detail.best ?? '',
  ]);
  return toCSV(header, rows);
}

export const fileBase = (session) => `osce_${session.student_id}_${session.station_id}_${stamp(new Date(session.started_at))}`;

export function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
