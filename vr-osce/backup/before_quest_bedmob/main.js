// VR-OSCE PoC  STEP 3: VR病室に入り患者を見る（最小版）
// 座標: 学生は z=+1.6 に立ち、-z 方向（患者側）を向く。患者は +z を向いて座る。
// 患者の右側 = -x、患者の左側 = +x。
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { Panel } from './ui.js';
import { createPatient } from './patient.js';
import { Logger } from './logger.js';
import { asr, prepare as asrPrepare, startRecording, cancelRecording, stopAndRecognize, matchItem } from './asr.js';
import { scoreStation } from './scoring.js';
import { buildSession, logCSV, scoresCSV, fileBase, download } from './exporter.js';

// ---------- 基本セットアップ ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5f6568);

// rig: 学生の立ち位置。VR中はrigを動かさず、ヘッドセットの姿勢がcameraに反映される。
const rig = new THREE.Group();
rig.position.set(13.2, 0, 3.85);   // 開始時は長い廊下の端。「開始」で病室のドアの前へ移動し、入室する
scene.add(rig);
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 50);
camera.position.set(0, 1.6, 0); // PC用の目の高さ（VR中は上書きされる）
camera.rotation.order = 'YXZ';
camera.rotation.x = -0.1; // PC初期視点：ドアの方を向く（VR中は無視される）
camera.rotation.y = 0;
rig.add(camera);

// ---------- 照明 ----------
scene.add(new THREE.HemisphereLight(0xfff6ea, 0x8a8f90, 2.1));
const sun = new THREE.DirectionalLight(0xfff2e0, 1.3);
sun.position.set(2, 4, 3);
scene.add(sun);

// ---------- 素材（落ち着いた医療教育用の配色） ----------
const mat = (c, r = 0.9) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
const M = {
  floor: mat(0x8a8d8a), wall: mat(0xc0bdb4), trim: mat(0x96948c),
  bedFrame: mat(0x565d62), mattress: mat(0xd4d3cc), sheet: mat(0x97a3a5),
  skin: mat(0xd2a285), hair: mat(0x9a9a9a), gown: mat(0x8f9da2), pants: mat(0x4e5a62),
  shoe: mat(0x3a4249), chair: mat(0x2f353a), wheel: mat(0x23282c), metal: mat(0x8a9397, 0.4),
  table: mat(0x9c8e7b), window: mat(0x93a8ae),
};
const box = (w, h, d, m, x, y, z, parent = scene) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z); parent.add(o); return o;
};

// ---------- 病室 ----------
box(5, 0.05, 5, M.floor, 0, -0.025, 0);                 // 床
box(5, 2.8, 0.1, M.wall, 0, 1.4, -2.5);                 // 奥壁
box(0.1, 2.8, 5, M.wall, -2.5, 1.4, 0);                 // 右壁（患者の右側）
box(0.1, 2.8, 5, M.wall, 2.5, 1.4, 0);                  // 左壁
box(5, 0.1, 0.12, M.trim, 0, 0.05, -2.47);              // 巾木
box(1.6, 1.1, 0.04, M.window, -1.3, 1.5, -2.44);        // 窓
box(0.45, 0.7, 0.4, M.table, 1.45, 0.35, -1.6);         // 床頭台

// 手前の壁（ドア付き）。ドア開口は x=1.1〜2.1。その外は長い病院の廊下（x=-2.5〜16、奥行き2.7m）
box(3.6, 2.8, 0.1, M.wall, -0.7, 1.4, 2.5); box(1.0, 0.8, 0.1, M.wall, 1.6, 2.4, 2.5);
const doorPivot = new THREE.Group(); doorPivot.position.set(1.1, 0, 2.5); scene.add(doorPivot);   // 蝶番は x=1.1 側。室内側へ開く
box(1.0, 2.0, 0.05, mat(0x76654f), 0.5, 1.0, 0, doorPivot);
box(0.1, 0.03, 0.08, M.metal, 0.88, 1.0, 0, doorPivot);

// ---------- 廊下 ----------
const CX0 = -2.5, CX1 = 16, CZ0 = 2.5, CZ1 = 5.2, CL = CX1 - CX0, CXM = (CX0 + CX1) / 2, CZM = (CZ0 + CZ1) / 2;
const lightM = new THREE.MeshBasicMaterial({ color: 0xfffbe8 });
box(CL, 0.05, CZ1 - CZ0, mat(0x9ea39b, 0.7), CXM, -0.025, CZM);              // 床
box(CL, 0.05, CZ1 - CZ0, new THREE.MeshStandardMaterial({ color: 0xdcdcd5, emissive: 0x8a8a84, roughness: 1 }), CXM, 2.8, CZM);   // 天井
box(CL, 2.8, 0.1, M.wall, CXM, 1.4, CZ1);                                    // 向かいの壁
box(0.1, 2.8, CZ1 - CZ0, M.wall, CX0, 1.4, CZM); box(0.1, 2.8, CZ1 - CZ0, M.wall, CX1, 1.4, CZM);   // 両端
box(CX1 - 2.1, 2.8, 0.1, M.wall, (2.1 + CX1) / 2, 1.4, CZ0);                 // 病室側の壁（ドアの外側）
box(CL, 0.07, 0.03, M.trim, CXM, 0.04, CZ0 + 0.07); box(CL, 0.07, 0.03, M.trim, CXM, 0.04, CZ1 - 0.07);   // 巾木
box(CX1 - 2.1, 0.05, 0.06, mat(0xb9ad94), (2.1 + CX1) / 2, 0.9, CZ0 + 0.09); box(CL, 0.05, 0.06, mat(0xb9ad94), CXM, 0.9, CZ1 - 0.09);   // 手すり
box(CL, 0.004, 0.09, mat(0xd8b34a), CXM, 0.003, CZM);                        // 床の誘導ライン
for (let x = -1; x <= 15; x += 3) box(1.1, 0.02, 0.35, lightM, x, 2.78, CZM);   // 天井照明
for (let x = 0.5; x <= 14.5; x += 3.5) box(1.4, 1.0, 0.04, M.window, x, 1.55, CZ1 - 0.07);    // 窓
const plate = (lines, w, h, x, y, z, bg = '#f4f1ea', fg = '#243239') => {      // 文字板（canvas）
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = Math.round(512 * h / w);
  const g = cv.getContext('2d'); g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = '#8c8f90'; g.lineWidth = 6; g.strokeRect(3, 3, cv.width - 6, cv.height - 6);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((t, i) => { g.font = `${i === 0 ? 700 : 500} ${i === 0 ? 92 : 46}px "Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif`; g.fillText(t, cv.width / 2, cv.height * (lines.length === 1 ? 0.5 : 0.34 + 0.38 * i), cv.width - 30); });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
  mesh.position.set(x, y, z); scene.add(mesh); return mesh;
};
const doorMat = mat(0x8a7a62);
const decoDoors = [];   // 他の病室（飾り）。札の番号は症例の病室番号を避けて付け直す
for (const x of [5.3, 8.1, 10.9, 13.7]) { box(1.0, 2.05, 0.06, doorMat, x, 1.025, CZ0 + 0.03); decoDoors.push(x); }
let decoPlates = [];
let roomPlate = null;
function setRoomPlates(room) {
  for (const p of [...decoPlates, roomPlate]) if (p) { scene.remove(p); p.material.map.dispose(); p.geometry.dispose(); }
  const num = parseInt(room.number, 10);
  const others = [num - 3, num - 2, num - 1, num + 1, num + 2, num + 3].filter(n => n !== num).slice(0, 4);
  decoPlates = decoDoors.map((x, i) => plate([`${others[i]}`], 0.3, 0.14, x + 0.72, 1.45, CZ0 + 0.07));
  roomPlate = plate([`${room.number}`, `${room.name} 様`], 0.34, 0.22, 2.38, 1.45, CZ0 + 0.07);   // 患者の病室の札（ドアの脇）
}
plate(['ナースステーション', '→'], 1.4, 0.45, CX1 - 0.07, 2.2, CZM, '#2f6f8f', '#fff').rotation.y = -Math.PI / 2;
{ const d = box(0.7, 1.05, 2.2, mat(0x9c8e7b), CX1 - 0.5, 0.52, CZM); d.visible = true; }   // ナースステーションのカウンター

