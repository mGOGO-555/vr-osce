import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { CFG, CONDITIONS } from './config.js';
import { createWorld } from './scene.js';
import { ObjectSet } from './objects.js';
import { XRHands, SimHands } from './input.js';
import { GrabManager } from './grab.js';
import { UI } from './ui.js';
import { makeLayout, mulberry32 } from './layout.js';
import { stepRelief, nextCaptureDelay, pickCaptureTarget } from './salience.js';
import { RunRecorder, wrapDeg, toCsv, yawRows, GRAB_COLUMNS, YAW_COLUMNS } from './metrics.js';

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.getElementById('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.03, 30);
camera.rotation.order = 'YXZ';
const SIM_POSE = { y: 1.25, z: 0.15, pitch: -0.45 };
function resetSimCamera() {
  camera.position.set(0, SIM_POSE.y, SIM_POSE.z);
  camera.rotation.set(SIM_POSE.pitch, 0, 0);
}
resetSimCamera();

const world = createWorld(scene, camera);
const objects = new ObjectSet(world.desk);
const ui = new UI(scene, camera);
const xrHands = new XRHands(renderer, scene);

const app = {
  state: 'menu', // menu | calibrating | running | debrief | results
  cond: null, run: null, runs: [], last: {}, runCounter: 0,
  deskY: 0.75, yaw0: 0, relief: 0, neglectScale: 0, revealing: false,
  runStartMs: 0, captureIn: 0, rand: Math.random, finishAt: null, calib: null,
  yawRel: 0, pitch: 0,
};
const sim = new SimHands(renderer, camera, scene, () => app.deskY);
sim.uiClick = (ndc) => ui.clickNdc(ndc);
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

const grab = new GrabManager(world.desk, objects, {
  onGrab: (o) => { if (app.run) app.run.openGrab(o, tRun(), app.yawRel, app.pitch); },
  onRelease: (o) => { if (app.run) app.run.closeGrab(o, tRun(), o.inBox, objects.remaining.length); },
});

// ---------- helpers ----------
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const RAD = 180 / Math.PI;
function head() {
  camera.updateMatrixWorld(true);
  camera.getWorldPosition(_p);
  camera.getWorldDirection(_d);
  return { pos: _p, yawL: Math.atan2(-_d.x, -_d.z), pitch: Math.asin(Math.max(-1, Math.min(1, _d.y))) * RAD };
}
const tRun = () => (performance.now() - app.runStartMs) / 1000;
const inXR = () => renderer.xr.isPresenting;
const activeHands = () => (inXR() ? xrHands.hands : sim.hands);
const pct = (v, n, d) => (v == null ? '—' : `${Math.round(v * 100)}% (${n}/${d})`);
const deg = (v) => `${Math.round(v)}°`;
const sec = (v) => (v == null ? '未到達' : `${v.toFixed(1)} 秒`);

// ---------- screens ----------
function showMenu() {
  app.state = 'menu';
  world.mask.visible = false;
  world.cue.visible = false;
  ui.task.hide();
  const H = head();
  ui.placeFacing(ui.main, H.pos, H.yawL, 0.65, H.pos.y - 0.05);
  ui.main.show({
    title: '左半側空間無視 体験アプリ(教育用)',
    lines: [
      'これは患者さんの主観的体験そのものの再現ではありません。左側への探索・注意・行動選択が低下し、右側へ探索が偏る状態を教育的にモデル化したものです。',
      '椅子に座り、まっすぐ前を向いて、条件を指でタッチして選んでください。課題: 机の上の物をすべて中央の箱へ入れる。',
    ],
    footer: '操作: 親指と人差し指でつまんで持ち上げ、箱の上ではなします。ボタンは指先で押します。',
    buttons: [
      { id: 'startA', label: 'A 通常' },
      { id: 'startB', label: 'B 半盲(比較)' },
      { id: 'startC', label: 'C Neglect様', primary: true },
    ],
  });
}

function beginCalibration(cond) {
  app.state = 'calibrating';
  app.calib = { cond, t: 0, s: 0, c: 0, sec: -1 };
}

function updateCalibration(dt, H) {
  const c = app.calib;
  c.t += dt;
  if (c.t >= 2) { c.s += Math.sin(H.yawL); c.c += Math.cos(H.yawL); }
  const remain = Math.max(1, Math.ceil(3 - c.t));
  if (remain !== c.sec) {
    c.sec = remain;
    ui.main.show({
      title: 'まっすぐ前を向いて座ってください',
      lines: [`${remain}`, 'この向きを「身体正中」として、正面に机を配置します。'],
    });
  }
  if (c.t >= 3) startRun(c.cond, Math.atan2(c.s, c.c), H.pos);
}

function startRun(cond, yaw0, headPos) {
  const C = CONDITIONS[cond];
  app.cond = cond;
  app.yaw0 = yaw0;
  app.deskY = Math.max(0.45, headPos.y - CFG.desk.drop);
  world.placeDesk(headPos.x, headPos.z, app.deskY, yaw0);
  world.desk.updateMatrixWorld(true);
  app.runCounter++;
  const seed = CFG.seedBase + app.runCounter * 7919;
  const layout = makeLayout(seed, CFG.layout);
  objects.build(layout);
  app.run = new RunRecorder({
    runId: `run${String(app.runCounter).padStart(2, '0')}`, condition: cond, seed,
    startEpochMs: Date.now(), layout, leftThresholdDeg: CFG.scan.leftThresholdDeg, yawHz: CFG.yawSampleHz,
  });
  app.runStartMs = performance.now();
  app.relief = 0;
  app.neglectScale = C.neglect ? 1 : 0;
  app.revealing = false;
  app.finishAt = null;
  app.rand = mulberry32(seed + 1);
  app.captureIn = nextCaptureDelay(CFG.neglect, app.rand);
  world.mask.visible = C.hemianopia;
  world.cue.visible = C.scanCue;

  ui.main.hide();
  const tp = world.desk.localToWorld(new THREE.Vector3(0, 0.3, -0.66));
  ui.task.mesh.position.copy(tp);
  ui.task.mesh.rotation.set(0, yaw0, 0);
  ui.task.mesh.rotateX(-0.25);
  ui.task.show({
    small: true,
    title: '机の上の物をすべて中央の箱へ入れてください',
    lines: C.scanCue ? ['ヒント: 青い目印(左端)まで視線を動かしてから探しましょう。'] : [],
    buttons: [{ id: 'finish', label: '終了', primary: true }],
  });
  app.state = 'running';
}

function finishRun() {
  if (app.state !== 'running') return;
  const C = CONDITIONS[app.cond];
  const t = tRun();
  const remaining = objects.remaining.length;
  app.run.finalize(objects.items, t, remaining);
  const s = app.run.summary(objects.items);
  app.run.finalSummary = s;
  app.runs.push(app.run);
  app.last[app.cond] = s;
  world.mask.visible = false;
  ui.task.hide();
  refreshExportButtons();

  const H = head();
  ui.placeFacing(ui.main, H.pos, H.yawL, 0.65, H.pos.y - 0.02);
  const stats = statRows(s);
  const foot = '※発見=一度でも把持した物体。左方向の探索=頭部が左へ20°以上回旋。教育用モデルであり診断・評価ではありません。';
  if (C.neglect) {
    // デブリーフ: Neglect効果を解除し、見落とした左側物体を通常表示に戻す
    app.revealing = true;
    const leftRem = objects.items.filter((o) => o.side === 'left' && !o.inBox);
    objects.showHalos(leftRem);
    const msg = s.left_remaining > 0
      ? `あなたはすべて探索したつもりでしたが、左側に${s.left_remaining}個残っていました。`
      : '左側の物体もすべて回収できました。';
    const buttons = app.cond === 'neglect'
      ? [{ id: 'startScan', label: 'Scanning条件へ', primary: true }, { id: 'menu', label: 'メニューへ' }]
      : [{ id: 'compare', label: '比較を見る', primary: true }, { id: 'menu', label: 'メニューへ' }];
    ui.main.show({ title: 'デブリーフ', lines: [msg, `(右側の残り: ${s.right_remaining}個 / 青い輪が左側の残りです)`], table: { head: ['指標', '値'], rows: stats }, footer: foot, buttons });
    app.state = 'debrief';
  } else {
    ui.main.show({ title: `${C.label} — 結果`, table: { head: ['指標', '値'], rows: stats }, footer: foot, buttons: [{ id: 'menu', label: 'メニューへ', primary: true }] });
    app.state = 'results';
  }
}

function statRows(s) {
  return [
    ['左側物体 発見率', pct(s.left_found_rate, s.left_found, s.left_total)],
    ['右側物体 発見率', pct(s.right_found_rate, s.right_found, s.right_total)],
    ['最大 左回旋角', deg(s.max_left_rotation_deg)],
    ['最大 右回旋角', deg(s.max_right_rotation_deg)],
    ['左を最初に探索するまで', sec(s.first_left_scan_s)],
  ];
}

function showCompare() {
  const n = app.last.neglect;
  const c = app.last.scanning;
  const f = (s, k) => (s ? k(s) : '—');
  const rows = [
    ['左側 発見率', f(n, (s) => pct(s.left_found_rate, s.left_found, s.left_total)), f(c, (s) => pct(s.left_found_rate, s.left_found, s.left_total))],
    ['右側 発見率', f(n, (s) => pct(s.right_found_rate, s.right_found, s.right_total)), f(c, (s) => pct(s.right_found_rate, s.right_found, s.right_total))],
    ['最大 左回旋角', f(n, (s) => deg(s.max_left_rotation_deg)), f(c, (s) => deg(s.max_left_rotation_deg))],
    ['最大 右回旋角', f(n, (s) => deg(s.max_right_rotation_deg)), f(c, (s) => deg(s.max_right_rotation_deg))],
    ['左を最初に探索', f(n, (s) => sec(s.first_left_scan_s)), f(c, (s) => sec(s.first_left_scan_s))],
    ['左側の残り', f(n, (s) => `${s.left_remaining}個`), f(c, (s) => `${s.left_remaining}個`)],
  ];
  let line = 'Neglect-like と Scanning の両方を実施すると比較できます。';
  if (n && c && n.left_found_rate != null) {
    const a = Math.round(n.left_found_rate * 100), b = Math.round(c.left_found_rate * 100);
    line = `左側の発見率: ${a}% → ${b}%(Scanning cueあり)。`;
  }
  const H = head();
  ui.placeFacing(ui.main, H.pos, H.yawL, 0.65, H.pos.y - 0.02);
  ui.main.show({
    title: 'Neglect-like と Scanning の比較', lines: [line],
    table: { head: ['指標', 'Neglect-like', 'Scanning'], rows },
    footer: '同一参加者・1回ずつの体験値であり、効果の検証結果ではありません(物体配置は実行ごとに入れ替え)。',
    buttons: [{ id: 'menu', label: 'メニューへ', primary: true }],
  });
  app.state = 'results';
}

ui.onPress = (id) => {
  if (id === 'startA') beginCalibration('normal');
  else if (id === 'startB') beginCalibration('hemianopia');
  else if (id === 'startC') beginCalibration('neglect');
  else if (id === 'startScan') beginCalibration('scanning');
  else if (id === 'finish') finishRun();
  else if (id === 'compare') showCompare();
  else if (id === 'menu') showMenu();
};

// ---------- per-frame ----------
function updateRunning(dt, H) {
  const C = CONDITIONS[app.cond];
  app.yawRel = wrapDeg(-(H.yawL - app.yaw0) * RAD);
  app.pitch = H.pitch;
  app.run.addYaw(tRun(), app.yawRel, app.pitch);
  if (C.neglect) {
    app.relief = stepRelief(app.relief, app.yawRel, dt, CFG.neglect);
    app.captureIn -= dt;
    if (app.captureIn <= 0) {
      const o = pickCaptureTarget(objects.items, app.rand);
      if (o) { objects.triggerCapture(o); app.run.logEvent(tRun(), 'attention_capture', o.id); }
      app.captureIn = nextCaptureDelay(CFG.neglect, app.rand);
    }
  }
  if (C.scanCue) world.updateCue(tRun());
  // 全て回収したら少し待って自動終了
  const all = objects.items.length && objects.items.every((o) => o.inBox && !o.falling);
  if (all && app.finishAt == null) app.finishAt = performance.now() + 1500;
  if (!all) app.finishAt = null;
  if (app.finishAt && performance.now() > app.finishAt) finishRun();
}

let last = performance.now();
let xrFrames = 0;
function animate() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  const xr = inXR();
  sim.cursor.visible = !xr;
  if (xr) {
    xrFrames++;
    xrHands.update();
    if (xrFrames === 15) {
      const h0 = head();
      app.deskY = Math.max(0.45, h0.pos.y - CFG.desk.drop);
      world.placeDesk(h0.pos.x, h0.pos.z, app.deskY, h0.yawL);
      showMenu();
    }
  } else {
    sim.updateHead(dt);
    sim.update();
  }
  const hands = activeHands();
  const H = head();

  if (app.state === 'calibrating') updateCalibration(dt, H);
  if (app.state === 'running') updateRunning(dt, H);
  if (app.revealing) {
    app.neglectScale = Math.max(0, app.neglectScale - dt / CFG.neglect.revealSec);
    if (app.neglectScale === 0) app.revealing = false;
  }

  grab.update(hands, app.state === 'running');
  objects.update(dt, {
    neglect: !!(app.cond && CONDITIONS[app.cond].neglect),
    relief: app.relief, neglectScale: app.neglectScale,
    floorLocalY: -app.deskY,
    boxCount: objects.items.filter((o) => o.inBox).length,
  });
  ui.update(dt, hands);
  renderer.render(scene, camera);
}

