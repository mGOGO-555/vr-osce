// VR-OSCE PoC  STEP 6: 関節付き患者（症例JSONで性別・年齢・体型・動きの型を指定）と立ち上がり動作
// 座標: 患者は +z を向く。患者の右 = -x、左 = +x。
// 下肢は「足部を床に固定して骨盤位置から膝角を求める」2リンクIKで動かす（足が滑らない）。
import * as THREE from 'three';

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
// 下記は「自作の簡易人型」の値。人体モデル(GLB)を読み込めた場合は、そのモデルの実寸で上書きする。
let L1 = 0.40, L2 = 0.48;        // 大腿・下腿の長さ
let ANKLE_Y = 0.08;              // 足首の床からの高さ
let HIP_X = 0.11;                // 股関節の左右位置
let Y_SIT = 0.70, Y_STAND = 0.95, Z_SIT = -0.25;   // 座位・立位の骨盤（股関節中心）の高さ、座位の前後位置
const Z_STAND = 0.14;
// 床に置かれた足首のワールド z（既定：患側の足が健側より約15cm前方）
const ANKLE_Z = { left: 0.12, right: 0.27 };

// ===== 動きの型（症例JSONの patient.motion で指定）=====
//  type: 'hemiparesis'（片麻痺：患側の膝折れ・荷重の偏り） / 'offload'（疼痛回避：患側に体重をかけない・ためらい） / 'dyspnea'（息切れ：前傾位・休息） / 'parkinson'（パーキンソン病：前傾姿勢・小刻み歩行・すくみ足。左右対称）
//  side: 患側 'right' | 'left'（息切れなど左右がない場合は省略）
//  severity: 0〜1（重さ）, speed: 動作速度の倍率, walker: 歩行器を使う, hands: 立位での手の置き方 'walker'|'thigh'|null
//  breath: { rate: 呼吸数/分, amp: 呼吸動作の大きさ（1=安静時） }
// 内部では「患側が右・健側が+x」の座標系で作り、最後に SX（右患側=+1／左患側=-1）で左右を反転する。
let MOT = null, SX = 1, AFF = 'right', SND = 'left';
let KEYS = [], STAND_DURATION = 5.3, HOLD_DURATION = 4.0, WALK_DURATION = 6.6;
let WALK = { right: [], left: [] }, WALK_CUE = { right: [], left: [] };
// 立ち上がりのキーフレーム: y=骨盤高さ, z=骨盤前後, x=骨盤左右(+は健側), lean=体幹前傾[rad],
// roll=体幹側屈（負=健側へ傾く）, drop=患側股関節の沈み込み（膝折れ表現）。yf/zf は座位(0)→立位(1)の割合
const K = (t, yf, zf, x, lean, roll, drop = 0) => ({ t, yf, zf, x, lean, roll, drop });
const KEYSETS = {
  hemiparesis: (sv) => [
    K(0.0, 0.00, 0.00, 0.00, 0.00, -0.06), K(1.2, 0.00, 0.08, 0.02, 0.35, -0.08), K(2.0, 0.28, 0.44, 0.03, 0.36, -0.09),
    K(3.2, 0.92, 0.90, 0.03, 0.20, -0.08, 0.01 * sv), K(3.9, 1.00, 1.00, 0.03, 0.08, -0.07, 0.02 * sv),
    K(4.5, 0.96, 1.00, 0.03, 0.08, -0.07, 0.07 * sv), K(5.3, 1.00, 1.00, 0.03, 0.08, -0.07, 0.04 * sv)],
  offload: (sv) => [
    K(0.0, 0.00, 0.00, 0.01, 0.00, -0.03), K(1.4, 0.00, 0.10, 0.02, 0.42, -0.05), K(2.6, 0.04, 0.20, 0.03, 0.50, -0.06),
    K(3.6, 0.30, 0.50, 0.05 * sv, 0.48, -0.08 * sv), K(5.0, 0.92, 0.92, 0.05 * sv, 0.30, -0.08 * sv),
    K(6.0, 1.00, 1.00, 0.05 * sv, 0.16, -0.08 * sv), K(6.8, 1.00, 1.00, 0.045 * sv, 0.15, -0.07 * sv)],
  dyspnea: (sv) => [
    K(0.0, 0.00, 0.00, 0.00, 0.10, 0.00), K(1.3, 0.00, 0.08, 0.00, 0.38, 0.00), K(2.1, 0.28, 0.44, 0.00, 0.38, 0.00),
    K(3.4, 0.92, 0.90, 0.00, 0.26, 0.00), K(4.2, 1.00, 1.00, 0.00, 0.22 + 0.04 * sv, 0.00), K(5.6, 1.00, 1.00, 0.00, 0.26 + 0.06 * sv, 0.00)],
  // パーキンソン病：動き出しにくく（座位で一度ためらう）、体幹を前に倒したまま、ゆっくり立つ。立位でも前傾（円背）が残る
  parkinson: (sv) => [
    K(0.0, 0.00, 0.00, 0.00, 0.14, 0.00), K(1.2, 0.00, 0.06, 0.00, 0.30, 0.00), K(2.4, 0.00, 0.10, 0.00, 0.40, 0.00),
    K(3.4, 0.06, 0.22, 0.00, 0.44, 0.00), K(4.8, 0.50, 0.58, 0.00, 0.40, 0.00), K(6.2, 0.95, 0.92, 0.00, 0.34, 0.00),
    K(7.2, 1.00, 1.00, 0.00, 0.30 + 0.04 * sv, 0.00), K(8.0, 1.00, 1.00, 0.00, 0.30 + 0.04 * sv, 0.00)],
};
// 歩行：脚ごとの歩幅列 [脚('A'=患側/'S'=健側), 開始秒, 終了秒, 歩幅m]。足首のzは累積する
const WALKSEQ = {
  hemiparesis: [['A', 0.4, 1.8, 0.18], ['S', 2.0, 3.0, 0.43], ['A', 3.2, 4.6, 0.27], ['S', 4.8, 5.8, 0.33]],
  offload:     [['A', 0.8, 2.2, 0.12], ['S', 2.8, 4.0, 0.22], ['A', 4.8, 6.2, 0.16], ['S', 6.8, 8.0, 0.20]],
  dyspnea:     [['A', 0.4, 1.4, 0.20], ['S', 1.7, 2.7, 0.38], ['A', 4.4, 5.4, 0.36], ['S', 5.7, 6.7, 0.38]],
  // パーキンソン病：開始までのすくみ（約1.8秒）→小さな一歩→だんだん歩幅が小さく・足の運びが速くなる（突進様）
  parkinson:   [['A', 1.8, 2.6, 0.09], ['S', 2.9, 3.6, 0.11], ['A', 3.9, 4.5, 0.08], ['S', 4.7, 5.2, 0.07], ['A', 5.4, 5.8, 0.06], ['S', 5.95, 6.3, 0.06]],
};
// 視覚的な合図（床の目印など）を出したときの歩行：すくみが短く、歩幅が大きくなる
const WALKCUE = {
  parkinson:   [['A', 1.0, 1.9, 0.18], ['S', 2.1, 3.0, 0.22], ['A', 3.2, 4.1, 0.22], ['S', 4.3, 5.2, 0.22]],
};
const HOLDBUMP = {   // 立位保持中に一瞬出る変化（患側の膝が抜けかける／疼痛で体重をかけ直す／息を整えて前傾が強まる）
  hemiparesis: { at: 2.2, drop: 0.03, yf: -0.04, roll: -0.02, lean: 0.03 },
  offload:     { at: 2.0, drop: 0, yf: -0.01, roll: -0.03, lean: 0.02 },
  dyspnea:     { at: 2.2, drop: 0, yf: -0.01, roll: 0, lean: 0.05 },
  parkinson:   { at: 2.6, drop: 0, yf: -0.005, roll: 0, lean: 0.05 },   // 姿勢反射障害：立位保持中に体幹がわずかに揺れる
};
function setMotion(spec) {
  const sp = spec || {};
  const type = KEYSETS[sp.type] ? sp.type : 'hemiparesis';
  const sv = sp.severity ?? 1, spd = sp.speed ?? 1;
  AFF = sp.side === 'left' ? 'left' : 'right'; SND = AFF === 'right' ? 'left' : 'right'; SX = AFF === 'right' ? 1 : -1;
  const ff = sp.foot_forward ?? (type === 'dyspnea' || type === 'parkinson' ? 0 : type === 'offload' ? 0.18 : 0.15);
  ANKLE_Z[SND] = 0.12; ANKLE_Z[AFF] = 0.12 + ff;
  MOT = { type, sv, sym: type === 'dyspnea' || type === 'parkinson', liftK: type === 'parkinson' ? 0.35 : 1, walker: !!sp.walker, trunkK: type === 'hemiparesis' ? 0.15 : type === 'offload' ? -0.10 : 0,
    hands: sp.hands || (sp.walker ? 'walker' : type === 'dyspnea' ? 'thigh' : null), dropK: type === 'hemiparesis' ? 1 : 0,
    breath: { rate: sp.breath?.rate ?? 16, amp: sp.breath?.amp ?? 1 }, bump: HOLDBUMP[type] };
  KEYS = KEYSETS[type](sv).map(k => ({ ...k, t: k.t / spd }));
  STAND_DURATION = KEYS[KEYS.length - 1].t;
  HOLD_DURATION = 4.0;
  let z = { A: ANKLE_Z[AFF], S: ANKLE_Z[SND] }; WALK = { right: [], left: [] };
  const side = { A: AFF, S: SND };
  for (const [leg, a, b, dz] of WALKSEQ[type]) { WALK[side[leg]].push([a / spd, b / spd, z[leg], z[leg] + dz]); z[leg] += dz; }
  WALK_CUE = { right: [], left: [] }; z = { A: ANKLE_Z[AFF], S: ANKLE_Z[SND] };
  for (const [leg, a, b, dz] of (WALKCUE[type] || WALKSEQ[type])) { WALK_CUE[side[leg]].push([a / spd, b / spd, z[leg], z[leg] + dz]); z[leg] += dz; }
  WALK_DURATION = (Math.max(...WALKSEQ[type].map(w => w[2])) + 0.8) / spd;
}
setMotion(null);