// ---------- ベッド（端座位の縁は z=0） ----------
box(1.0, 0.12, 2.0, M.bedFrame, 0, 0.3, -1.0);
box(1.0, 0.14, 2.0, M.mattress, 0, 0.43, -1.0);
box(1.0, 0.04, 1.2, M.sheet, 0, 0.52, -1.4);            // 掛け布団
box(1.0, 0.7, 0.06, M.bedFrame, 0, 0.75, -2.0);         // ヘッドボード
for (const [x, z] of [[-0.45, -0.05], [0.45, -0.05], [-0.45, -1.95], [0.45, -1.95]]) box(0.06, 0.24, 0.06, M.metal, x, 0.12, z);

// ---------- 患者（72歳男性・端座位・右片麻痺）: 関節付き。詳細は patient.js ----------
// 固定設定: 右足はやや前方、体重は左へ偏位、右上肢は体側〜大腿上。
let patient = null;   // 症例の読み込み時に生成（loadCase）

// ---------- 車椅子（患者の左側 +x、ベッド脇） ----------
const wc = new THREE.Group();
wc.position.set(1.05, 0, 0.25);
wc.rotation.y = -0.35;
scene.add(wc);
box(0.46, 0.05, 0.42, M.chair, 0, 0.48, 0, wc);                    // 座面
box(0.46, 0.5, 0.05, M.chair, 0, 0.75, -0.2, wc);                  // 背もたれ
box(0.04, 0.04, 0.3, M.metal, -0.25, 0.68, -0.03, wc);             // 肘掛
box(0.04, 0.04, 0.3, M.metal, 0.25, 0.68, -0.03, wc);
for (const s of [-1, 1]) {
  const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 28), M.wheel);
  w.rotation.z = Math.PI / 2; w.position.set(s * 0.29, 0.3, -0.12); wc.add(w);   // 後輪
  const f = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.04, 16), M.wheel);
  f.rotation.z = Math.PI / 2; f.position.set(s * 0.22, 0.08, 0.22); wc.add(f);   // 前輪（キャスター）
  box(0.03, 0.03, 0.22, M.metal, s * 0.2, 0.16, 0.18, wc);                         // フットレスト
}

// ---------- 入力（STEP 3: rayの表示のみ。選択処理はSTEP 4） ----------
const controllers = [];
const handFactory = new XRHandModelFactory();
handFactory.setPath('./assets/hands/');   // 手のモデル（generic-hand。外部CDNを使わずローカルから読み込む）
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -2)]),
    new THREE.LineBasicMaterial({ color: 0x2f6f8f }));
  line.name = 'ray';
  c.add(line);
  c.add(new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0x2f6f8f })));
  rig.add(c);
  controllers.push(c);
  // ハンドトラッキング：手のメッシュ（リアルな手）を表示。つまみ（ピンチ）はコントローラーのトリガー相当の select として届く
  const hand = renderer.xr.getHand(i);
  hand.add(handFactory.createHandModel(hand, 'mesh'));
  rig.add(hand);
}

// ---------- PC用: ドラッグで視点回転／クリックでボタン選択 ----------
let dragging = false, moved = 0, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; moved = 0; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('pointerup', (e) => {
  const wasClick = dragging && moved < 5;   // ほとんど動いていなければクリック扱い
  dragging = false;
  if (wasClick && !renderer.xr.isPresenting) { const p = pcPick(e); if (p.btn) onButton(p.btn.id); else if (p.spot) teleportTo(p.spot); }
});
window.addEventListener('pointermove', (e) => {
  if (renderer.xr.isPresenting) return;
  if (dragging) {
    moved += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
    camera.rotation.y -= (e.clientX - lastX) * 0.004;
    camera.rotation.x = Math.max(-1.2, Math.min(1.2, camera.rotation.x - (e.clientY - lastY) * 0.004));
    lastX = e.clientX; lastY = e.clientY;
  } else if (e.target === renderer.domElement) {
    const p = pcPick(e);
    panel.setHover(p.btn); hoverSpot = p.spot;
    renderer.domElement.style.cursor = p.btn || p.spot ? 'pointer' : 'grab';
  }
});

// ---------- ID入力（VRに入る前の2D画面） ----------
const sidInput = document.getElementById('sid');
const errEl = document.getElementById('err');
const slot = document.getElementById('vrslot');
let studentId = '';
document.getElementById('confirm').addEventListener('click', () => {
  const v = sidInput.value.trim();
  if (!/^[A-Za-z0-9_-]{1,16}$/.test(v)) { errEl.textContent = '半角英数字（例：S001）で入力してください。'; return; }
  errEl.textContent = '';
  studentId = v;
  sessionStorage.setItem('osce_student_id', studentId);
  sidInput.disabled = true;
  if (!/[?&]asr=0/.test(location.search)) asrPrepare();   // マイク許可と認識モデルの読み込み（ユーザー操作の中で開始）
  if (!slot.firstChild) slot.appendChild(VRButton.createButton(renderer, { optionalFeatures: ['hand-tracking'] }));
  if (CASE && S.phase === 'start') showStart();   // 開始ボタンを有効化
  updateHud();
});

// ---------- STEP 4: 選択UIパネルと画面遷移 ----------
const panel = new Panel({ width: 1.0, height: 0.75 });
let pageMs = 0;   // 画面を切り替えた時刻。切り替え直後の押し込み（同じ位置に別のボタンが出る）を無視するために使う
{ const orig = panel.setPage.bind(panel); panel.setPage = (p) => { pageMs = performance.now(); orig(p); }; }
scene.add(panel.mesh);