// ---------- session lifecycle ----------
renderer.xr.addEventListener('sessionstart', () => {
  xrFrames = 0;
  document.body.classList.add('in-xr');
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-xr');
  resetSimCamera();
  app.state = 'menu';
  showMenu();
  refreshExportButtons();
});

const sessionInit = { requiredFeatures: ['hand-tracking'], optionalFeatures: ['local-floor'] };
const vrBtn = VRButton.createButton(renderer, sessionInit);
document.getElementById('vr-slot').appendChild(vrBtn);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- export ----------
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
export function exportGrabCsv() { return toCsv(app.runs.flatMap((r) => r.grabRows), GRAB_COLUMNS); }
export function exportYawCsv() { return toCsv(app.runs.flatMap((r) => yawRows(r)), YAW_COLUMNS); }
export function exportJson() {
  return JSON.stringify({
    generated: new Date().toISOString(),
    convention: 'head_yaw/object_angle: negative=left, positive=right, 0=calibrated body midline; head_pitch: up=positive',
    runs: app.runs.map((r) => ({ summary: r.finalSummary, events: r.events, layout: r.layout })),
  }, null, 2);
}
function refreshExportButtons() {
  const has = app.runs.length > 0;
  for (const id of ['dl-grab', 'dl-yaw', 'dl-json']) document.getElementById(id).disabled = !has;
  document.getElementById('run-count').textContent = `記録済み: ${app.runs.length} run`;
}
document.getElementById('dl-grab').onclick = () => download(`neglect_grab_${stamp()}.csv`, exportGrabCsv(), 'text/csv');
document.getElementById('dl-yaw').onclick = () => download(`neglect_headyaw_${stamp()}.csv`, exportYawCsv(), 'text/csv');
document.getElementById('dl-json').onclick = () => download(`neglect_summary_${stamp()}.json`, exportJson(), 'application/json');
refreshExportButtons();

// 初期表示: 空の机とメニュー
world.placeDesk(0, 0, app.deskY, 0);
showMenu();
renderer.setAnimationLoop(animate);

window.__app = { app, objects, world, ui, sim, camera, renderer, head, startRun, finishRun, showMenu, beginCalibration, exportGrabCsv, exportYawCsv };