// 介助の状態（main.js から setAssist で設定）：knee=患側の膝を支える / trunk=体幹を支える / pelvis=骨盤を支える
let at = { knee: 0, trunk: 0, pelvis: 0, cue: 0 };   // 目標（0/1）
const ab = { knee: 0, trunk: 0, pelvis: 0, cue: 0 };  // 現在の効き具合（0〜1。なめらかに変化させて、姿勢が整う様子が見えるようにする）
const rollK = () => (1 - 0.7 * ab.trunk) * (1 - 0.9 * ab.pelvis);
const smooth = (u) => u * u * (3 - 2 * u);

function paramsAt(t) {
  t = Math.max(0, Math.min(STAND_DURATION, t));
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const u = smooth(Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))));
  const out = {};
  for (const k of ['yf', 'zf', 'x', 'lean', 'roll', 'drop']) out[k] = a[k] + (b[k] - a[k]) * u;
  out.drop *= 1 - 0.8 * ab.knee;                                // 患側の膝を支える→膝折れが出ない
  out.lean += MOT.trunkK * (1 - out.yf) * ab.trunk;             // 体幹を支える→前傾が十分になる（疼痛回避では過度な前傾が減る）
  out.roll *= rollK(); out.x *= 1 - 0.5 * ab.pelvis;             // 体幹・骨盤を支える→左右の傾き・偏りが減る
  out.x *= SX; out.roll *= SX;                                  // 左患側なら左右反転
  out.y = Y_SIT + out.yf * (Y_STAND - Y_SIT);
  out.z = Z_SIT + out.zf * (Z_STAND - Z_SIT);
  return out;
}