// ---------- STEP 12: 移動（テレポート）----------
// 立ち位置は決まった地点だけ。床の輪にレイを当てて、トリガー（またはピンチ・PCではクリック）で移動する。
// panel: その地点で使うパネルの位置、yaw: PCでの向き（VRではヘッドセットの向きが優先）
const SPOTS = {
  corridor:   { label: '廊下',         x: 13.2,  z: 3.85, panel: [11.8, 4.3],  yaw: Math.PI / 2,      pitch: -0.04 },
  hall:       { label: '病室の前',     x: 1.6,   z: 3.5,  panel: [1.6, 2.65],   yaw: 0,                pitch: -0.1 },
  front_far:  { label: '正面（遠）',   x: 0,     z: 1.7,  panel: [-0.85, 0.3],  yaw: 0.3,              pitch: -0.3 },
  front_near: { label: '正面（近）',   x: 0,     z: 0.85,  panel: [-0.95, 0.15], yaw: 0.35,             pitch: -0.25 },
  right:      { label: '患者の右側',   x: -0.8,  z: 0.15, panel: [-1.15, -0.85], yaw: -Math.PI / 2 + 0.95, pitch: -0.2 },
  left:       { label: '患者の左側',   x: 1.3,   z: -0.75, panel: [1.0, 0.75],   yaw: Math.PI / 2 + 0.95, pitch: -0.2 },
};
function placePanelFor(spot) {
  panel.mesh.position.set(spot.panel[0], 1.35, spot.panel[1]);
  panel.mesh.rotation.y = Math.atan2(spot.x - spot.panel[0], spot.z - spot.panel[1]);   // 学生の方へ向ける
}
placePanelFor(SPOTS.corridor);
const markers = [];   // 床の移動マーカー
function makeLabel(text) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const g = cv.getContext('2d'); g.fillStyle = 'rgba(47,111,143,0.9)'; g.beginPath(); g.roundRect(4, 4, 248, 56, 14); g.fill();
  g.fillStyle = '#fff'; g.font = '600 30px "Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 34, 236);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false }));
  sp.scale.set(0.4, 0.1, 1); sp.renderOrder = 5; return sp;
}
for (const [id, sp] of Object.entries(SPOTS)) {
  if (id === 'hall' || id === 'corridor') continue;
  const g = new THREE.Group(); g.position.set(sp.x, 0.012, sp.z);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), new THREE.MeshBasicMaterial({ color: 0x2f6f8f, transparent: true, opacity: 0.28 }));
  disc.rotation.x = -Math.PI / 2; disc.userData.spot = id; g.add(disc);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.3, 40), new THREE.MeshBasicMaterial({ color: 0x2f6f8f }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; g.add(ring);
  const lab = makeLabel(sp.label); lab.position.y = 0.55; g.add(lab);
  g.userData = { id, disc, ring }; scene.add(g); markers.push(g);
}
let curSpot = 'corridor', hoverSpot = null;
function refreshMarkers() {
  const show = ['menu', 'category', 'result', 'standing', 'hold', 'walk', 'walk_back', 'stand_obs', 'stand_obs_result', 'sitting_back', 'judgement', 'end'].includes(S.phase) && !fade.busy;
  for (const m of markers) {
    m.visible = show && m.userData.id !== curSpot;
    const hv = hoverSpot === m.userData.id;
    m.userData.disc.material.opacity = hv ? 0.6 : 0.28; m.userData.ring.scale.setScalar(hv ? 1.15 : 1);
  }
}
// 移動時の暗転（酔い防止）。カメラの子として、目の前に黒い板を置く
const fadeMesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false }));
fadeMesh.position.z = -0.25; fadeMesh.renderOrder = 999; fadeMesh.visible = false; camera.add(fadeMesh);
const fade = { busy: false };
const tweens = [];   // { t, dur, fn, done }
function tween(dur, fn, done) { tweens.push({ t: 0, dur, fn, done }); }
function setFade(a) { fadeMesh.material.opacity = a; fadeMesh.visible = a > 0.001; }
function moveTo(id) {
  const sp = SPOTS[id];
  rig.position.set(sp.x - camera.position.x, 0, sp.z - camera.position.z);   // 頭の位置が地点に来るように
  if (!renderer.xr.isPresenting) camera.rotation.set(sp.pitch, sp.yaw, 0);
  placePanelFor(sp); curSpot = id; hoverSpot = null;
}
function teleportTo(id, opts = {}) {
  if (fade.busy || id === curSpot || !SPOTS[id]) return;
  fade.busy = true; refreshMarkers();
  tween(0.15, u => setFade(u), () => {
    moveTo(id);
    if (logger && !opts.silent) logger.record({ action: 'move', selection: SPOTS[id].label, result: `x=${SPOTS[id].x}, z=${SPOTS[id].z}` });
    tween(0.2, u => setFade(1 - u), () => { fade.busy = false; refreshMarkers(); if (opts.done) opts.done(); });
  });
}
// ---- STEP 13: 入室（ドアを開けて、暗転して室内の正面（遠）へ）----
function enterRoom(done) {
  S.phase = 'entering';
  panel.setPage({ title: CASE.title, body: 'ドアを開けて入室します…', buttons: [] });
  const open = 0.95 * Math.PI / 2;
  tween(1.1, u => { doorPivot.rotation.y = open * (1 - (1 - u) * (1 - u)); }, () => {
    teleportTo('front_far', { silent: true, done: () => {
      logger.record({ action: 'enter_room', selection: 'ドアから入室' });
      tween(1.2, u => { doorPivot.rotation.y = open * (1 - u); });   // 背後でドアが閉まる
      done();
    } });
  });
}

let CASE = null;
const S = { rank: [], assist: {}, eff: {}, motionAssist: {}, phase: 'loading', startMs: null, category: null, answers: {}, result: null, resultPage: 0 };
let logger = null;   // 「開始」で生成。全操作を時系列で記録する

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function remainingSec() {
  const limit = CASE ? CASE.time_limit_sec : 420;
  if (S.startMs === null) return limit;
  const now = S.endMs ?? performance.now();   // 終了後は残り時間を固定
  return Math.max(0, limit - Math.floor((now - S.startMs) / 1000));
}
function updateHud() {
  panel.setHud({ left: `学生ID：${studentId || '（未入力）'}`, right: `残り ${fmtTime(remainingSec())}` });
}

