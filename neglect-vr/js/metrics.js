// ログ・指標・CSV(純ロジック、THREE非依存)。
// 符号規約: head_yaw / object_angle は 負=左, 正=右(校正時の正面=0°)。head_pitch は 上=正。

export const GRAB_COLUMNS = [
  'timestamp', 'condition', 'object_id', 'object_side', 'object_angle',
  'head_yaw', 'head_pitch', 'grab_time', 'release_time', 'success', 'remaining_objects',
  'run_id',
];
export const YAW_COLUMNS = ['timestamp', 'run_id', 'condition', 't_run_s', 'head_yaw', 'head_pitch'];

export function wrapDeg(d) {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

const r2 = (v) => (v == null ? '' : Math.round(v * 100) / 100);
const r3 = (v) => (v == null ? '' : Math.round(v * 1000) / 1000);

export class RunRecorder {
  constructor({ runId, condition, seed, startEpochMs, layout, leftThresholdDeg = 20, yawHz = 30 }) {
    this.runId = runId;
    this.condition = condition;
    this.seed = seed;
    this.startEpochMs = startEpochMs;
    this.layout = layout;
    this.leftThreshold = leftThresholdDeg;
    this.yawDt = 1 / yawHz;
    this.grabRows = [];
    this.yawSamples = [];
    this.events = []; // attention capture 等
    this.pending = new Map(); // object_id -> {grab_time, head_yaw, head_pitch}
    this.grabbedIds = new Set();
    this.minYaw = 0;
    this.maxYaw = 0;
    this.firstLeftScanSec = null;
    this.firstLeftGrabSec = null;
    this._lastYawT = -1;
    this.endSec = null;
  }

  iso(t) {
    return new Date(this.startEpochMs + t * 1000).toISOString();
  }

  addYaw(t, yaw, pitch) {
    if (yaw < this.minYaw) this.minYaw = yaw;
    if (yaw > this.maxYaw) this.maxYaw = yaw;
    if (this.firstLeftScanSec == null && yaw <= -this.leftThreshold) this.firstLeftScanSec = t;
    if (t - this._lastYawT >= this.yawDt) {
      this._lastYawT = t;
      this.yawSamples.push({ t, yaw, pitch });
    }
  }

  openGrab(obj, t, yaw, pitch) {
    this.pending.set(obj.id, { grab_time: t, head_yaw: yaw, head_pitch: pitch });
    this.grabbedIds.add(obj.id);
    if (obj.side === 'left' && this.firstLeftGrabSec == null) this.firstLeftGrabSec = t;
  }

  closeGrab(obj, t, success, remaining) {
    const p = this.pending.get(obj.id);
    if (!p) return;
    this.pending.delete(obj.id);
    this.grabRows.push(this._row(obj, t, p, t, success, remaining));
  }

  logEvent(t, type, objId) {
    this.events.push({ timestamp: this.iso(t), t_run_s: r3(t), type, object_id: objId });
  }

  /** 終了時: 把持中/未把持の残存物体を全て記録する。 */
  finalize(objects, t, remaining) {
    this.endSec = t;
    for (const o of objects) {
      if (o.inBox) continue;
      const p = this.pending.get(o.id) || null;
      this.grabRows.push(this._row(o, t, p, p ? t : null, false, remaining));
      this.pending.delete(o.id);
    }
  }

  _row(obj, tRow, p, tRelease, success, remaining) {
    return {
      timestamp: this.iso(tRow),
      condition: this.condition,
      object_id: obj.id,
      object_side: obj.side,
      object_angle: r2(obj.angle),
      head_yaw: p ? r2(p.head_yaw) : '',
      head_pitch: p ? r2(p.head_pitch) : '',
      grab_time: p ? r3(p.grab_time) : '',
      release_time: tRelease != null ? r3(tRelease) : '',
      success: success ? 1 : 0,
      remaining_objects: remaining,
      run_id: this.runId,
    };
  }

  summary(objects) {
    return computeSummary(objects, this);
  }
}

export function computeSummary(objects, rec) {
  const side = (s) => objects.filter((o) => o.side === s);
  const L = side('left');
  const R = side('right');
  const found = (arr) => arr.filter((o) => rec.grabbedIds.has(o.id)).length;
  const inBox = (arr) => arr.filter((o) => o.inBox).length;
  const rate = (n, d) => (d ? n / d : null);
  return {
    run_id: rec.runId,
    condition: rec.condition,
    seed: rec.seed,
    duration_s: rec.endSec,
    left_total: L.length,
    right_total: R.length,
    left_found: found(L),
    right_found: found(R),
    left_found_rate: rate(found(L), L.length),
    right_found_rate: rate(found(R), R.length),
    left_collected: inBox(L),
    right_collected: inBox(R),
    left_remaining: L.length - inBox(L),
    right_remaining: R.length - inBox(R),
    remaining_total: objects.length - inBox(objects),
    max_left_rotation_deg: Math.max(0, -rec.minYaw),
    max_right_rotation_deg: Math.max(0, rec.maxYaw),
    first_left_scan_s: rec.firstLeftScanSec, // 頭部が左へ leftThreshold 度以上回旋した最初の時刻
    first_left_grab_s: rec.firstLeftGrabSec,
    left_scan_threshold_deg: rec.leftThreshold,
  };
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}

export function yawRows(rec) {
  return rec.yawSamples.map((s) => ({
    timestamp: rec.iso(s.t),
    run_id: rec.runId,
    condition: rec.condition,
    t_run_s: r3(s.t),
    head_yaw: r2(s.yaw),
    head_pitch: r2(s.pitch),
  }));
}