// ---- 立位保持（立った姿勢を数秒保つ）----
const bump = (t, c, w) => Math.exp(-(((t - c) / w) ** 2));
function holdParams(t) {
  const p = paramsAt(STAND_DURATION), B = MOT.bump;
  const g = bump(t, B.at, 0.45);
  p.x += SX * 0.008 * Math.sin(t * 2.4);                   // 小さな左右の動揺
  p.drop = (0.04 * (MOT.dropK ? 1 : 0) + B.drop * g + 0.006 * Math.sin(t * 3.1) * MOT.dropK) * (1 - 0.8 * ab.knee);
  p.yf = 1 + B.yf * g;
  p.roll += SX * B.roll * g * rollK();
  p.lean += B.lean * g + 0.01 * Math.sin(t * 1.7);
  p.y = Y_SIT + p.yf * (Y_STAND - Y_SIT);
  return p;
}

// ---- 歩行（前方へ数歩。患側の立脚期に膝折れが出やすい／疼痛回避では患側が先に小さく出る）----
function swingState(list, z0, t) {
  let z = z0, lift = 0;
  for (const [a, b, za, zb] of list) {
    if (t >= b) z = zb;
    else if (t > a) { const u = (t - a) / (b - a); z = za + (zb - za) * smooth(u); lift = Math.sin(Math.PI * u); break; }
    else break;
  }
  return { z, lift };
}
function walkState(t) {
  t = Math.max(0, Math.min(WALK_DURATION, t));
  const W = at.cue ? WALK_CUE : WALK;   // 視覚的な合図ありなら、すくみが短く歩幅が大きい歩行
  const A = swingState(W[AFF], ANKLE_Z[AFF], t), S = swingState(W[SND], ANKLE_Z[SND], t);
  const p = paramsAt(STAND_DURATION);
  p.z = (A.z + S.z) / 2 - 0.055;
  p.drop = (0.04 + 0.03 * S.lift - 0.03 * A.lift) * MOT.dropK * (1 - 0.8 * ab.knee);          // 健側の遊脚中（=患側が立脚）に患側の膝が折れやすい
  const sway = MOT.sym ? 0.4 : 1;
  p.x = SX * (0.03 * MOT.sv * (MOT.sym ? 0 : 1) - 0.03 * S.lift * sway + 0.015 * A.lift * sway) * (1 - 0.5 * ab.pelvis);
  p.y = Y_STAND - 0.005 - 0.012 * (A.lift + S.lift);
  p.yf = (p.y - Y_SIT) / (Y_STAND - Y_SIT);
  p.lean = MOT.type === 'parkinson' ? 0.30 : MOT.type === 'dyspnea' ? 0.20 : MOT.walker ? 0.17 : 0.10;
  p.roll = SX * (-0.07 * (MOT.sym ? 0 : 1) - 0.03 * S.lift * sway) * rollK();
  return { p, ank: { [AFF]: { z: A.z, y: ANKLE_Y + 0.05 * A.lift * MOT.liftK }, [SND]: { z: S.z, y: ANKLE_Y + 0.08 * S.lift * MOT.liftK } } };
}