// ---- 患者の声（ブラウザの読み上げ機能。症例JSONの patient.voice で声の高さ・速さを変える）----
const tts = 'speechSynthesis' in window ? window.speechSynthesis : null;
let voiceOn = true, jaVoice = null;
function pickVoice() { if (!tts) return; const vs = tts.getVoices(); jaVoice = vs.find(v => /^ja/i.test(v.lang)) || null; }
if (tts) { pickVoice(); tts.addEventListener('voiceschanged', pickVoice); }
function speak(text) {
  if (!tts || !voiceOn || !text) return;
  tts.cancel();
  const v = (CASE && CASE.patient && CASE.patient.voice) || {};
  const parts = v.pause ? text.split(/(?<=[。！？])/).filter(Boolean) : [text];   // 息切れの患者は文ごとに間をあける
  parts.forEach((t, i) => {
    const u = new SpeechSynthesisUtterance(t);
    u.lang = 'ja-JP'; if (jaVoice) u.voice = jaVoice;
    u.pitch = v.pitch ?? 1; u.rate = v.rate ?? 0.9;
    tts.speak(u);
    if (v.pause && i < parts.length - 1) { const p = new SpeechSynthesisUtterance('　'); p.lang = 'ja-JP'; p.volume = 0; p.rate = 0.5; tts.speak(p); }
  });
}
// 症例（患者）の選択。VR内のボタンで選ぶ（URLに ?case= があれば選択を省略し、その症例から始める）
function showCaseSelect() {
  S.phase = 'case_select';
  panel.setPage({
    title: 'VR-OSCE',
    body: '評価する患者（症例）を選んでください。',
    buttons: CASE_LIST.map(c => ({ id: `case:${c.id}`, label: c.short || c.label })),
  });
}
function pickCase(id) {
  if (S.phase !== 'case_select' && S.phase !== 'start') return;
  const c = CASE_LIST.find(x => x.id === id); if (c) loadCase(c.file);
}
function showStart() {
  S.phase = 'start';
  panel.setPage({
    title: CASE.title,
    body: CASE.intro + '\n\n「開始」を押すと、ドアを開けて入室します。' + (studentId ? '' : '\n\n※先に学生IDを入力してください（PC画面左上）。'),
    buttons: [{ id: 'start', label: '開始', disabled: !studentId }, ...(CASE_LIST.length > 1 && !LOCKED_CASE ? [{ id: 'to_case_select', label: '← 症例を選び直す', kind: 'back' }] : [])],
  });
}
function showMenu() {
  S.phase = 'menu'; S.category = null;
  panel.setPage({
    title: CASE.title,
    body: '実施する項目の分類を選んでください。',
    buttons: [
      ...CASE.menu.map(c => ({ id: `cat:${c.id}`, label: c.label })),
      ...(tts ? [{ id: 'toggle_voice', label: `患者の声：${voiceOn ? 'ON' : 'OFF'}`, kind: 'back' }] : []),
      { id: 'finish', label: 'Station終了', kind: 'back' },
    ],
  });
}
function showCategory(catId) {
  const cat = CASE.menu.find(c => c.id === catId);
  S.phase = 'category'; S.category = catId;
  panel.setPage({
    title: `${CASE.title} ／ ${cat.label}`,
    body: cat.hint ? `項目を選んでください。\n${cat.hint}` : '項目を選んでください。',
    buttons: [
      ...(cat.type === 'dialogue' && asr.status !== 'idle' ? [{ id: 'voice_ask', label: asr.status === 'ready' ? '声で質問する（マイク）' : asr.status === 'loading' ? `声で質問（${asr.note}）` : `声で質問（使えません：${asr.note}）`, disabled: asr.status !== 'ready' }] : []),
      ...cat.items.map(it => ({ id: `item:${catId}:${it.id}`, label: it.label })),
      { id: 'back_menu', label: '← 分類に戻る', kind: 'back' },
    ],
  });
}
// 介助の状態に応じた返答（JSONの if_assist：最初に該当したものを使う）
// 返答は状態で変わる：if_assist（介助の有無）→ if_state（立位後・歩行後など。JSON順に最初に該当したもの）→ 通常の response
const STATE_OF = {
  stood: () => !!logger && (logger.has('start_sit_to_stand') || logger.has('auto_stand_up')),
  walked: () => !!logger && logger.has('assess_gait'),
};
const respOf = (o) => {
  for (const [k, txt] of Object.entries(o.if_assist || {})) if (ASSIST_KEY[k] ? S.motionAssist[ASSIST_KEY[k]] : (!!logger && logger.has(k))) return txt;   // 動きに効く介助は開始時点の状態、それ以外（口すぼめ呼吸の促しなど）は実施済みかどうか
  for (const [k, txt] of Object.entries(o.if_state || {})) if (STATE_OF[k] && STATE_OF[k]()) return txt;
  return o.response;
};
let ASSIST_KEY = {};      // 介助項目ID → 効果（knee/trunk/pelvis）。症例JSONの assist 分類の `effect` から作る
let ZONE_ITEM = {};       // 効果 → 手で触れる部位の項目ID（`zone: true` の項目）
const contact = { knee: false, trunk: false, pelvis: false };   // 手が触れている部位
// 介助の状態＝「介助を入れた（ボタンまたは手で触れて確定）」or「いま手が触れている」。患者へ反映する
function syncAssist() {
  S.eff = { knee: !!(S.assist.knee || contact.knee), trunk: !!(S.assist.trunk || contact.trunk), pelvis: !!(S.assist.pelvis || contact.pelvis), cue: !!S.assist.cue };
  patient.setAssist(S.eff);
}
// 動作（立ち上がり・立位保持・歩行）の開始時点の介助を記録し、その動作の観察結果の文面に使う
const snapAssist = () => { S.motionAssist = { ...S.eff }; };
// 立ち上がる前に必要な確認（車椅子ブレーキなど。症例JSONの scoring.safety_errors）が未実施なら Safety error として記録（ゲームオーバーにはしない）
function standSafety() {
  const miss = (CASE.scoring.safety_errors || []).filter(er => er.before === 'start_sit_to_stand' && !logger.has(er.requires));
  return { correct: miss.length ? false : null, safety_flag: miss.map(er => `${er.id}_before_stand`).join('|') };
}
function showResult(catId, itemId) {
  const cat = CASE.menu.find(c => c.id === catId);
  const it = cat.items.find(i => i.id === itemId);
  if (itemId === 'assess_sit_to_stand' || itemId === 'assess_standing' || itemId === 'assess_gait') snapAssist();
  // 立ち上がり評価を実施済みで立位のままなら、動作はやり直さず観察画面へ
  if (itemId === 'assess_sit_to_stand' && S.standing && logger.has('start_sit_to_stand')) { showStandObservations(); return; }
  // 行動ログ。立ち上がり評価の前に車椅子ブレーキ未確認なら Safety error として記録（ゲームオーバーにはしない）
  const sf = itemId === 'assess_sit_to_stand' ? standSafety() : { correct: null, safety_flag: '' };
  logger.record({ action: it.log_action || it.id, selection: it.label, result: respOf(it) ?? '（立ち上がり動作を実施）', ...sf });
  if (itemId === 'assess_sit_to_stand') { if (S.standing) showStandObservations(); else startStandUp(); return; }
  if (ASSIST_KEY[itemId]) { S.assist[ASSIST_KEY[itemId]] = true; syncAssist(); }   // 介助は以後の動作に反映される
  if (itemId === 'assess_standing' || itemId === 'assess_gait') { runStandItem(cat, it); return; }
  renderResult(cat, it);
}
// ---- 声で質問：録音 → 認識 → 質問項目に当てはめる（当てはまらなければ患者が聞き返す）----
asr.onChange = () => { if (CASE && S.phase === 'category') { const c = CASE.menu.find(x => x.id === S.category); if (c && c.type === 'dialogue') showCategory(S.category); } };
function voiceListen() {
  if (!startRecording()) return;
  S.phase = 'listening';
  panel.setPage({ title: `${CASE.title} ／ 声で質問`, body: '患者に話しかけてください。\n話し終わったら下のボタンを押します。', buttons: [{ id: 'voice_stop', label: '話し終わった（認識する）' }, { id: 'voice_cancel', label: '← やめる', kind: 'back' }] });
}
function smallTalk(text) {
  const t = text.normalize('NFKC').replace(/[\s、。！？!?]/g, '');
  const nm = CASE.room && CASE.room.name;
  if (/名前|なまえ|お名前/.test(t)) return nm ? `${nm.replace(/\s/g, '')}です。` : null;
  if (/こんにちは|こんにちわ|おはよう|こんばんは|はじめまして|初めまして|よろしく|お願いします/.test(t)) return 'こんにちは。よろしくお願いします。';
  if (/ありがとう/.test(t)) return 'いえいえ。';
  if (/調子|具合|ぐあい|どうですか|大丈夫|だいじょうぶ/.test(t)) return 'はい、大丈夫です。';
  if (/担当|理学療法|学生|自己紹介|と申します|といいます/.test(t)) return 'そうですか。よろしくお願いします。';
  if (/触|さわ|失礼|いいですか|よろしいですか|しますね|してみ|やってみ/.test(t)) return 'はい、いいですよ。';
  if (/お疲れ|おつかれ|無理|むり|ゆっくり|ご安心|安心/.test(t)) return 'ありがとうございます。';
  return null;
}
async function voiceStop() {
  const catId = S.category, cat = CASE.menu.find(c => c.id === catId);
  S.phase = 'recognizing';
  panel.setPage({ title: `${CASE.title} ／ 声で質問`, body: '認識中…', buttons: [] });
  const text = await stopAndRecognize();
  if (S.phase !== 'recognizing') return;   // 認識中に画面が切り替わった（時間切れなど）
  const it = matchItem(text, cat.items);
  const chat = it ? null : smallTalk(text);
  if (chat) {   // あいさつ・名前の確認など（採点には関係しない）
    logger.record({ action: 'voice_smalltalk', selection: text, result: chat });
    S.phase = 'category'; speak(chat);
    panel.setPage({ title: `${CASE.title} ／ 声で質問`, body: `【あなたの言葉】\n「${text}」\n\n【患者】\n「${chat}」`, buttons: [{ id: 'voice_ask', label: '続けて話す' }, { id: `cat:${catId}`, label: '← 項目に戻る', kind: 'back' }] });
  } else if (it) {
    logger.record({ action: it.log_action || it.id, selection: `${it.label}（音声：${text}）`, result: respOf(it) });
    renderResult(cat, it);
  } else {
    logger.record({ action: 'voice_unmatched', selection: text || '（認識できず）' });
    S.phase = 'category';
    speak('すみません、もう一度お願いします。');
    panel.setPage({ title: `${CASE.title} ／ 声で質問`, body: `【聞こえた言葉】\n「${text || '（認識できませんでした）'}」\n\n【患者】\n「すみません、もう一度お願いします。」\n\n（このStationで聞ける内容：${cat.items.map(i => i.label.replace(/[？?]$/, '')).join(' ／ ')}）`, buttons: [{ id: 'voice_ask', label: 'もう一度話す' }, { id: `cat:${catId}`, label: '← 項目に戻る', kind: 'back' }] });
  }
}
function renderResult(cat, it) {
  S.phase = 'result';
  // 分類タイプ別の表示：会話＝質問と患者の回答／所見／結果
  let body;
  const resp = respOf(it);
  if (resp === null) body = `選択：${it.label}\n\n（この動作の再現はSTEP 6で実装します）`;
  else if (cat.type === 'dialogue') { body = `【あなたの質問】\n${it.label}\n\n【患者】\n「${resp}」`; speak(resp); }
  else body = `【${it.label}】\n\n${resp}`;
  panel.setPage({
    title: `${CASE.title} ／ ${cat.label}`,
    body,
    buttons: [{ id: `cat:${cat.id}`, label: '← 項目に戻る', kind: 'back' }],
  });
}
// 立位保持・歩行：座位なら先に自動で立ち上がらせる（ログ auto_stand_up。ブレーキ未確認なら Safety error）。歩行は前方へ数歩進み、介助で元の位置へ戻る。
function runStandItem(cat, it) {
  const mode = it.id === 'assess_gait' ? 'walk' : 'hold';
  const title = `${CASE.title} ／ ${cat.label}`;
  const play = () => {
    S.phase = mode;
    panel.setPage({ title, body: mode === 'walk' ? '介助下で患者が歩きます。\n動作をよく観察してください。' : '患者が立位を保持します。\n動作をよく観察してください。', buttons: [] });
    startAnim(1, 1, () => {
      if (S.phase !== mode) return;
      if (mode === 'walk') {
        S.phase = 'walk_back';
        panel.setPage({ title, body: '介助で患者を元の位置へ誘導します。', buttons: [] });
        startAnim(-1, 1.6, () => { if (S.phase === 'walk_back') renderResult(cat, it); }, 'walk');
      } else renderResult(cat, it);
    }, mode);
  };
  if (S.standing) { patient.poseAt('stand', patient.durations.stand); play(); return; }
  logger.record({ action: 'auto_stand_up', selection: '（立位評価のため自動で立ち上がり）', result: '', ...standSafety() });
  S.phase = 'standing';
  panel.setPage({ title, body: SCENARIO().during_text, buttons: [] });
  startAnim(1, 1, () => { if (S.phase === 'standing') { S.standing = true; play(); } }, 'stand');
}
// ---- 立ち上がり評価（STEP 6）----
let anim = null;   // { t, dir, speed, done }
function startAnim(dir, speed, done, mode = 'stand') {
  anim = { mode, t: dir > 0 ? 0 : patient.durations[mode], dir, speed, done };
  patient.poseAt(mode, anim.t);
}
const SCENARIO = () => CASE.sit_to_stand;
function startStandUp() {
  S.phase = 'standing';
  panel.setPage({ title: `${CASE.title} ／ 立ち上がり評価`, body: SCENARIO().during_text, buttons: [] });
  startAnim(1, 1, () => { if (S.phase === 'standing') showStandObservations(); });
}
function showStandObservations() {
  S.phase = 'stand_obs';
  S.standing = true;
  panel.setPage({
    title: `${CASE.title} ／ 立ち上がり評価`,
    body: SCENARIO().after_text,
    buttons: [
      ...SCENARIO().observations.map(o => ({ id: `sobs:${o.id}`, label: o.label })),
      { id: 'to_judgement', label: '臨床判断に進む' },
      { id: 'to_menu_standing', label: '評価項目に戻る（患者は立位のまま）', kind: 'back' },
      { id: 'sit_back', label: '患者を座位に戻す', kind: 'back' },
    ],
  });
}
function showStandObsResult(id) {
  const o = SCENARIO().observations.find(x => x.id === id);
  S.phase = 'stand_obs_result';
  logger.record({ action: o.id, selection: o.label, result: respOf(o) });
  panel.setPage({
    title: `${CASE.title} ／ 立ち上がり評価`,
    body: `【${o.label}】\n\n${respOf(o)}`,
    buttons: [{ id: 'sobs_back', label: '← 観察に戻る', kind: 'back' }],
  });
}
function sitBack() {
  S.phase = 'sitting_back';
  S.standing = false;
  logger.record({ action: 'patient_sit_back' });
  panel.setPage({ title: `${CASE.title} ／ 立ち上がり評価`, body: '患者が座位に戻ります。', buttons: [] });
  startAnim(-1, 1.8, () => { if (S.phase === 'sitting_back') showMenu(); });
}

