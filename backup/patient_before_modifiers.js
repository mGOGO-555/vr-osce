// VR-OSCE PoC  STEP 6: 関節付き患者（症例JSONで性別・年齢・体型・動きの型を指定）と立ち上がり動作
// 座標: 患者は +z を向く。患者の右 = -x、左 = +x。
// 下肢は「足部を床に固定して骨盤位置から膝角を求める」2リンクIKで動かす（足が滑らない）。
import * as THREE from 'three';
import { createBedMobility } from './bedmob.js';
import { loadRawSTS, armNeutral, boneMotions, segmentsFromWorld, jointAngles, JOINTS } from './normal_sts.js';   // 症例1の臥位→端座位（bed mobility）

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
let STAND_DURATION = 4.2, HOLD_DURATION = 4.0, WALK_DURATION = 6.6;
let WALK = { right: [], left: [] }, WALK_CUE = { right: [], left: [] };

// ===== 立ち上がり（STS）の動作プロファイル =====
// 4相: ①flexion-momentum（体幹前傾で前方への運動量を作る）→②momentum-transfer/seat-off（離臀・重心を足部へ）
//      →③extension（股・膝・体幹の連続伸展）→④stabilization（立位到達後の動揺の収束）
// 各チャンネル（骨盤上下yf・前後zf・左右x・体幹前傾lean・側屈roll・患側股関節沈み込みdrop・腕arm）は
// 独立したキー列 [t, 値, 速度(省略可)] を持つ cubic Hermite 補間。区間ごとに速度を0にしない（離臀は通過イベント）。
// 速度を省略したキーは単調保存の接線（極値では0）。動作の開始・終了では速度0。
// 座標系: 患側=右・健側=+x（左患側は最後に反転）。yf/zf は座位(0)→立位(1)。drop は患側股関節の沈み込み[m]（患側の伸展遅れ・支持性低下）。
// 時間・角度の値は医学的基準ではなく、モデル・椅子位置で視覚的に調整する初期値。
// ev: 臨床的に確認できるlandmark（tStart=動作開始, tPeakFlexion=体幹前傾最大, tSeatOff=離臀(yf=0.02), tExtension=連続伸展の開始,
//     tStand=立位到達, tStabilized=動揺収束＝動作終了）。stab: 立位到達後の減衰振動 [振幅, Hz, 減衰時定数s]。
// 【hold/walk との接続】hold・walkは paramsAt(終端) を起点にするため、終端の値（x, roll, lean, drop）は従来の立位保持の開始値に合わせてある。
const PROFILES = {
  stroke: {   // 右片麻痺：非麻痺側優位の荷重・骨盤体幹の左右非対称・患側伸展の遅れ・立位直後の患側支持不安定
    T: 4.2, ff: 0.15, push: 0, sv: ['drop'],
    ev: { tStart: 0.0, tPeakFlexion: 1.05, tSeatOff: 1.5, tExtension: 1.6, tStand: 3.2, tStabilized: 4.2 },
    ch: {
      yf:   [[0, 0, 0], [1.2, 0, 0], [1.5, 0.02, 0.20], [2.2, 0.52, 0.90], [3.2, 1.0, 0.15], [4.2, 1.0, 0]],
      zf:   [[0, 0], [0.5, 0.04], [1.05, 0.10], [1.5, 0.30], [2.1, 0.62], [2.8, 0.90], [3.4, 1.0], [4.2, 1.0, 0]],
      x:    [[0, 0, 0], [0.9, 0.02], [1.4, 0.045], [2.0, 0.04], [3.0, 0.035], [3.4, 0.03], [4.2, 0.03, 0]],
      lean: [[0, 0, 0], [0.55, 0.20], [1.05, 0.31], [1.7, 0.27], [2.4, 0.16], [3.2, 0.09], [4.2, 0.08, 0]],
      roll: [[0, -0.04, 0], [1.0, -0.07], [1.6, -0.11], [2.6, -0.09], [3.2, -0.08], [4.2, -0.07, 0]],
      drop: [[0, 0, 0], [1.5, 0, 0], [2.2, 0.04], [2.9, 0.055], [3.4, 0.05], [3.75, 0.068], [4.2, 0.04, 0]],   // 患側の伸展が遅れ、立位直後にもう一度沈む
      arm:  [[0, 0, 0], [1.3, 0, 0], [2.5, 1.0], [4.2, 1.0, 0]],
    },
    stab: { lean: [0.010, 1.6, 0.35], roll: [0.015, 1.6, 0.35] },
  },
  hipFracture: {   // 左大腿骨頸部骨折：患側(左)への荷重回避・健側(右)への偏位・離臀前後のためらい・上肢(ベッド/大腿)で押し上がり、立位に近づいてから歩行器グリップへ
    T: 4.4, ff: 0.18, push: 1, sv: ['x', 'roll', 'drop'],
    ev: { tStart: 0.0, tPeakFlexion: 1.55, tSeatOff: 1.9, tExtension: 2.0, tStand: 3.5, tStabilized: 4.4 },
    ch: {
      yf:   [[0, 0, 0], [1.6, 0, 0], [1.9, 0.02, 0.20], [2.6, 0.50, 0.85], [3.5, 1.0, 0.12], [4.4, 1.0, 0]],
      zf:   [[0, 0], [0.55, 0.03], [1.2, 0.11], [1.65, 0.17], [1.9, 0.26], [2.6, 0.62], [3.2, 0.90], [3.8, 1.0], [4.4, 1.0, 0]],   // 1.2〜1.9秒は遅いが止まらない（ためらい）
      x:    [[0, 0.01, 0], [1.2, 0.03], [1.9, 0.05], [2.6, 0.06], [3.5, 0.055], [4.4, 0.05, 0]],
      lean: [[0, 0.03, 0], [0.55, 0.14], [1.1, 0.40], [1.55, 0.47], [2.0, 0.44], [2.8, 0.30], [3.5, 0.17], [4.4, 0.15, 0]],
      roll: [[0, -0.03, 0], [1.2, -0.05], [1.9, -0.08], [3.5, -0.09], [4.4, -0.08, 0]],
      drop: [[0, 0, 0], [1.9, 0, 0], [2.5, 0.03], [3.2, 0.035], [3.9, 0.015], [4.4, 0, 0]],
      arm:  [[0, 0, 0], [2.9, 0, 0], [3.7, 1.0], [4.4, 1.0, 0]],
    },
    stab: { lean: [0.008, 1.5, 0.35] },
  },
  copd: {   // COPD：左右対称で素早い通常の一連動作。症例差は動作後の呼吸亢進・肩挙上・前傾・大腿支持
    T: 3.6, ff: 0, push: 1, sv: [],
    ev: { tStart: 0.0, tPeakFlexion: 0.85, tSeatOff: 1.15, tExtension: 1.25, tStand: 2.4, tStabilized: 3.6 },
    ch: {
      yf:   [[0, 0, 0], [0.9, 0, 0], [1.15, 0.02, 0.20], [1.75, 0.55, 1.10], [2.4, 1.0, 0.10], [3.6, 1.0, 0]],
      zf:   [[0, 0], [0.5, 0.05], [0.85, 0.14], [1.15, 0.32], [1.8, 0.70], [2.4, 0.96], [3.0, 1.0], [3.6, 1.0, 0]],
      x:    [[0, 0, 0], [3.6, 0, 0]],
      lean: [[0, 0.10, 0], [0.85, 0.40], [1.5, 0.34], [2.1, 0.27], [2.6, 0.24], [3.1, 0.27], [3.6, 0.28, 0]],   // 立位後にいったん起きてから、息を整えるように再び前傾
      roll: [[0, 0, 0], [3.6, 0, 0]],
      drop: [[0, 0, 0], [3.6, 0, 0]],
      arm:  [[0, 0, 0], [1.6, 0, 0], [2.4, 1.0], [3.6, 1.0, 0]],
    },
    stab: { lean: [0.010, 1.8, 0.35] },
    breathBoost: { rate: 7, amp: 0.8, sh: 0.06, rise: 1.2, hold: 6, decay: 9 },   // 立位後だけ呼吸数(+7/分)・振幅・肩挙上を増やし、その後ゆっくり戻す（初期の視覚表現値）
  },
  parkinson: {   // Parkinson病：開始遅延＋小さな前後の予備運動＋低い伸展速度＋前傾残存。動き出したら連続
    T: 5.0, ff: 0, push: 1, sv: [],
    ev: { tStart: 0.4, tPeakFlexion: 2.0, tSeatOff: 2.5, tExtension: 2.6, tStand: 4.1, tStabilized: 5.0 },
    ch: {
      yf:   [[0, 0, 0], [2.2, 0, 0], [2.5, 0.02, 0.18], [3.3, 0.45, 0.58], [4.1, 0.98, 0.30], [4.5, 1.0, 0], [5.0, 1.0, 0]],
      zf:   [[0, 0], [0.5, 0.03], [0.85, 0.005], [1.25, 0.05], [1.6, 0.01], [2.0, 0.14], [2.5, 0.28], [3.2, 0.62], [3.8, 0.88], [4.2, 0.99], [4.6, 1.0], [5.0, 1.0, 0]],
      x:    [[0, 0, 0], [5.0, 0, 0]],
      lean: [[0, 0.12, 0], [0.5, 0.19], [0.85, 0.13], [1.25, 0.22], [1.6, 0.15], [2.0, 0.40], [2.5, 0.37], [3.2, 0.34], [4.1, 0.33], [4.5, 0.30], [5.0, 0.32, 0]],
      roll: [[0, 0, 0], [5.0, 0, 0]],
      drop: [[0, 0, 0], [5.0, 0, 0]],
      arm:  [[0, 0, 0], [3.6, 0, 0], [4.3, 1.0], [5.0, 1.0, 0]],
    },
    stab: { lean: [0.015, 1.8, 0.4] },
  },
};
const PROFNAME = { hemiparesis: 'stroke', offload: 'hipFracture', dyspnea: 'copd', parkinson: 'parkinson' };
function hermite(keys) {
  const n = keys.length, tt = keys.map(k => k[0]), vv = keys.map(k => k[1]), m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (keys[i][2] !== undefined) { m[i] = keys[i][2]; continue; }
    const h0 = tt[i] - tt[i - 1], h1 = tt[i + 1] - tt[i], d0 = (vv[i] - vv[i - 1]) / h0, d1 = (vv[i + 1] - vv[i]) / h1;
    if (d0 * d1 > 0) { const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0; m[i] = (w1 + w2) / (w1 / d0 + w2 / d1); }   // 単調保存の接線（極値は0）
  }
  return (t) => {
    if (t <= tt[0]) return vv[0];
    if (t >= tt[n - 1]) return vv[n - 1];
    let i = 0; while (i < n - 2 && t > tt[i + 1]) i++;
    const h = tt[i + 1] - tt[i], u = (t - tt[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * vv[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * vv[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}
// 時間軸の再調整（VR上で人間らしい速度に見せるための初期値。医学的基準ではない）。
// 区分線形の時間ワープ：旧landmark時刻 → 新landmark時刻。各チャンネルの値の形（荷重差・前傾量・患側遅延・ためらい・予備運動）は保ち、時間だけを写す。
// 明示した接線は、その点のワープ倍率で割って速度の次元（値/秒）を保つ。症例差は総時間だけでなくこれらの形で表す。
const RETIME = {
  stroke:      { from: [0, 1.05, 1.5, 1.6, 3.2, 4.2], to: [0, 0.70, 1.00, 1.10, 2.30, 3.00] },   // peak trunk flexion 0.7 / seat-off 1.0 / extension 1.1 / 立位 2.3 / 安定 3.0
  hipFracture: { from: [0, 4.4], to: [0, 3.3] },                                                   // 全体を均等に圧縮（離臀前後のためらいは形として残す）
  copd:        { from: [0, 3.6], to: [0, 2.7] },
  parkinson:   { from: [0, 0.4, 2.0, 2.5, 2.6, 4.1, 5.0], to: [0, 0.4, 1.9, 2.3, 2.4, 3.4, 4.0] },   // 開始遅延と予備運動はほぼ維持し、動き出した後を圧縮（全身スローモーションにしない）
};
function retime(P, { from, to }) {
  const w = (t) => { let i = 0; while (i < from.length - 2 && t > from[i + 1]) i++; return to[i] + (t - from[i]) * (to[i + 1] - to[i]) / (from[i + 1] - from[i]); };
  const seg = (i) => (to[i + 1] - to[i]) / (from[i + 1] - from[i]);
  const k = (t) => { const idx = []; for (let i = 0; i < from.length - 1; i++) if (t >= from[i] - 1e-9 && t <= from[i + 1] + 1e-9) idx.push(i); return idx.reduce((s, i) => s + seg(i), 0) / idx.length; };
  for (const key of Object.keys(P.ch)) P.ch[key] = P.ch[key].map(([t, v, m]) => m === undefined ? [w(t), v] : [w(t), v, m / k(t)]);
  for (const key of Object.keys(P.ev)) P.ev[key] = Math.round(w(P.ev[key]) * 1000) / 1000;
  P.T = to[to.length - 1];
}
for (const [name, r] of Object.entries(RETIME)) retime(PROFILES[name], r);
for (const P of Object.values(PROFILES)) { P.f = {}; for (const k of Object.keys(P.ch)) P.f[k] = hermite(P.ch[k]); }
let PROF = PROFILES.stroke, PNAME = 'stroke';
// ---- NORMAL STS（実測motion-captureデータ由来。?sts=normal またはconsoleの osceSTS.normal() のときだけ使う。既定の4症例には影響しない）----
// データ: derived/normal_sts_motion.json（tools/build_normal_sts.py）。実装: normal_sts.js。病態の表現は加えない。
let NORMAL = typeof location !== 'undefined' && new URLSearchParams(location.search).get('sts') === 'normal';
let RAWS = null, RAWS_PROMISE = null;
const RAW_URL = './derived/normal_sts_motion.json';
let RAW_FOOTPIN = typeof location !== 'undefined' && new URLSearchParams(location.search).get('stsfoot') === 'pin';   // 既定OFF（実測の骨盤移動をそのまま使う）
function ensureRaw(win) {
  if (RAWS && !win) return Promise.resolve(RAWS);
  RAWS_PROMISE = loadRawSTS(RAW_URL, win).then((r) => { RAWS = r; return r; });
  return RAWS_PROMISE;
}
const rawWanted = () => NORMAL && !!RAWS;
function evalProfile(P, t, sv = 1) {
  t = Math.max(0, Math.min(P.T, t));
  const o = {};
  for (const k of Object.keys(P.f)) o[k] = P.f[k](t);
  for (const k of P.sv) o[k] *= sv;
  const ts = t - P.ev.tStand;
  if (ts > 0) for (const [k, [A, f, tau]] of Object.entries(P.stab)) o[k] += A * Math.exp(-ts / tau) * Math.sin(2 * Math.PI * f * ts);
  o.push = P.push;
  return o;
}
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
  const type = PROFNAME[sp.type] ? sp.type : 'hemiparesis';
  PNAME = PROFNAME[type]; PROF = PROFILES[PNAME];
  const sv = sp.severity ?? 1, spd = sp.speed ?? 1;
  AFF = sp.side === 'left' ? 'left' : 'right'; SND = AFF === 'right' ? 'left' : 'right'; SX = AFF === 'right' ? 1 : -1;
  const ff = sp.foot_forward ?? (type === 'dyspnea' || type === 'parkinson' ? 0 : type === 'offload' ? 0.18 : 0.15);
  ANKLE_Z[SND] = 0.12; ANKLE_Z[AFF] = 0.12 + ff;
  MOT = { type, sv, sym: type === 'dyspnea' || type === 'parkinson', liftK: type === 'parkinson' ? 0.35 : 1, walker: !!sp.walker, trunkK: type === 'hemiparesis' ? 0.15 : type === 'offload' ? -0.10 : 0,
    hands: sp.hands || (sp.walker ? 'walker' : type === 'dyspnea' ? 'thigh' : null), dropK: type === 'hemiparesis' ? 1 : 0,
    breath: { rate: sp.breath?.rate ?? 16, amp: sp.breath?.amp ?? 1 }, bump: HOLDBUMP[type] };
  STAND_DURATION = rawWanted() ? RAWS.duration : PROF.T;   // 立ち上がりの所要時間は症例プロファイル固有（patient.motion.speed は使わない。歩行のタイミングには従来どおり使う）
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
  const out = evalProfile(PROF, t, MOT.sv);
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

let boostT0 = null, breathPh = 0, lastTick = null, curBreath = { rate: 0, amp: 1, boost: 0 };

// ===== 立ち上がり指標（動作確認用）：console.table で4症例を一覧 =====
//  ブラウザのconsoleで  osceSTS.all()  （現在の患者だけなら  __osce.patient.stsReport()）
function stsMetrics(name, sv = 1) {
  const P = PROFILES[name], N = Math.round(P.T / 0.005), dt = P.T / N, r = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  let pk = { v: -1, t: 0 }, dk = { v: -1, t: 0 }, lat = 0, tSeat = null, vSeat = 0, minV = 1e9, prev = null;
  const pos = (p) => ({ y: Y_SIT + p.yf * (Y_STAND - Y_SIT), z: Z_SIT + p.zf * (Z_STAND - Z_SIT), x: p.x });
  for (let i = 0; i <= N; i++) {
    const t = i * dt, p = evalProfile(P, t, sv), q = pos(p);
    if (p.lean > pk.v) pk = { v: p.lean, t };
    if (p.drop > dk.v) dk = { v: p.drop, t };
    lat = Math.max(lat, Math.abs(p.x));
    if (tSeat === null && p.yf >= 0.02 - 1e-9) tSeat = t;
    if (prev) {
      const v = Math.hypot(q.y - prev.y, q.z - prev.z, q.x - prev.x) / dt;
      if (t >= P.ev.tPeakFlexion && t <= P.ev.tStand) minV = Math.min(minV, v);
      if (Math.abs(t - P.ev.tSeatOff) <= dt / 2 + 1e-9) vSeat = v;
    }
    prev = q;
  }
  const f = evalProfile(P, P.T, sv), q = pos(f);
  const knee = (zAnk, drop) => { const [a, b] = solveLeg(zAnk - q.z, ANKLE_Y - (q.y - drop)); return Math.round((a - b) * 180 / Math.PI); };
  return {
    total_duration_s: P.T,
    seat_off_s: r(tSeat), seat_off_landmark_s: P.ev.tSeatOff,
    pelvis_speed_at_seat_off_cm_s: r(vSeat * 100, 1), min_pelvis_speed_peakflex_to_stand_cm_s: r(minV * 100, 1),
    peak_trunk_flexion_deg: r(pk.v * 180 / Math.PI, 1), peak_trunk_flexion_s: r(pk.t),
    max_lateral_pelvis_shift_cm: r(lat * 100, 1),
    affectedHipDrop_peak_cm: r(dk.v * 100, 1), affectedHipDrop_peak_s: r(dk.t),
    final_lean_deg: r(f.lean * 180 / Math.PI, 1), final_pelvis_x_cm: r(f.x * 100, 1), final_roll_deg: r(f.roll * 180 / Math.PI, 1), final_drop_cm: r(f.drop * 100, 1),
    final_knee_affected_deg: knee(0.12 + P.ff, f.drop), final_knee_sound_deg: knee(0.12, 0),
  };
}
if (typeof window !== 'undefined') {
  window.osceSTS = { all() {
    const rows = {}; for (const [k, v] of [['case01 stroke', 'stroke'], ['case02 hipFracture', 'hipFracture'], ['case03 copd', 'copd'], ['case04 parkinson', 'parkinson']]) rows[k] = stsMetrics(v);
    console.table(rows); return rows;
  } };
}

export function createPatient(scene, M, spec = {}) {
  setMotion(spec.motion);
  boostT0 = null; breathPh = 0; lastTick = null; curBreath = { rate: 0, amp: 1, boost: 0 };   // 症例切替時に前回の呼吸状態を引き継がない
  at = { knee: 0, trunk: 0, pelvis: 0, cue: 0 }; ab.knee = ab.trunk = ab.pelvis = ab.cue = 0;
  const root = new THREE.Group(); root.name = 'patient'; scene.add(root);
  // 患者の局所座標系（patientRoot）：avatar・歩行器・足の目標・手の接触点・動作の基準はすべてこの座標系で扱う。
  // spec.placement = { x, z, yaw_deg } で、部屋の中の位置と向きだけを与える（患者ローカルの運動学は変えない）。
  if (spec.placement) { const PL = spec.placement; root.position.set(PL.x || 0, PL.y || 0, PL.z || 0); root.rotation.y = (PL.yaw_deg || 0) * Math.PI / 180; }
  root.updateMatrixWorld(true);
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
  let bm = null;   // bed mobility
  const BED_W = { x0: -0.5, x1: 0.5, z0: -2.0, z1: 0, top: 0.50 };   // main.js のマットレス（箱）の位置・上面
  const REST = {};
  let rawCtx = null;
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
    for (const n of ['hips', 'spine', 'chest', 'neck', 'head', 'clav_L', 'clav_R', 'uarm_L', 'uarm_R', 'larm_L', 'larm_R', 'hand_L', 'hand_R', 'uleg_L', 'uleg_R', 'lleg_L', 'lleg_R', 'foot_L', 'foot_R', 'toe_L', 'toe_R']) REST[n] = { q: B[n].quaternion.clone(), p: B[n].position.clone() };   // 実測データ適用用のrest姿勢
    if (spec.bedmob) {   // 臥位→端座位（debug再生のみ。UI・採点・ログには接続しない）
      bm = createBedMobility({ root, B, arm, bodyScene: gltf.scene, HIP_X, bed: BED_W, applySts0: () => apply(paramsAt(0), null, 'stand') });
      window.osceBed = makeBedApi();
    }
    attachSTSApi();
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
    root.updateMatrixWorld(true);
    const rQi = root.getWorldQuaternion(new THREE.Quaternion()).invert();   // 患者局所座標系で計算する（root が配置されていても同じ結果）
    const Lq = (o) => o.getWorldQuaternion(new THREE.Quaternion()).premultiply(rQi);
    const w = p.arm ?? ss((p.yf - 0.15) / 0.45);   // 0=座位（手は大腿上）→1=立位（腕は体側・歩行器）。立ち上がり中はプロファイルのarmチャンネル（歩行器は立位に近づいてから把持）
    for (const [sfx, sg] of [['L', 1], ['R', -1]]) {
      const A = body.arm[sfx], U = B['uarm_' + sfx], F = B['larm_' + sfx], H = B['hand_' + sfx];
      const S = root.worldToLocal(U.getWorldPosition(new THREE.Vector3()));
      const seat = new THREE.Vector3(p.x + sg * 0.15, p.y + 0.115, p.z + 0.26);   // 大腿の上（手首の位置）
      if (p.push) seat.lerp(new THREE.Vector3(sg * 0.15, Y_SIT + 0.105, Z_SIT + 0.26), p.push);   // 押し上がり：手はベッド面・大腿の位置に残し、骨盤だけが上がる（歩行器は引かない）
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
      const Pc = Lq(B['clav_' + sfx]);
      aim(U, Pc, A.d0u, du, 0); U.updateMatrixWorld(true);
      aim(F, Lq(U), A.d0f, df, 0); F.updateMatrixWorld(true);
      // 手：座位では大腿に沿って寝かせ（手のひらは下）、立位では前腕の延長（手のひらは内側）
      const flat = new THREE.Vector3(sg * -0.06, -0.12, 1).normalize();
      const dh = flat.clone().lerp(df, w).normalize();
      const Qf = Lq(F);
      aim(H, Qf, A.d0f, dh, 0); H.updateMatrixWorld(true);
      const Qh = Lq(H);
      const n = A.palm0.clone().applyQuaternion(Qh);
      const want = new THREE.Vector3(sg * -1, 0, 0.1).multiplyScalar(w).add(new THREE.Vector3(0, -1, 0).multiplyScalar(1 - w)).normalize();
      const pn = n.addScaledVector(dh, -n.dot(dh)).normalize(), pw = want.addScaledVector(dh, -want.dot(dh)).normalize();
      const roll = Math.atan2(dh.dot(new THREE.Vector3().crossVectors(pn, pw)), pn.dot(pw));
      aim(H, Qf, A.d0f, dh, roll);
    }
  }

  // ---- 実測データのNORMAL STS：骨盤の位置・向き、体幹、頭頸部、両側の股・膝・足首・肩・肘・手首を実測から適用する ----
  const _rq = new THREE.Quaternion();
  function rawSetBones(c, N) {
    const M = boneMotions(c.q, N);
    for (const [n, q] of Object.entries(M)) B_(n).quaternion.copy(REST[n].q).multiply(q);   // restQuaternion × 実測motion
    for (const n of ['uleg_L', 'uleg_R']) B_(n).position.copy(REST[n].p);
  }
  const B_ = (n) => body.B[n];
  function rawInit() {
    const N = armNeutral(body.arm), R = RAWS, s = (L1 + L2) / R.legLen;   // 実測の下肢長に対するavatarの下肢長
    const c = R.sample(0); rawSetBones(c, N); B_('hips').position.set(0, 0, 0); root.updateMatrixWorld(true);
    const rel = (n) => root.worldToLocal(B_(n).getWorldPosition(new THREE.Vector3()));
    const ank = rel('foot_L').add(rel('foot_R')).multiplyScalar(0.5);
    // 初期位置：骨盤は座面（Z_SIT）、左右は中央、高さは「両足首が床の高さ(ANKLE_Y)になる」位置。以後は実測の骨盤移動（avatar脚長比でスケール）
    const o = { N, s, p0: c.pos.clone(), ax: 0, ay: ANKLE_Y - ank.y, az: Z_SIT, pin: RAW_FOOTPIN };
    o.ankT = ank.clone().add(new THREE.Vector3(o.ax, o.ay, o.az));   // 足首の目標位置（footPin用）
    return o;
  }
  function applyRaw(t) {
    const R = RAWS, c = R.sample(t); if (!rawCtx) rawCtx = rawInit();
    const X = rawCtx; rawSetBones(c, X.N);
    B_('hips').position.set(X.ax + X.s * (c.pos.x - X.p0.x), X.ay + X.s * (c.pos.y - X.p0.y), X.az + X.s * (c.pos.z - X.p0.z));
    root.updateMatrixWorld(true);
    if (X.pin) {   // 任意（既定OFF）：両足首を初期位置に固定するよう、骨盤の前後・上下だけを補正する（実測の骨盤移動からのずれはkin().qcに出る）
      const a = root.worldToLocal(B_('foot_L').getWorldPosition(new THREE.Vector3())).add(root.worldToLocal(B_('foot_R').getWorldPosition(new THREE.Vector3()))).multiplyScalar(0.5);
      B_('hips').position.y += X.ankT.y - a.y; B_('hips').position.z += X.ankT.z - a.z; root.updateMatrixWorld(true);
    }
    return { pelvisY: B_('hips').position.y, pelvisZ: B_('hips').position.z, lean: 0 };
  }
  // 姿勢を適用して、確認用の値を返す（立ち上がり）
  function pose(t) { redo = () => pose(t); lastT = t; if (rawWanted() && body) return applyRaw(t); return apply(paramsAt(t), null, 'stand'); }
  // COPD：立ち上がり完了後に呼吸亢進を開始（座位に戻す時にリセット）
  function trackBoost(t) {
    if (!PROF.breathBoost) return;
    if (t >= PROF.ev.tStand) { if (boostT0 === null) boostT0 = performance.now() / 1000; }
    else if (t < PROF.ev.tSeatOff) boostT0 = null;
  }
  // 動作の種類（stand=立ち上がり／hold=立位保持／walk=歩行）と時刻から姿勢を適用する
  function poseAt(mode, t) {
    if (mode === 'bedmob') { redo = () => poseAt(mode, t); return bm ? bm.pose(t) : null; }
    if (mode === 'stand') trackBoost(t);
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
      B.hips.rotation.set(0, 0, 0);
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

  // ---- STS debug API（console: osceSTS.normal() / osceSTS.kin() / osceSTS.play()）。
  //      表示されている骨のworld変換から計算する（設定値ではない）。患者局所の矢状面（x=左,y=上,z=前）で表すので、patientRootのyawに依存しない ----
  function attachSTSApi() {
    if (!window.osceSTS) window.osceSTS = {};
    const S = window.osceSTS;
    const sync = () => { STAND_DURATION = rawWanted() ? RAWS.duration : PROF.T; rawCtx = null; if (body) poseAt('stand', 0); };
    S.normal = async (on = true, opt = {}) => {
      NORMAL = !!on; if (opt.footPin !== undefined) RAW_FOOTPIN = !!opt.footPin;
      if (NORMAL) await ensureRaw(opt.window || null);
      sync(); return { normal: NORMAL, duration: STAND_DURATION, window: RAWS && RAWS.win };
    };
    if (NORMAL) (RAWS ? Promise.resolve() : ensureRaw()).then(sync);
    S.play = (opt = {}) => {
      const sp = opt.speed || 1, t0 = performance.now(), dur = STAND_DURATION;
      const step = () => { const t = Math.min(dur, (performance.now() - t0) / 1000 * sp); poseAt('stand', t); if (t < dur) requestAnimationFrame(step); else if (opt.done) opt.done(); };
      step();
    };
    S.kin = (opt = {}) => {
      const B = body.B, T = STAND_DURATION, raw = rawWanted(), dt = opt.dt || (raw ? RAWS.dt : 0.05), rows = [];
      const V = (n) => root.worldToLocal(B[n].getWorldPosition(new THREE.Vector3()));
      const mid = (a, b) => a.clone().add(b).multiplyScalar(0.5), deg = (r) => r * 180 / Math.PI;
      const ang = (a, b) => deg(Math.acos(Math.max(-1, Math.min(1, a.clone().normalize().dot(b.clone().normalize())))));
      const inv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
      const Lq = (n) => B[n].getWorldQuaternion(new THREE.Quaternion()).premultiply(inv);
      const N = Math.round(T / dt);
      const err = {}, orient = {}, perr = [], foot = [];
      const acc = (o, k, v) => { const a = (o[k] ||= { n: 0, ss: [0, 0, 0], max: [0, 0, 0] }); a.n++; v.forEach((x, i) => { a.ss[i] += x * x; a.max[i] = Math.max(a.max[i], Math.abs(x)); }); };
      let ank0 = null;
      for (let i = 0; i <= N; i++) {
        const t = Math.min(T, i * dt); poseAt('stand', t); root.updateMatrixWorld(true);
        const hip = V('hips'), sh = mid(V('uarm_L'), V('uarm_R')), head = V('head'), hipC = mid(V('uleg_L'), V('uleg_R')), kneeC = mid(V('lleg_L'), V('lleg_R')), ankC = mid(V('foot_L'), V('foot_R'));
        const tr = sh.clone().sub(hip), q = Lq('hips'), up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
        const row = { t, rawT: raw ? RAWS.win[0] + t : undefined, pelvisAP: hip.z, pelvisUp: hip.y, pelvisX: hip.x, trunkDeg: deg(Math.atan2(tr.z, tr.y)), pelvisTiltDeg: deg(Math.atan2(up.z, up.y)),
          headFwd: head.z, headUp: head.y, hipFlexDeg: 180 - ang(sh.clone().sub(hipC), kneeC.clone().sub(hipC)), kneeFlexDeg: 180 - ang(hipC.clone().sub(kneeC), ankC.clone().sub(kneeC)), lateral: hip.x };
        if (raw && rawCtx) {
          const W = {}; for (const n of Object.keys(REST)) W[n] = Lq(n);
          const seg = segmentsFromWorld(W, rawCtx.N), c = RAWS.sample(t);
          for (const [jn, [p, ch]] of Object.entries(JOINTS)) for (const sd of ['L', 'R']) {
            const key = sd + jn, a = jointAngles(RAWS.conv[key], p ? seg[p.replace('{}', sd)] : null, seg[ch.replace('{}', sd)]), r = RAWS.refAngle(key, t);
            acc(err, key, a.map((v, k) => v - r[k]));
            if (['Hip', 'Knee', 'Ankle'].includes(jn)) { row[sd + jn + 'X'] = a[0]; row[sd + jn + 'Y'] = a[1]; row[sd + jn + 'Z'] = a[2]; row[sd + jn + 'X_csv'] = r[0]; }
            if (jn === 'Pelvis') row[sd + 'PelvisX'] = a[0];
          }
          for (const s of Object.keys(seg)) { const a = 2 * deg(Math.acos(Math.min(1, Math.abs(seg[s].dot(c.q[s]))))); acc(orient, s, [a, 0, 0]); }
          const X = rawCtx, want = new THREE.Vector3(X.ax + X.s * (c.pos.x - X.p0.x), X.ay + X.s * (c.pos.y - X.p0.y), X.az + X.s * (c.pos.z - X.p0.z));
          const un = new THREE.Vector3(c.pos.x - X.p0.x, c.pos.y - X.p0.y, c.pos.z - X.p0.z);                          // 実測マーカー由来の骨盤移動（スケール前）
          perr.push({ scaledDiff: hip.clone().sub(want), vsRaw: hip.clone().sub(new THREE.Vector3(X.ax, X.ay, X.az)).sub(un) });
          const aL = V('foot_L'), aR = V('foot_R'); if (!ank0) ank0 = [aL.clone(), aR.clone()];
          foot.push({ yL: aL.y - ank0[0].y, yR: aR.y - ank0[1].y, zL: aL.z - ank0[0].z, zR: aR.z - ank0[1].z, floorErr: Math.min(aL.y, aR.y) - ANKLE_Y });
        }
        rows.push(row);
      }
      const d = (k, i) => (rows[i + 1][k] - rows[i - 1][k]) / (rows[i + 1].t - rows[i - 1].t);
      for (let i = 1; i < rows.length - 1; i++) { rows[i].vAP = d('pelvisAP', i); rows[i].vUp = d('pelvisUp', i); rows[i].trunkW = d('trunkDeg', i); }
      const pk = rows.reduce((a, r) => (r.trunkDeg > a.trunkDeg ? r : a), rows[0]);
      const r0 = rows[0], mid2 = rows.filter((r) => r.vAP !== undefined);
      const vmax = mid2.reduce((a, r) => (r.vAP > a.vAP ? r : a), mid2[0]);
      const summary = { mode: raw ? 'normal(raw mocap)' : PNAME, T, peakTrunkDeg: +pk.trunkDeg.toFixed(1), peakTrunkT: pk.t, peakPelvisTiltDeg: +Math.max(...rows.map((r) => r.pelvisTiltDeg)).toFixed(1),
        peakHipFlexDeg: +Math.max(...rows.map((r) => r.hipFlexDeg)).toFixed(1), headFwdMaxCm: +(Math.max(...rows.map((r) => r.headFwd - r0.headFwd)) * 100).toFixed(1),
        maxVAP_cms: +(vmax.vAP * 100).toFixed(1), maxVAP_t: vmax.t, maxVUp_cms: +(Math.max(...mid2.map((r) => r.vUp)) * 100).toFixed(1), maxLateral_mm: +(Math.max(...rows.map((r) => Math.abs(r.lateral - r0.lateral))) * 1000).toFixed(1) };
      let qc = null;
      if (raw && rawCtx) {
        const fin = (o, ndim) => Object.fromEntries(Object.entries(o).map(([k, a]) => [k, { rmse: a.ss.slice(0, ndim).map((x) => +Math.sqrt(x / a.n).toFixed(4)), max: a.max.slice(0, ndim).map((x) => +x.toFixed(4)) }]));
        const mx = (f) => +(Math.max(...perr.map((p) => Math.abs(f(p)))) * 1000).toFixed(2);
        qc = { jointAngle_deg_vs_CSV: fin(err, 3), segmentOrientation_geodesic_deg: fin(orient, 1),
          pelvisPosition_mm: { footPin: rawCtx.pin, scale: +rawCtx.s.toFixed(4), 'avatar_vs_scaled_marker(AP,Up,Lat) max': [mx((p) => p.scaledDiff.z), mx((p) => p.scaledDiff.y), mx((p) => p.scaledDiff.x)],
            'avatar_vs_unscaled_marker(AP,Up,Lat) max': [mx((p) => p.vsRaw.z), mx((p) => p.vsRaw.y), mx((p) => p.vsRaw.x)] },
          feet: { 'ankleHeightChange_mm max(L,R)': [+(Math.max(...foot.map((f) => Math.abs(f.yL))) * 1000).toFixed(1), +(Math.max(...foot.map((f) => Math.abs(f.yR))) * 1000).toFixed(1)],
            'ankleAPSlide_mm max(L,R)': [+(Math.max(...foot.map((f) => Math.abs(f.zL))) * 1000).toFixed(1), +(Math.max(...foot.map((f) => Math.abs(f.zR))) * 1000).toFixed(1)],
            'lowestAnkleVsFloor_mm (min,max)': [+(Math.min(...foot.map((f) => f.floorErr)) * 1000).toFixed(1), +(Math.max(...foot.map((f) => f.floorErr)) * 1000).toFixed(1)] } };
      }
      poseAt('stand', 0);
      if (!opt.quiet) { console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v])))); console.log(JSON.stringify(summary)); if (qc) console.log(JSON.stringify(qc, null, 1)); }
      return { summary, rows, qc };
    };
  }
  // ---- bed mobility のdebug再生（console: osceBed.play() など）----
  function makeBedApi() {
    let raf = 0, stopFlag = false;
    const run = (mode, dur, speed, done) => {
      stopFlag = false; const t0 = performance.now();
      const step = () => {
        if (stopFlag) return;
        const t = Math.min(dur, (performance.now() - t0) / 1000 * speed); poseAt(mode, t);
        if (t < dur) raf = requestAnimationFrame(step); else if (done) done();
      };
      cancelAnimationFrame(raf); step();
    };
    return {
      get ready() { return !!bm; },
      play(opt = {}) { const sp = opt.speed || 1; run('bedmob', bm.T, sp, () => { if (opt.thenStand) run('stand', STAND_DURATION, sp, opt.done); else if (opt.done) opt.done(); }); },
      playThenStand(opt = {}) { this.play({ ...opt, thenStand: true }); },
      at(t) { poseAt('bedmob', t); }, stop() { stopFlag = true; cancelAnimationFrame(raf); },
      toSitting() { poseAt('stand', 0); },
      validate() { const r = bm.validate(); console.table([r]); console.log(JSON.stringify(r, null, 1)); poseAt('stand', 0); return r; },
    };
  }
  // 手で触れて介助するための接触範囲（球）。患者の動きに追従する。右膝・体幹・骨盤。
  const _w = [new THREE.Vector3(), new THREE.Vector3()];
  function touchZones() {
    let knee, trunkC, pelv;
    const rq = root.getWorldQuaternion(new THREE.Quaternion());
    const off = (x, y, z) => new THREE.Vector3(x, y, z).applyQuaternion(rq);   // 患者の向きに合わせてオフセットを回す
    if (body) {
      const B = body.B;
      B.hips.getWorldPosition(_w[0]); pelv = _w[0].clone().add(off(0, 0.03, 0));
      B['lleg_' + (AFF === 'right' ? 'R' : 'L')].getWorldPosition(_w[0]); knee = _w[0].clone().add(off(0, 0, 0.04));
      B.spine.getWorldPosition(_w[0]); B.chest.getWorldPosition(_w[1]); trunkC = _w[0].clone().add(_w[1]).multiplyScalar(0.5).add(off(0, 0.1, 0.03));
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
      if (rawWanted()) return;   // 実測データのNORMAL STS中は、呼吸などの人工的な動きを加えない
      const b = MOT.breath, BB = PROF.breathBoost;
      let bo = 0;
      if (BB && boostT0 !== null) { const tau = time - boostT0; if (tau >= 0) bo = Math.min(1, tau / BB.rise) * (tau < BB.hold ? 1 : Math.exp(-(tau - BB.hold) / BB.decay)); }
      const rate = b.rate + (BB ? BB.rate * bo : 0), amp = b.amp + (BB ? BB.amp * bo : 0);
      breathPh += 2 * Math.PI * rate / 60 * (lastTick === null ? 0 : Math.max(0, Math.min(0.1, time - lastTick))); lastTick = time;   // 位相を積算（呼吸数が変わっても飛ばない）
      curBreath = { rate: Math.round(rate * 10) / 10, amp: Math.round(amp * 100) / 100, boost: Math.round(bo * 100) / 100 };
      const ph = Math.sin(breathPh), acc = Math.max(0, amp - 1);
      body.B.chest.rotation.x = baseChestX + 0.012 * amp * ph;
      const lift = 0.03 * acc * (0.5 + 0.5 * ph) + (BB ? BB.sh * bo * (0.6 + 0.4 * ph) : 0);
      body.B.clav_L.rotation.z = lift; body.B.clav_R.rotation.z = -lift;
    },
    get breath() { return curBreath; },
    stsReport() { return stsMetrics(PNAME, MOT.sv); },
    dispose() { scene.remove(root); },
    get motion() { return { type: MOT.type, side: AFF, walker: MOT.walker }; },
    get stsMode() { return rawWanted() ? 'normal' : PNAME; },
    get durations() { return { stand: STAND_DURATION, hold: HOLD_DURATION, walk: WALK_DURATION, ...(bm ? { bedmob: bm.T } : {}) }; }, get duration() { return STAND_DURATION; }, get usingModel() { return !!body; }, get body() { return body; } };
}