// 矢状面の2リンクIK。股関節から見た足首の相対位置 (dz, dy) → 大腿角θ1・下腿角θ2（鉛直下向きから前方が正）
function solveLeg(dz, dy) {
  const full = Math.hypot(dz, dy);
  const d = Math.min(full, (L1 + L2) * 0.9995);
  const phi = Math.atan2(dz, -dy);
  const cosG = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
  const th1 = phi + Math.acos(Math.max(-1, Math.min(1, cosG)));   // 膝が前方に出る解
  const kz = L1 * Math.sin(th1), ky = -L1 * Math.cos(th1);
  const az = dz * d / full, ay = dy * d / full;
  const th2 = Math.atan2(az - kz, -(ay - ky));
  return [th1, th2];
}

// ---- 形状ヘルパー（すべて自作。外部モデルは使用していない）----
const V = (a) => new THREE.Vector3(...a);
const std = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0 });
function ell(parent, m, rx, ry, rz, pos, rot) {            // 楕円体
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), m);
  mesh.scale.set(rx, ry, rz); mesh.position.set(...pos);
  if (rot) mesh.rotation.set(...rot);
  parent.add(mesh); return mesh;
}
// a→b を結ぶ先細りの筒。端に関節球をつけて滑らかにつなぐ。ra/rb は両端の半径
function tube(parent, m, a, b, ra, rb, caps = true) {
  const va = V(a), vb = V(b), len = va.distanceTo(vb);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, len, 24, 1), m);
  mesh.position.copy(va).add(vb).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
  parent.add(mesh);
  if (caps) { ell(parent, m, ra, ra, ra, a); ell(parent, m, rb, rb, rb, b); }
  return mesh;
}
function hand(parent, m, wrist, dirTo) {                 // 手：手のひら＋親指（簡略だが人の手の形）
  const d = V(dirTo).sub(V(wrist)).normalize();
  const g = new THREE.Group(); g.position.set(...wrist);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
  ell(g, m, 0.032, 0.014, 0.05, [0, 0, 0.045]);            // 手のひら・指
  ell(g, m, 0.012, 0.012, 0.028, [0.032, 0, 0.03], [0, -0.5, 0]);   // 親指
  parent.add(g); return g;
}