// ---- 臨床判断（STEP 7）: 患者は立位のまま。回答は1回のみ（戻れない）。結果は最後に提示する ----
function showJudgement(stepId) {
  const st = CASE.judgement.steps.find(s => s.id === stepId);
  S.phase = `judge_${stepId}`;
  if (st.type === 'rank') return showRank(st);
  panel.setPage({
    title: `${CASE.title} ／ 臨床判断`,
    body: st.prompt,
    buttons: st.options.map(o => ({ id: `judge:${stepId}:${o.id}`, label: o.label })),
  });
}
// 複数選択＋優先順位。押した順が順位。もう一度押すと取り消し。確定後は戻れない
function showRank(st) {
  const n = S.rank.length;
  panel.setPage({
    title: `${CASE.title} ／ 臨床判断`,
    body: st.prompt + (n ? `\n\n選択中：${n}/${st.max_select}` : ''),
    buttons: [
      ...st.options.map(o => {
        const k = S.rank.indexOf(o.id);
        return { id: `rank:pick:${o.id}`, label: k >= 0 ? `${k + 1}位 ${o.label}` : o.label, disabled: k < 0 && n >= st.max_select };
      }),
      { id: 'rank:confirm', label: 'この順で確定', disabled: n === 0 },
    ],
  });
}
function answerRank(st) {
  const ranking = [...S.rank];
  const opts = ranking.map(id => st.options.find(o => o.id === id));
  S.answers[st.id] = { option: ranking[0], ranking, correct: opts[0].weight === 3 };
  logger.record({ action: `${st.log_prefix}_ranking`, selection: opts.map((o, i) => `${i + 1}位 ${o.label}`).join(' / '), result: ranking.join(','), correct: opts[0].weight === 3 });
  nextJudgement(st.id);
}
function nextJudgement(stepId) {
  const steps = CASE.judgement.steps;
  const idx = steps.findIndex(s => s.id === stepId);
  if (idx + 1 < steps.length) showJudgement(steps[idx + 1].id);
  else showEnd('complete');
}
function answerJudgement(stepId, optionId) {
  const steps = CASE.judgement.steps;
  const idx = steps.findIndex(s => s.id === stepId);
  const opt = steps[idx].options.find(o => o.id === optionId);
  S.answers[stepId] = { option: optionId, correct: opt.correct };
  logger.record({ action: `${steps[idx].log_prefix}_${optionId}`, selection: opt.label, correct: opt.correct });
  nextJudgement(stepId);
}

