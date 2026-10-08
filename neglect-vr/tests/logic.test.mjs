// 実行: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { CFG } from '../js/config.js';
import { baseSuppression, stepRelief, effectiveSuppression, visualParams } from '../js/salience.js';
import { makeLayout } from '../js/layout.js';
import { RunRecorder, computeSummary, toCsv, GRAB_COLUMNS, wrapDeg } from '../js/metrics.js';

const N = CFG.neglect;

test('右・正中では抑制0、左ほど強い(単調)', () => {
  assert.equal(baseSuppression(30, N), 0);
  assert.equal(baseSuppression(0, N), 0);
  let prev = 0;
  for (let a = -5; a >= -60; a -= 5) {
    const s = baseSuppression(a, N);
    assert.ok(s >= prev);
    prev = s;
  }
  assert.equal(baseSuppression(-60, N), 1);
});

test('抑制は「軽度」: 最大でも机色へ40%、彩度50%低下、opacityの概念なし', () => {
  const v = visualParams(1, N);
  assert.ok(v.mix <= 0.4 + 1e-9 && v.satScale >= 0.5 - 1e-9 && v.hoverScale > 0);
  assert.equal('opacity' in v, false);
});

test('頭部を左へ回旋すると解除が進み、正面に戻ると緩やかに再抑制', () => {
  let r = 0;
  for (let i = 0; i < 300; i++) r = stepRelief(r, -40, 1 / 60, N); // 5秒
  assert.ok(r > 0.5 && r <= 1);
  const r2 = stepRelief(r, 0, 1, N);
  assert.ok(r2 < r && r2 > r - 0.1);
  assert.equal(stepRelief(0.3, -15, 1, N), 0.3); // 10〜20°左(中間帯)は変化なし
  assert.ok(stepRelief(0.3, 30, 1, N) < 0.3); // 右を向くと再抑制側
});

test('effectiveSuppression: neglectScale=0で完全に通常表示', () => {
  assert.equal(effectiveSuppression(-50, 0, 0, N), 0);
  assert.ok(effectiveSuppression(-50, 0, 1, N) > 0.9);
  assert.equal(effectiveSuppression(-50, 1, 1, N), 0);
});

test('レイアウト: 左右8個ずつ・対称・angle符号・再現性', () => {
  const a = makeLayout(1234, CFG.layout);
  const b = makeLayout(1234, CFG.layout);
  assert.deepEqual(a, b);
  assert.equal(a.length, 16);
  assert.equal(a.filter((o) => o.side === 'left').length, 8);
  assert.ok(a.filter((o) => o.side === 'left').every((o) => o.angle < 0 && o.x < 0));
  assert.ok(a.filter((o) => o.side === 'right').every((o) => o.angle > 0 && o.x > 0));
  // 箱(x±0.12)と重ならない
  assert.ok(a.every((o) => Math.abs(o.x) > 0.19));
  assert.notDeepEqual(a.map((o) => o.type), makeLayout(99, CFG.layout).map((o) => o.type));
});

test('wrapDeg', () => {
  assert.equal(wrapDeg(190), -170);
  assert.equal(wrapDeg(-190), 170);
});

test('RunRecorder: 指標・ログ列・残存記録', () => {
  const layout = makeLayout(1, CFG.layout);
  const rec = new RunRecorder({ runId: 'r1', condition: 'neglect', seed: 1, startEpochMs: 0, layout });
  const objs = layout.map((o) => ({ ...o, inBox: false }));
  // 頭部: 右10°→ 左25°(=1.0秒時点で左探索) → 左45°
  rec.addYaw(0.0, 10, 0); rec.addYaw(0.5, 0, 0); rec.addYaw(1.0, -25, 0); rec.addYaw(2.0, -45, 0);
  const right = objs.find((o) => o.side === 'right');
  rec.openGrab(right, 0.8, 5, -20);
  right.inBox = true;
  rec.closeGrab(right, 2.0, true, 15);
  const left = objs.find((o) => o.side === 'left');
  rec.openGrab(left, 2.5, -40, -30);
  left.inBox = true;
  rec.closeGrab(left, 3.0, true, 14);
  rec.finalize(objs, 10, 14);
  const s = computeSummary(objs, rec);
  assert.equal(s.left_found, 1); assert.equal(s.right_found, 1);
  assert.equal(s.left_found_rate, 1 / 8);
  assert.equal(s.max_left_rotation_deg, 45);
  assert.equal(s.max_right_rotation_deg, 10);
  assert.equal(s.first_left_scan_s, 1.0);
  assert.equal(s.first_left_grab_s, 2.5);
  assert.equal(s.left_remaining, 7);
  // 行: 把持2 + 残存14 = 16
  assert.equal(rec.grabRows.length, 16);
  const csv = toCsv(rec.grabRows, GRAB_COLUMNS);
  assert.ok(csv.startsWith('timestamp,condition,object_id,object_side,object_angle,head_yaw,head_pitch,grab_time,release_time,success,remaining_objects'));
  assert.equal(csv.trim().split('\n').length, 17);
});