export function createPatient(scene, M, spec = {}) {
  setMotion(spec.motion);
  at = { knee: 0, trunk: 0, pelvis: 0, cue: 0 }; ab.knee = ab.trunk = ab.pelvis = ab.cue = 0;
  const root = new THREE.Group(); root.name = 'patient'; scene.add(root);
  const proc = new THREE.Group(); proc.name = 'patient_procedural'; root.add(proc);   // 簡易人型（人体モデルの読み込み失敗時の代替）
  const pelvis = new THREE.Group(); proc.add(pelvis);
  const trunk = new THREE.Group(); pelvis.add(trunk);
  const eyeM = std(0x26201c, 0.4), browM = std(0x8c8c8c), lipM = std(0xb5786c), scleraM = std(0xf4f1ea, 0.5);

  // --- 体幹（断面が楕円の回転体：骨盤→腰→胸→肩。やや円背・腹部に丸み）---
  const prof = [[0.0, -0.10], [0.12, -0.09], [0.16, -0.03], [0.15, 0.08], [0.15, 0.18], [0.16, 0.28], [0.155, 0.36], [0.13, 0.43], [0.075, 0.47], [0.0, 0.48]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const torso = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), M.gown);
  torso.scale.set(1.2, 1, 0.8); trunk.add(torso);
  ell(trunk, M.gown, 0.12, 0.10, 0.13, [0, 0.33, 0.04]);   // 胸・腹のふくらみ
  ell(trunk, M.gown, 0.095, 0.05, 0.095, [0, 0.46, -0.02]); // 僧帽筋〜肩の丸み（円背気味）

  // --- 頸・頭（頭は体幹の前傾を一部打ち消して、前を向く）---
  tube(trunk, M.skin, [0, 0.46, 0.0], [0, 0.56, 0.02], 0.048, 0.042, false);
  const headG = new THREE.Group(); headG.position.set(0, 0.575, 0.02); trunk.add(headG);
  const H = new THREE.Group(); H.position.set(0, 0.10, 0.01); headG.add(H);     // 頭部中心
  ell(H, M.skin, 0.088, 0.112, 0.098, [0, 0, 0]);             // 頭蓋
  ell(H, M.skin, 0.068, 0.06, 0.07, [0, -0.06, 0.03]);        // 顎
  ell(H, M.skin, 0.014, 0.022, 0.014, [0, -0.02, 0.098]);     // 鼻
  for (const s of [-1, 1]) {
    ell(H, M.skin, 0.012, 0.028, 0.02, [s * 0.09, -0.012, -0.005]);    // 耳
    ell(H, scleraM, 0.013, 0.0085, 0.008, [s * 0.036, 0.02, 0.089]);   // 白目
    ell(H, eyeM, 0.0072, 0.0072, 0.006, [s * 0.036, 0.02, 0.095]);     // 黒目
    ell(H, browM, 0.022, 0.0055, 0.008, [s * 0.038, 0.045, 0.087], [0.2, 0, -s * 0.12]);   // 眉
  }
  ell(H, lipM, 0.03, 0.0065, 0.008, [0, -0.06, 0.087]);       // 口
  const hair = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.53), M.hair);
  hair.scale.set(0.094, 0.118, 0.104); hair.position.set(0, 0.004, -0.018); H.add(hair);   // 白髪（前は額を出す）

  // --- 上肢：肩・上腕・肘・前腕・手 ---
  const arms = new THREE.Group(); arms.position.set(0, 0.42, 0); trunk.add(arms);   // 肩を軸に、体幹が前傾しても腕は垂れる
  for (const s of [-1, 1]) {           // s=-1 右（麻痺側）, s=+1 左
    const sh = [s * 0.2, 0, 0], el = [s * 0.235, -0.27, 0.05], wr = [s * 0.14, -0.44, 0.23];
    ell(arms, M.gown, 0.062, 0.062, 0.062, sh);
    tube(arms, M.gown, sh, el, 0.055, 0.045);                 // 上腕（長袖）
    tube(arms, M.gown, el, wr, 0.045, 0.034);                 // 前腕（長袖）
    hand(arms, M.skin, wr, [s * 0.09, -0.49, 0.31]);
  }

  // --- 下肢（右 = -1, 左 = +1）---
  const legs = {};
  for (const [name, s] of [['right', -1], ['left', 1]]) {
    const hipJ = new THREE.Group(); pelvis.add(hipJ);
    ell(hipJ, M.pants, 0.095, 0.095, 0.1, [0, 0, -0.01]);                       // 股関節・臀部
    const thigh = new THREE.Group(); hipJ.add(thigh);
    tube(thigh, M.pants, [0, 0, 0], [0, -L1, 0], 0.092, 0.060, false);          // 大腿
    const shank = new THREE.Group(); shank.position.y = -L1; thigh.add(shank);
    ell(shank, M.pants, 0.06, 0.06, 0.06, [0, 0, 0]);                            // 膝
    tube(shank, M.pants, [0, 0, 0], [0, -L2, 0], 0.058, 0.040, false);          // 下腿
    ell(shank, M.pants, 0.05, 0.085, 0.05, [0, -0.14, -0.018]);                  // ふくらはぎ
    const foot = new THREE.Group(); foot.position.y = -L2; shank.add(foot);
    tube(foot, M.skin, [0, 0.0, 0], [0, -0.035, 0], 0.04, 0.04, false);           // 靴下・足首
    ell(foot, M.shoe, 0.048, 0.04, 0.125, [0, -0.045, 0.06]);                     // 靴本体
    ell(foot, M.shoe, 0.04, 0.045, 0.05, [0, -0.028, -0.005]);                    // 履き口
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.01, 0.23), std(0x8a949a));
    sole.position.set(0, -0.076, 0.06); foot.add(sole);
    legs[name] = { s, hipJ, thigh, shank, foot, ankleZ: ANKLE_Z[name] };
  }

  // --- 歩行器（固定式。症例の motion.walker が true のときだけ）---
  let wk = null;
  if (MOT.walker) {
    wk = new THREE.Group(); wk.name = 'walker'; root.add(wk);
    const mt = M.metal, grip = std(0x2b2f33, 0.6);
    for (const sx of [-1, 1]) {
      for (const z of [-0.02, 0.33]) tube(wk, mt, [sx * 0.29, 0, z], [sx * 0.29, 0.80, z], 0.013, 0.013, false);
      tube(wk, mt, [sx * 0.29, 0.80, -0.02], [sx * 0.29, 0.80, 0.33], 0.013, 0.013, false);
      tube(wk, mt, [sx * 0.29, 0.42, -0.02], [sx * 0.29, 0.42, 0.33], 0.010, 0.010, false);
      tube(wk, grip, [sx * 0.29, 0.815, -0.10], [sx * 0.29, 0.815, 0.06], 0.019, 0.019, false);
    }
    tube(wk, mt, [-0.29, 0.80, 0.33], [0.29, 0.80, 0.33], 0.013, 0.013, false);
    wk.position.z = Z_STAND + 0.30;
  }

  // ===== 人体モデル（GLB：MakeHuman CC0データから tools/mh_build.py で生成）=====
  const PALM_SIGN = -1;   // 手のひら法線の向き（-1: レスト姿勢で手のひらは下・内側）
  let curWalkerZ = Z_STAND + 0.30, baseChestX = 0;
  let body = null, lastT = 0, redo = () => {};   // body: { B: 骨名→Object3D, ... }
  const BODY_URL = spec.model || './assets/patient_case01.glb';
  function attachBody(gltf) {
    const m = gltf.parser.json.asset.extras || {};
    const B = {};
    gltf.scene.traverse(o => { if (o.isBone || o.type === 'Object3D') B[o.name] = o; });
    L1 = m.L1; L2 = m.L2; ANKLE_Y = m.ankleY; HIP_X = m.hipX;
    Y_SIT = 0.50 + 0.10; Y_STAND = ANKLE_Y + 0.99 * (L1 + L2); Z_SIT = Math.min(ANKLE_Z.left, ANKLE_Z.right) - 0.31;   // 座面(0.50)+股関節中心の高さ
    gltf.scene.traverse(o => { if (o.isSkinnedMesh) { o.frustumCulled = false; o.material.vertexColors = true; } });
    // 頭部：目・眉（髪は頂点カラーでモデルに含まれる）
    const hp = new THREE.Vector3(...m.joints.head);
    const eyeM = std(0x2a211c, 0.35), scleraM = std(0xe9e3db, 0.5), browM = std(0x8e8e8e, 0.9);
    for (const [key, sgn] of [['eyeL', 1], ['eyeR', -1]]) {
      const e = new THREE.Vector3(...m[key]).sub(hp);
      ell(B.head, scleraM, 0.0112, 0.0112, 0.0112, [e.x, e.y, e.z - 0.002]);
      ell(B.head, eyeM, 0.0062, 0.0062, 0.0040, [e.x, e.y, e.z + 0.0085]);
      ell(B.head, browM, 0.021, 0.0042, 0.006, [e.x, e.y + 0.028, e.z + 0.004], [0.15, 0, -sgn * 0.14]);
    }
    // 眼鏡（症例の patient.glasses が true のとき）：頭の骨に付ける細いフレームとつる
    if (spec.glasses) {
      const gm = std(0x2b2b2e, 0.4), g = new THREE.Group(); B.head.add(g);
      for (const [key, sgn] of [['eyeL', 1], ['eyeR', -1]]) {
        const e = new THREE.Vector3(...m[key]).sub(hp);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0225, 0.0016, 8, 28), gm); ring.position.set(e.x, e.y, e.z + 0.03); g.add(ring);
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.0025, 0.11), gm); arm.position.set(e.x + sgn * 0.034, e.y + 0.004, e.z - 0.022); g.add(arm);
      }
      const eL = new THREE.Vector3(...m.eyeL).sub(hp);
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.0025, 0.0025), gm); br.position.set(0, eL.y + 0.006, eL.z + 0.031); g.add(br);
    }
    root.add(gltf.scene);
    proc.visible = false;
    if (wk) wk.scale.y = (Y_STAND + 0.05) / 0.80;   // グリップ高さを患者の体格に合わせる
    // 腕のIK用：骨の長さと、レスト姿勢での方向・手のひらの向き
    const J = (k) => new THREE.Vector3(...m.joints[k]);
    const arm = {};
    for (const sfx of ['L', 'R']) {
      const sh = J('uarm_' + sfx), el = J('larm_' + sfx), wr = J('hand_' + sfx);
      arm[sfx] = { Lu: sh.distanceTo(el), Lf: el.distanceTo(wr), d0u: el.clone().sub(sh).normalize(), d0f: wr.clone().sub(el).normalize(),
        palm0: new THREE.Vector3(...m.palmN[sfx]).multiplyScalar(PALM_SIGN) };
    }
    body = { B, scene: gltf.scene, arm };
    redo();
  }
  new GLTFLoader().load(BODY_URL, attachBody, undefined, (e) => console.warn('人体モデルを読み込めないため簡易人型を使います', e));


  // 腕：座位では両手を大腿の上に置き、立ち上がるにつれて体側に下ろす（肘を曲げたままにしない）。2リンクIKで手首の位置を決める。
  const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  const ss = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
  function aim(bone, parentQ, d0, dWorld, roll) {   // bone を d0 方向→dWorld 方向に向ける（親の回転を考慮）。roll: 軸まわりの追加回転
    const dl = dWorld.clone().applyQuaternion(_q.copy(parentQ).invert());
    bone.quaternion.setFromUnitVectors(d0, dl);
    if (roll) bone.quaternion.premultiply(_q2.setFromAxisAngle(dl, roll));
  }
  function poseArms(p) {
    const B = body.B;
    B.hips.updateMatrixWorld(true);
    const w = ss((p.yf - 0.15) / 0.45);          // 0=座位（手は大腿上）→1=立位（腕は体側）
    for (const [sfx, sg] of [['L', 1], ['R', -1]]) {
      const A = body.arm[sfx], U = B['uarm_' + sfx], F = B['larm_' + sfx], H = B['hand_' + sfx];
      const S = U.getWorldPosition(new THREE.Vector3());
      const seat = new THREE.Vector3(p.x + sg * 0.15, p.y + 0.115, p.z + 0.26);   // 大腿の上（手首の位置）
      const hang0 = S.clone().add(new THREE.Vector3(sg * 0.02, -(A.Lu + A.Lf) * 0.955, 0.035));
      const hang = MOT.hands === 'walker' ? new THREE.Vector3(sg * 0.27, Y_STAND + 0.05, curWalkerZ - 0.02)   // 歩行器のグリップ
        : MOT.hands === 'thigh' ? hang0.clone().add(new THREE.Vector3(sg * 0.05, -0.11, 0.16))            // 手を大腿に置く（息切れの前傾位）
        : hang0;
      const T = seat.clone().lerp(hang, w);
      // 2リンクIK（肘は後ろ・外・下へ向ける）
      const toT = T.clone().sub(S); let d = Math.min(toT.length(), (A.Lu + A.Lf) * 0.999); const e = toT.normalize();
      const a = (A.Lu * A.Lu - A.Lf * A.Lf + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, A.Lu * A.Lu - a * a));
      const pole = new THREE.Vector3(sg * 0.45, -0.35, -0.8); pole.addScaledVector(e, -pole.dot(e)).normalize();
      const E = S.clone().addScaledVector(e, a).addScaledVector(pole, hh);
      const du = E.clone().sub(S).normalize(), df = S.clone().addScaledVector(e, d).sub(E).normalize();
      const Pc = B['clav_' + sfx].getWorldQuaternion(new THREE.Quaternion());
      aim(U, Pc, A.d0u, du, 0); U.updateMatrixWorld(true);
      aim(F, U.getWorldQuaternion(new THREE.Quaternion()), A.d0f, df, 0); F.updateMatrixWorld(true);
      // 手：座位では大腿に沿って寝かせ（手のひらは下）、立位では前腕の延長（手のひらは内側）
      const flat = new THREE.Vector3(sg * -0.06, -0.12, 1).normalize();
      const dh = flat.clone().lerp(df, w).normalize();
      const Qf = F.getWorldQuaternion(new THREE.Quaternion());
      aim(H, Qf, A.d0f, dh, 0); H.updateMatrixWorld(true);
      const Qh = H.getWorldQuaternion(new THREE.Quaternion());
      const n = A.palm0.clone().applyQuaternion(Qh);
      const want = new THREE.Vector3(sg * -1, 0, 0.1).multiplyScalar(w).add(new THREE.Vector3(0, -1, 0).multiplyScalar(1 - w)).normalize();
      const pn = n.addScaledVector(dh, -n.dot(dh)).normalize(), pw = want.addScaledVector(dh, -want.dot(dh)).normalize();
      const roll = Math.atan2(dh.dot(new THREE.Vector3().crossVectors(pn, pw)), pn.dot(pw));
      aim(H, Qf, A.d0f, dh, roll);
    }
  }

  // 姿勢を適用して、確認用の値を返す（立ち上がり）
  function pose(t) { redo = () => pose(t); lastT = t; return apply(paramsAt(t), null, 'stand'); }
  // 動作の種類（stand=立ち上がり／hold=立位保持／walk=歩行）と時刻から姿勢を適用する
  function poseAt(mode, t) {
    if (mode === 'hold') { redo = () => poseAt(mode, t); return apply(holdParams(t), null, 'hold'); }
    if (mode === 'walk') { redo = () => poseAt(mode, t); const w = walkState(t); return apply(w.p, w.ank, 'walk'); }
    return pose(t);
  }
  function apply(p, ank, mode) {
    const info = { pelvisY: p.y, pelvisZ: p.z, lean: p.lean };
    curWalkerZ = (mode === 'walk' ? p.z : Z_STAND) + 0.30;
    if (wk) wk.position.z = curWalkerZ;
    baseChestX = p.lean * 0.55;
    const ang = {};
    for (const [name, L] of Object.entries(legs)) {
      const hipDrop = name === AFF ? -p.drop : 0;
      const az = ank && ank[name] ? ank[name].z : L.ankleZ, ay = ank && ank[name] ? ank[name].y : ANKLE_Y;
      const dz = az - p.z, dy = ay - (p.y + hipDrop);
      const [th1, th2] = solveLeg(dz, dy);
      ang[name] = { hipDrop, th1, th2, s: L.s };
      info[name + 'KneeDeg'] = Math.round((th1 - th2) * 180 / Math.PI);
    }
    if (body) {
      const B = body.B;
      B.hips.position.set(p.x, p.y, p.z);
      B.spine.rotation.set(p.lean * 0.45, 0, p.roll * 0.5);
      B.chest.rotation.set(p.lean * 0.55, 0, p.roll * 0.5);
      B.neck.rotation.set(-p.lean * 0.3, 0, 0);
      B.head.rotation.set(-p.lean * 0.3, 0, 0);
      for (const [name, sfx] of [['right', 'R'], ['left', 'L']]) {
        const a = ang[name];
        B['uleg_' + sfx].position.set(a.s * HIP_X - p.x, a.hipDrop, 0);
        B['uleg_' + sfx].rotation.x = -a.th1;
        B['lleg_' + sfx].rotation.x = a.th1 - a.th2;
        B['foot_' + sfx].rotation.x = a.th2;
      }
      poseArms(p);
    } else {
      pelvis.position.set(p.x, p.y, p.z);
      trunk.rotation.set(p.lean, 0, p.roll);
      arms.rotation.x = -p.lean * 0.7;
      headG.rotation.x = -p.lean * 0.6;
      for (const [name, L] of Object.entries(legs)) {
        const a = ang[name];
        L.hipJ.position.set(L.s * HIP_X - p.x, a.hipDrop, 0);   // 股関節のワールドx・zは動かさない
        L.thigh.rotation.x = -a.th1;
        L.shank.rotation.x = a.th1 - a.th2;
        L.foot.rotation.x = a.th2;
      }
    }
    return info;
  }
  pose(0);
  // 手で触れて介助するための接触範囲（球）。患者の動きに追従する。右膝・体幹・骨盤。
  const _w = [new THREE.Vector3(), new THREE.Vector3()];
  function touchZones() {
    let knee, trunkC, pelv;
    if (body) {
      const B = body.B;
      B.hips.getWorldPosition(_w[0]); pelv = _w[0].clone().add(new THREE.Vector3(0, 0.03, 0));
      B['lleg_' + (AFF === 'right' ? 'R' : 'L')].getWorldPosition(_w[0]); knee = _w[0].clone().add(new THREE.Vector3(0, 0, 0.04));
      B.spine.getWorldPosition(_w[0]); B.chest.getWorldPosition(_w[1]); trunkC = _w[0].clone().add(_w[1]).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.1, 0.03));
    } else {
      pelvis.getWorldPosition(_w[0]); pelv = _w[0].clone();
      legs[AFF].shank.getWorldPosition(_w[0]); knee = _w[0].clone().add(new THREE.Vector3(0, 0, 0.04));
      trunk.localToWorld(trunkC = new THREE.Vector3(0, 0.25, 0.03));
    }
    return [
      { id: 'knee', center: knee, r: 0.13 },
      { id: 'trunk', center: trunkC, r: 0.17 },
      { id: 'pelvis', center: pelv, r: 0.15 },
    ];
  }
  return { root, legs, pose, poseAt, touchZones, setAssist(a) { at = { knee: a.knee ? 1 : 0, trunk: a.trunk ? 1 : 0, pelvis: a.pelvis ? 1 : 0, cue: a.cue ? 1 : 0 }; },
    // 介助の効き具合を目標へ近づける（0.4秒でなめらかに）。動作中でなければ、その場で姿勢に反映する
    tickAssist(dt, repose) {
      let ch = false;
      for (const k of ['knee', 'trunk', 'pelvis', 'cue']) { const d = at[k] - ab[k]; if (d) { ab[k] += Math.sign(d) * Math.min(Math.abs(d), dt / 0.4); ch = true; } }
      if (ch && repose) redo();
    },
    get assistBlend() { return { ...ab }; },
    // 呼吸動作：胸郭の上下動（息切れでは大きく・速く）と、補助筋を使う肩の上下
    tick(time) {
      if (!body) return;
      const b = MOT.breath, ph = Math.sin(2 * Math.PI * b.rate / 60 * time), acc = Math.max(0, b.amp - 1);
      body.B.chest.rotation.x = baseChestX + 0.012 * b.amp * ph;
      const lift = 0.03 * acc * (0.5 + 0.5 * ph);
      body.B.clav_L.rotation.z = lift; body.B.clav_R.rotation.z = -lift;
    },
    dispose() { scene.remove(root); },
    get motion() { return { type: MOT.type, side: AFF, walker: MOT.walker }; },
    get durations() { return { stand: STAND_DURATION, hold: HOLD_DURATION, walk: WALK_DURATION }; }, get duration() { return STAND_DURATION; }, get usingModel() { return !!body; }, get body() { return body; } };
}