function showEnd(reason) {
  if (tts) tts.cancel();
  S.phase = 'end';
  S.endMs = performance.now();
  S.endedAt = new Date().toISOString();
  S.endReason = reason;   // complete / finish / time_up / vr_exit
  const action = reason === 'time_up' ? 'station_timeout' : reason === 'finish' ? 'station_end_by_student' : 'station_complete';
  logger.record({ action });
  S.result = scoreStation(CASE, logger.entries, S.answers);
  showResultPage(0);
  if (!renderer.xr.isPresenting) showExportPanel();   // PCではすぐ保存できる。VR中はVR終了後に表示
}

// 結果は4ページ（点数 → 良かった点 → 見落とした点 → Safety上の注意）。各領域の点数を個別に表示する。
function rankPage() {
  const st = CASE.judgement.steps.find(x => x.type === 'rank');
  const a = st && S.answers[st.id];
  if (!st || !a) return [];
  const lab = id => st.options.find(o => o.id === id);
  const rec = [...st.options].filter(o => o.weight > 0).sort((x, y) => y.weight - x.weight);
  const lines = a.ranking.map((id, i) => `${i + 1}位 ${lab(id).label}\n　→ ${lab(id).rationale}`);
  lines.push('', `最優先は「${rec[0].label}」`, '※根拠は仮案です（教員確認前）');
  return [{ title: '判断の根拠', size: 25, lines }];
}
function resultPages() {
  const r = S.result;
  const list = (arr, empty) => (arr.length ? arr.map(t => `・${t}`) : [empty]);
  return [
    { title: '結果', size: 36, lines: r.domains.map(d => `${d.label}：${d.score}/${d.max}`) },
    { title: '良かった点', size: 26, lines: list(r.good, '（該当なし）') },
    { title: '見落とした点', size: 26, lines: list(r.missed, '（見落としはありませんでした）') },
    ...rankPage(),
    { title: 'Safety上の注意', size: 28, lines: [...list(r.safety, 'Safety上の問題は記録されませんでした。'), '', renderer.xr.isPresenting ? 'VRを終了すると、2D画面に保存ボタンが表示されます。' : '画面右上の保存ボタンからログを保存できます。'] },
  ];
}
function showResultPage(i) {
  const pages = resultPages();
  S.resultPage = i;
  const pg = pages[i];
  panel.setPage({
    title: `結果 ${i + 1}/${pages.length} ／ ${pg.title}`,
    body: pg.lines.join('\n'),
    bodySize: pg.size,
    buttons: [
      ...(i > 0 ? [{ id: 'res:prev', label: '← 前へ', kind: 'back' }] : []),
      ...(i < pages.length - 1 ? [{ id: 'res:next', label: '次へ →', kind: 'back' }] : []),
      ...(i === pages.length - 1 && renderer.xr.isPresenting ? [{ id: 'exit_vr', label: 'VRを終了してデータを保存' }] : []),
    ],
  });
}

function onButton(id) {
  if (id.startsWith('case:')) { if (performance.now() - pageMs > 450) pickCase(id.slice(5)); return; }
  if (!CASE) return;
  if (performance.now() - pageMs < 450) return;   // 切り替え直後の誤操作・二重入力を無視（戻るボタンの位置に別のボタンが出ても連鎖しない）
  if (id === 'start') {
    S.startMs = performance.now();
    logger = new Logger(studentId, CASE.station_id);
    logger.record({ action: 'station_start' });
    S.phase = 'walking';
    panel.setPage({ title: CASE.title, body: `${CASE.room ? CASE.room.number + '号室へ向かいます…' : '病室へ向かいます…'}`, buttons: [] });
    teleportTo('hall', { silent: true, done: () => { logger.record({ action: 'arrive_at_room', selection: '病室の前に到着' }); enterRoom(() => showMenu()); } });
  }
  else if (id.startsWith('cat:')) showCategory(id.slice(4));
  else if (id === 'voice_ask') voiceListen();
  else if (id === 'voice_stop') voiceStop();
  else if (id === 'voice_cancel') { cancelRecording(); showCategory(S.category); }
  else if (id === 'to_case_select') showCaseSelect();
  else if (id === 'back_menu') showMenu();
  else if (id === 'toggle_voice') { voiceOn = !voiceOn; if (!voiceOn && tts) tts.cancel(); showMenu(); }
  else if (id.startsWith('item:')) { const [, c, i] = id.split(':'); showResult(c, i); }
  else if (id === 'finish') {   // 誤って終了しないよう確認を挟む
    S.phase = 'finish_confirm';
    panel.setPage({ title: CASE.title, body: 'Station を終了しますか？\n終了すると、行っていない項目は採点に反映されません。', buttons: [{ id: 'finish_yes', label: '終了する（採点へ）' }, { id: 'back_menu', label: '← 戻る', kind: 'back' }] });
  }
  else if (id === 'finish_yes') showEnd('finish');
  else if (id.startsWith('sobs:')) showStandObsResult(id.slice(5));
  else if (id === 'sobs_back') showStandObservations();
  else if (id === 'sit_back') sitBack();
  else if (id === 'to_menu_standing') { logger.record({ action: 'back_to_menu_standing' }); showMenu(); }
  else if (id === 'res:next') showResultPage(S.resultPage + 1);
  else if (id === 'res:prev') showResultPage(S.resultPage - 1);
  else if (id === 'exit_vr') { const ses = renderer.xr.getSession(); if (ses) ses.end(); }
  else if (id === 'to_judgement') showJudgement(CASE.judgement.steps[0].id);
  else if (id.startsWith('rank:pick:')) {
    const st = CASE.judgement.steps.find(x => x.type === 'rank'); const o = id.slice(10); const k = S.rank.indexOf(o);
    if (k >= 0) S.rank.splice(k, 1); else if (S.rank.length < st.max_select) S.rank.push(o);
    showRank(st);
  }
  else if (id === 'rank:confirm') { const st = CASE.judgement.steps.find(x => x.type === 'rank'); if (S.rank.length) answerRank(st); }
  else if (id.startsWith('judge:')) { const [, s, o] = id.split(':'); answerJudgement(s, o); }
  updateHud();
}

