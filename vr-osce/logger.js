// VR-OSCE PoC  行動ログ（STEP 8で記録、STEP 9で elapsed_time と自動退避を追加）
// 1行 = 学生の1操作。採点は、このログの「何を・どの順で行ったか」から行う。
const pad2 = (n) => String(n).padStart(2, '0');
export const fmtElapsed = (sec) => `${pad2(Math.floor(sec / 60))}:${pad2(Math.floor(sec % 60))}`;
const STORAGE_KEY = 'osce_last_session';

export class Logger {
  constructor(studentId, stationId) {
    this.studentId = studentId;
    this.stationId = stationId;
    this.t0 = performance.now();
    this.startedAt = new Date().toISOString();
    this.entries = [];
  }

  // correct: 正誤が定義される操作のみ true/false、それ以外は null
  // safety_flag: 安全上の問題があれば識別子の文字列、なければ ''
  record({ action, selection = '', result = '', correct = null, safety_flag = '' }) {
    const sec = Math.round((performance.now() - this.t0) / 100) / 10;
    const e = {
      seq: this.entries.length + 1,
      student_id: this.studentId,
      station_id: this.stationId,
      timestamp: new Date().toISOString(),
      elapsed_time: fmtElapsed(sec),
      elapsed_sec: sec,
      action, selection, result, correct, safety_flag,
    };
    this.entries.push(e);
    this._backup();
    return e;
  }

  indexOf(action) { return this.entries.findIndex(e => e.action === action); }
  has(action) { return this.indexOf(action) >= 0; }

  // 端末内への自動退避（VRを途中で抜けた・ページを再読込した場合の保険）。失敗しても動作は続ける。
  _backup() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        student_id: this.studentId, station_id: this.stationId, started_at: this.startedAt, entries: this.entries,
      }));
    } catch (_) { /* 保存不可の環境では何もしない */ }
  }
}