// 症例定義を読み込む（http(s)配信が必要。file://ではfetchできない）
moveTo('corridor');   // 廊下の端から始める（PCでは廊下の奥＝病室のドア方向を向く）
// 症例一覧（cases/index.json）→ 選択欄。?case=case02 で症例を指定することもできる。
const getJSON = (url) => fetch(url).then(r => { if (!r.ok) throw new Error(`${url} HTTP ${r.status}`); return r.json(); });
let CASE_LIST = [];
function loadCase(file) {
  panel.setPage({ title: 'VR-OSCE', body: '症例を読み込んでいます…', buttons: [] });
  return getJSON(file).then(j => {
    CASE = j;
    // 症例に合わせて、患者・小道具・病室札・介助項目を作り直す
    if (patient) patient.dispose();
    patient = createPatient(scene, M, CASE.patient || {});
    wc.visible = !(CASE.props && CASE.props.wheelchair === false);
    setRoomPlates(CASE.room || { number: '305', name: '' });
    ASSIST_KEY = {}; ZONE_ITEM = {};
    const ac = CASE.menu.find(c => c.id === 'assist');
    for (const it of (ac ? ac.items : [])) if (it.effect) { ASSIST_KEY[it.id] = it.effect; if (it.zone) ZONE_ITEM[it.effect] = it.id; }
    buildZoneViz();
    Object.assign(S, { rank: [], assist: {}, eff: {}, motionAssist: {}, answers: {}, result: null, standing: false });
    syncAssist();
    document.title = `VR-OSCE：${CASE.title}`;
    showStart(); updateHud();
  }).catch(e => panel.setPage({ title: 'エラー', body: `症例データを読み込めません。\n${e.message}`, buttons: [] }));
}
let LOCKED_CASE = false;
getJSON('./cases/index.json').then(list => {
  CASE_LIST = list;
  const want = new URLSearchParams(location.search).get('case');
  const first = list.find(c => c.id === want);
  if (first) { LOCKED_CASE = true; return loadCase(first.file); }
  showCaseSelect(); updateHud();
}).catch(e => panel.setPage({ title: 'エラー', body: `症例一覧を読み込めません。\n${e.message}`, buttons: [] }));

// 残り時間（1秒ごとに更新。時間切れで終了画面へ）
setInterval(() => {
  if (!CASE) return;
  updateHud();
  if (S.startMs !== null && S.phase !== 'end' && remainingSec() === 0) showEnd('time_up');
}, 500);

// レイキャスト: VRコントローラー／PCマウス
const raycaster = new THREE.Raycaster();
const _m = new THREE.Matrix4(), _o = new THREE.Vector3(), _d = new THREE.Vector3();

function pcPick(e) {
  rig.updateMatrixWorld(true);
  const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return pickAt();
}
// raycaster の先にあるもの（パネルのボタン or 床の移動マーカー）の近い方を返す
function pickAt() {
  const ph = raycaster.intersectObject(panel.mesh, false)[0];
  const btn = ph ? panel.hitTest(ph.uv) : null;
  const discs = markers.filter(m => m.visible).map(m => m.userData.disc);
  const mh = raycaster.intersectObjects(discs, false)[0];
  const spot = mh && (!ph || mh.distance < ph.distance) ? mh.object.userData.spot : null;
  return { btn: spot ? null : btn, spot, dist: spot ? mh.distance : (ph ? ph.distance : null) };
}

function updateControllers() {
  rig.updateMatrixWorld(true);
  let hover = null, hs = null;
  for (const c of controllers) {
    _m.identity().extractRotation(c.matrixWorld);
    _o.setFromMatrixPosition(c.matrixWorld);
    _d.set(0, 0, -1).applyMatrix4(_m).normalize();
    raycaster.set(_o, _d);
    const p = pickAt();
    c.userData.hoverBtn = p.btn; c.userData.hoverSpot = p.spot;
    c.getObjectByName('ray').scale.z = p.dist ? p.dist / 2 : 1;   // ray長を当たった面までに
    if (p.btn && !hover) hover = p.btn;
    if (p.spot && !hs) hs = p.spot;
  }
  panel.setHover(hover); hoverSpot = hs;
}
let lastSelectMs = 0;
for (const c of controllers) {
  c.addEventListener('selectstart', () => {
    const now = performance.now(); if (now - lastSelectMs < 350) return;   // 手のピンチで二重に反応しないように
    const b = c.userData.hoverBtn, sp = c.userData.hoverSpot;
    if (b) { lastSelectMs = now; onButton(b.id); } else if (sp) { lastSelectMs = now; teleportTo(sp); }
  });
}

// ---------- 手で触れて介助（接触判定）----------
// 患者の右膝・体幹・骨盤に、ハンド（手の関節）またはコントローラーを一定時間（0.5秒）近づけると、ボタンの「介助」と同じ操作として扱う。
const TOUCH_DWELL = 0.5;
const zoneViz = {}, touchDwell = {}, popups = [];
function buildZoneViz() {   // 手で触れる部位の表示球。症例の assist 分類（zone: true の項目）から作り直す
  for (const id of Object.keys(zoneViz)) { scene.remove(zoneViz[id]); delete zoneViz[id]; }
  for (const id of Object.values(ZONE_ITEM)) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0x2f6f8f, transparent: true, opacity: 0, depthWrite: false }));
    mesh.visible = false; scene.add(mesh); zoneViz[id] = mesh; touchDwell[id] = 0;
  }
}
const _tp = new THREE.Vector3();
function handPoints() {
  if (window.__osce && window.__osce.fakePoints) return window.__osce.fakePoints;   // PCでの動作確認用
  if (!renderer.xr.isPresenting) return [];
  const pts = [];
  for (let i = 0; i < 2; i++) {
    const hand = renderer.xr.getHand(i);
    if (hand.visible && hand.joints && hand.joints['wrist']) {
      for (const k of ['wrist', 'index-finger-tip', 'middle-finger-tip', 'thumb-tip', 'middle-finger-metacarpal']) {
        const j = hand.joints[k]; if (j && j.visible !== false) pts.push(j.getWorldPosition(new THREE.Vector3()));
      }
    } else pts.push(controllers[i].getWorldPosition(new THREE.Vector3()));
  }
  return pts;
}
function pulse(i) {
  try { const src = controllers[i].userData.src; const a = src && src.gamepad && src.gamepad.hapticActuators && src.gamepad.hapticActuators[0]; if (a && a.pulse) a.pulse(0.5, 80); } catch (e) { /* 触覚なしでも動作する */ }
}
controllers.forEach((c) => c.addEventListener('connected', (e) => { c.userData.src = e.data; }));
const touchLock = {};   // 確定後は、いったん手を離すまで再び確定しない（つけっぱなしで切り替わり続けないように）
function touchToggle(id) {
  const it = CASE.menu.find(c => c.id === 'assist').items.find(i => i.id === id);
  const key = ASSIST_KEY[id];
  S.assist[key] = !S.assist[key];
  const on = S.assist[key];
  syncAssist();
  logger.record(on
    ? { action: it.id, selection: `${it.label}（手で接触）`, result: respOf(it) }
    : { action: `release_${it.id}`, selection: `${it.label}を解除（手で接触）`, result: '' });
  const lab = makeLabel(on ? `${it.label}（介助しました）` : `${it.label}（解除）`); lab.scale.set(0.6, 0.15, 1);
  lab.position.copy(zoneViz[id].position).add(new THREE.Vector3(0, 0.3, 0.1)); scene.add(lab); popups.push({ lab, t: 0 });
  pulse(0); pulse(1);
}
function updateTouch(dt) {
  if (!patient) return;
  const ok = !!logger && anim === null && !fade.busy && ['menu', 'category', 'result', 'stand_obs', 'stand_obs_result'].includes(S.phase);
  const ok0 = !!logger && !['start', 'entering', 'end', 'loading'].includes(S.phase);
  const pts = ok ? handPoints() : [];
  const zones = patient.touchZones().filter(z => ZONE_ITEM[z.id]).map(z => ({ ...z, id: ZONE_ITEM[z.id] }));
  // 手の各点は、いちばん近い部位だけに触れたものとする（体幹と骨盤が近いので、同時に反応しないように）
  const owner = pts.map(p => zones.reduce((best, z) => { const s = p.distanceTo(z.center) / z.r; return s < best.s ? { id: z.id, s } : best; }, { id: null, s: Infinity }));
  for (const z of zones) {
    const viz = zoneViz[z.id], key = ASSIST_KEY[z.id], on = !!S.assist[key];
    let dmin = Infinity; pts.forEach((p, i) => { if (owner[i].id === z.id) dmin = Math.min(dmin, p.distanceTo(z.center)); });
    const inside = dmin < z.r, near = dmin < z.r + 0.4;
    if (ok) {                                   // 動作中は介助の状態を変えない（動作の途中で急に変わらないように）
      contact[key] = inside;
      if (!inside) touchLock[z.id] = false;
      touchDwell[z.id] = inside && !touchLock[z.id] ? touchDwell[z.id] + dt : 0;
      if (touchDwell[z.id] >= TOUCH_DWELL) { touchDwell[z.id] = 0; touchLock[z.id] = true; touchToggle(z.id); }
    }
    viz.position.copy(z.center); viz.scale.setScalar(z.r);
    viz.visible = ok0 && (on || (ok && near));    // 介助中の部位は、手を離しても緑で残す
    viz.material.color.setHex(on ? 0x4c9a6a : 0x2f6f8f);
    viz.material.opacity = on ? 0.22 : inside ? 0.5 : 0.2;
  }
  if (ok) syncAssist();
  patient.tickAssist(dt, anim === null);
  patient.tick(performance.now() / 1000);
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i]; p.t += dt; p.lab.position.y += dt * 0.05;
    if (p.t > 2) { scene.remove(p.lab); popups.splice(i, 1); }
  }
}

// ---------- STEP 9: 結果・ログの保存（2D画面）----------
// VR中はファイル保存ができないため、Station終了 → VRを終了 → 2D画面の保存ボタン、の流れにする。
const exportEl = document.getElementById('export');
function h(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function showExportPanel() {
  if (!logger) return;
  const session = buildSession(logger, CASE, S);
  const base = fileBase(session);
  exportEl.replaceChildren();
  exportEl.appendChild(h('h2', '結果・ログの保存'));
  exportEl.appendChild(h('div', `学生ID：${session.student_id}　終了：${({ complete: '全項目完了', finish: '学生が終了', time_up: '時間切れ', vr_exit: 'VRを途中で終了' })[session.end_reason] || session.end_reason}`, 'note'));
  const table = h('table');
  for (const sc of session.scores) {
    const tr = h('tr'); tr.appendChild(h('td', sc.domain)); tr.appendChild(h('td', `${sc.score}/${sc.max}`)); table.appendChild(tr);
  }
  exportEl.appendChild(table);
  const add = (label, fn, cls) => { const b = h('button', label, cls); b.addEventListener('click', fn); exportEl.appendChild(b); };
  add('JSONを保存（ログ＋採点すべて）', () => download(`${base}.json`, JSON.stringify(session, null, 2), 'application/json'));
  add('CSVを保存（行動ログ）', () => download(`${base}_log.csv`, logCSV(session), 'text/csv'));
  add('CSVを保存（採点）', () => download(`${base}_scores.csv`, scoresCSV(session), 'text/csv'));
  add('新しい学生で最初から', () => location.reload(), 'sub');
  exportEl.appendChild(h('div', '※ファイルはこの端末のダウンロードフォルダに保存されます。', 'note'));
  exportEl.style.display = 'block';
}

// VRを抜けたとき：Station終了後なら保存パネルを表示。途中で抜けた場合は、そこまでの記録を「vr_exit」として確定する。
renderer.xr.addEventListener('sessionend', () => {
  if (!logger) return;
  if (S.phase !== 'end') {
    S.phase = 'end'; S.endMs = performance.now(); S.endedAt = new Date().toISOString(); S.endReason = 'vr_exit';
    logger.record({ action: 'vr_session_ended_early' });
    S.result = scoreStation(CASE, logger.entries, S.answers);
    showResultPage(0);
  }
  showExportPanel();
});

// ---------- ループ・リサイズ ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
// 手のモデルが読み込まれたら肌色にする（患者の肌より少し明るめ）
const handSkin = new THREE.MeshStandardMaterial({ color: 0xdcb79d, roughness: 0.85 });
function tintHands() {
  for (let i = 0; i < 2; i++) {
    const h = renderer.xr.getHand(i);
    if (h.userData.tinted) continue;
    h.traverse(o => { if (o.isSkinnedMesh && o.material !== handSkin) { o.material = handSkin; h.userData.tinted = true; } });
  }
}
const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.25);   // タブ非表示などで時間が飛んでも動作を破綻させない
  for (let i = tweens.length - 1; i >= 0; i--) {
    const w = tweens[i]; w.t += dt; const u = Math.min(1, w.t / w.dur); w.fn(u);
    if (u >= 1) { tweens.splice(i, 1); if (w.done) w.done(); }
  }
  refreshMarkers();
  if (anim) {
    anim.t += anim.dir * anim.speed * dt;
    const dur = patient.durations[anim.mode];
    const finished = anim.dir > 0 ? anim.t >= dur : anim.t <= 0;
    patient.poseAt(anim.mode, Math.max(0, Math.min(dur, anim.t)));
    if (finished) { const done = anim.done; anim = null; if (done) done(); }
  }
  if (renderer.xr.isPresenting) { updateControllers(); tintHands(); }
  updateTouch(dt);
  renderer.render(scene, camera);
});

// デバッグ用（PCコンソールから状態確認）
window.__osce = { asr, scene, rig, camera, renderer, panel, get patient() { return patient; }, loadCase, S, SPOTS, markers, teleportTo, get curSpot() { return curSpot; }, get fading() { return fade.busy; }, get logger() { return logger; }, get studentId() { return studentId; }, fakePoints: null };
