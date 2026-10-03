// 実測motion-captureデータ由来の NORMAL STS（debug motion）。?sts=normal / osceSTS.normal() のときだけ使う。
// データ: derived/normal_sts_motion.json（tools/build_normal_sts.py が data/raw の元CSVから作る。元CSVは変更しない）
//  - 100 Hz の実測サンプルを elapsed time で参照し、隣接サンプル間を線形補間する（向き=球面線形補間(slerp)、位置=線形補間）。
//    平滑化・Hermite・自動接線・人工的な速度プロファイルは使わない。
//  - 向きは segment frame（解剖学的frame: x=患者左, y=上, z=前）。角度列(X/Y/Z)の左右の符号規約は、同一segmentの向きから
//    角度列を再計算して元CSVと一致することを確認済み（左右の値を平均したり、X/Y/Zを別々に平均したりしない）。
//  - avatarへは「restQuaternion × 実測motionのquaternion」で適用する。
import * as THREE from 'three';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const I = () => new THREE.Quaternion();
const inv = (q) => q.clone().invert();

export async function loadRawSTS(url, win) {
  const r = await fetch(url); if (!r.ok) throw new Error('NORMAL STS data: ' + r.status);
  return new RawSTS(await r.json(), win);
}

export class RawSTS {
  constructor(j, win) {
    this.meta = j.meta; this.t = Float64Array.from(j.t); this.n = this.t.length; this.dt = 1 / j.meta.fs;
    this.win = win || j.meta.defaultWindow;                     // [t0, t1]（raw time, 秒）
    this.q = {}; for (const [s, a] of Object.entries(j.quat)) { const f = new Float64Array(a.length * 4); a.forEach((v, i) => f.set(v, i * 4)); this.q[s] = f; }
    this.pos = Float64Array.from(j.pelvisHJC.flat());          // マーカー由来の骨盤（股関節中心）位置 m（患者座標 x=左,y=上,z=前）
    this.asis = Float64Array.from(j.pelvisASISmid.flat());
    this.ankle = Float64Array.from(j.ankleMid.flat());
    this.legLen = (j.lengths_m.LFE + j.lengths_m.LTI + j.lengths_m.RFE + j.lengths_m.RTI) / 2;   // 実測の下肢長（大腿+下腿, m）
    this.conv = j.angleConvention; this.ref = j.refAngles;
    this.mk = () => { const c = { pos: new THREE.Vector3(), q: {} }; for (const s of Object.keys(this.q)) c.q[s] = new THREE.Quaternion(); return c; };
    this.cur = this.mk();
  }
  get duration() { return this.win[1] - this.win[0]; }
  // elapsed(秒, 0=区間開始) → 隣接2サンプル間の補間値。範囲外は両端で止める
  locate(e) {
    const tr = Math.max(this.win[0], Math.min(this.win[1], this.win[0] + e));
    let f = (tr - this.t[0]) / this.dt; let i = Math.floor(f + 1e-9); i = Math.max(0, Math.min(this.n - 2, i));
    return { i, a: Math.max(0, Math.min(1, f - i)), tr };
  }
  sample(e, out) {
    const { i, a, tr } = this.locate(e), c = out || this.cur;
    for (const [s, f] of Object.entries(this.q)) {
      _q.fromArray(f, i * 4); _q2.fromArray(f, (i + 1) * 4); if (_q.dot(_q2) < 0) _q2.set(-_q2.x, -_q2.y, -_q2.z, -_q2.w);
      c.q[s].copy(_q).slerp(_q2, a);
    }
    const P = this.pos; c.pos.set(P[i * 3] + (P[i * 3 + 3] - P[i * 3]) * a, P[i * 3 + 1] + (P[i * 3 + 4] - P[i * 3 + 1]) * a, P[i * 3 + 2] + (P[i * 3 + 5] - P[i * 3 + 2]) * a);
    c.tr = tr; return c;
  }
  // 元CSVの角度列（deg）を同じ時刻で線形補間して返す。key 例: 'LHip'
  refAngle(key, e) { const { i, a } = this.locate(e); const A = this.ref[key]; return [0, 1, 2].map((k) => A[i][k] + (A[i + 1][k] - A[i][k]) * a); }
  rawVec(arr, e, out = new THREE.Vector3()) { const { i, a } = this.locate(e); return out.set(...[0, 1, 2].map((k) => arr[i * 3 + k] + (arr[i * 3 + 3 + k] - arr[i * 3 + k]) * a)); }
}

// アバターのrest姿勢（A-pose：腕は斜め下）に対する補正。実測segmentの「ぶら下がり中立」へ、骨のrest方向を合わせる最小回転
export function armNeutral(arm) {
  const down = new THREE.Vector3(0, -1, 0), N = {};
  for (const s of ['L', 'R']) N[s] = { u: new THREE.Quaternion().setFromUnitVectors(arm[s].d0u, down), f: new THREE.Quaternion().setFromUnitVectors(arm[s].d0f, down) };
  return N;
}

// 実測segmentの向き（患者座標のquaternion）→ 各boneの「motion quaternion」。bone.quaternion = restQuaternion × motion
// 計測されていない配分（spine/chest、neck/head の2骨への分け方）は合計が実測と一致するようにだけ決める（50%/50%）
export function boneMotions(q, N) {
  const m = {};
  m.hips = q.PEL.clone();
  const rel = inv(q.PEL).multiply(q.TRX), sp = I().slerp(rel, 0.5);
  m.spine = sp; m.chest = inv(sp).multiply(rel);
  const rn = inv(q.TRX).multiply(q.HED), nk = I().slerp(rn, 0.5);
  m.neck = nk; m.head = inv(nk).multiply(rn);
  m.clav_L = I(); m.clav_R = I();                             // 鎖骨のjoint角はexportに無いので動かさない（上腕の向きは胸郭基準の実測shoulder角から決まる）
  for (const s of ['L', 'R']) {
    m['uleg_' + s] = inv(q.PEL).multiply(q[s + 'FE']);
    m['lleg_' + s] = inv(q[s + 'FE']).multiply(q[s + 'TI']);
    m['foot_' + s] = inv(q[s + 'TI']).multiply(q[s + 'FO']);
    m['toe_' + s] = inv(q[s + 'FO']).multiply(q[s + 'TO']);
    const Nu = N[s].u, Nf = N[s].f;
    m['uarm_' + s] = inv(q.TRX).multiply(q[s + 'HU']).multiply(Nu);
    m['larm_' + s] = inv(Nu).multiply(inv(q[s + 'HU'])).multiply(q[s + 'RA']).multiply(Nf);
    m['hand_' + s] = inv(Nf).multiply(inv(q[s + 'RA'])).multiply(q[s + 'HN']).multiply(Nf);
  }
  return m;
}

// 表示中のavatarの骨のworld向き（患者座標）から segment の向きを復元する（QC用。boneMotionsの逆）
export function segmentsFromWorld(W, N) {
  const q = {};
  q.PEL = W.hips.clone(); q.TRX = W.chest.clone(); q.HED = W.head.clone();
  for (const s of ['L', 'R']) {
    q[s + 'FE'] = W['uleg_' + s].clone(); q[s + 'TI'] = W['lleg_' + s].clone(); q[s + 'FO'] = W['foot_' + s].clone(); q[s + 'TO'] = W['toe_' + s].clone();
    q[s + 'HU'] = W['uarm_' + s].clone().multiply(inv(N[s].u)); q[s + 'RA'] = W['larm_' + s].clone().multiply(inv(N[s].f)); q[s + 'HN'] = W['hand_' + s].clone().multiply(inv(N[s].f));
  }
  return q;
}

// segment向き → 角度列(X,Y,Z; deg)。関節ごとのEuler順序・成分の対応・符号は、元CSVを再現できることを確認した値（JSON angleConvention）
const _m = new THREE.Matrix4(), _e = new THREE.Euler();
export function jointAngles(conv, parentQ, childQ) {
  const r = parentQ ? inv(parentQ).multiply(childQ) : childQ.clone();
  _m.makeRotationFromQuaternion(r); _e.setFromRotationMatrix(_m, conv.seq);
  const e = [_e.x, _e.y, _e.z].map((v) => v * 180 / Math.PI);
  // three.js の _e.x/_e.y/_e.z は order の1番目・2番目・3番目ではなく、軸x/y/zの回転量。scipy形式（order順）へ並べ替える
  const ord = [...conv.seq].map((ch) => ({ X: 0, Y: 1, Z: 2 })[ch]), seqVals = ord.map((ax) => e[ax]);
  return [0, 1, 2].map((k) => conv.sign[k] * seqVals[conv.perm[k]]);
}
export const JOINTS = {   // [名前, 親segment, 子segment]（{}は L/R）
  Pelvis: [null, 'PEL'], Thorax: [null, 'TRX'], Head: [null, 'HED'], Spine: ['PEL', 'TRX'], Neck: ['TRX', 'HED'],
  Hip: ['PEL', '{}FE'], Knee: ['{}FE', '{}TI'], Ankle: ['{}TI', '{}FO'], Shoulder: ['TRX', '{}HU'], Elbow: ['{}HU', '{}RA'], Wrist: ['{}RA', '{}HN'],
};

// ====== motion modifiers（実測NORMALの上に重ねる。実測データ・NORMAL本体は変更しない）======
// 値を既定にすると（または modifier を off にすると）適用されず、実測NORMALそのものになる。病態ごとの値はまだ決めていない。
export const MOD_DEFAULT = Object.freeze({
  timeScale: 1.0,                 // 所要時間の倍率（>1でゆっくり）。CSVの時間軸だけを伸縮し、波形の形は変えない
  rightFootAPOffset: 0.0,         // m  右足の接地位置を前(+)/後(-)へ
  leftFootAPOffset: 0.0,          // m  左足の接地位置を前(+)/後(-)へ
  stanceWidthOffset: 0.0,         // m  両足の間隔を広げる(+)/狭める(-)（左右へ半分ずつ）
  pelvisLateralOffset: 0.0,       // m  骨盤を患者の左(+)/右(-)へ
  trunkFlexionGain: 1.0,          // 胸郭の前傾量（開始姿勢からの変化量）の倍率。頭・腕は胸郭に対する実測の相対角を保ったまま追従
  rightLegTimeDelay: 0.0,         // s  右脚（股・膝・足首の関節角）の時間遅れ
  leftLegTimeDelay: 0.0,          // s
  rightKneeExtensionGain: 1.0,    // 右膝の伸展量（開始姿勢からの変化量）の倍率
  leftKneeExtensionGain: 1.0,
});
export const MOD_LIMITS = { timeScale: [0.2, 5], rightFootAPOffset: [-0.5, 0.5], leftFootAPOffset: [-0.5, 0.5], stanceWidthOffset: [-0.3, 0.6], pelvisLateralOffset: [-0.3, 0.3],
  trunkFlexionGain: [0, 2], rightLegTimeDelay: [0, 2], leftLegTimeDelay: [0, 2], rightKneeExtensionGain: [0, 2], leftKneeExtensionGain: [0, 2] };
export const modIsDefault = (M) => Object.keys(MOD_DEFAULT).every((k) => M[k] === MOD_DEFAULT[k]);
export function modClean(key, v) {
  if (!(key in MOD_DEFAULT)) throw new Error('unknown modifier: ' + key);
  v = Number(v); if (!Number.isFinite(v)) throw new Error(key + ': number required');
  const [a, b] = MOD_LIMITS[key]; return Math.max(a, Math.min(b, v));
}

// 骨格ツリー：親→子（segment名）。関節の相対回転（親^-1 × 子）を保ったまま、必要な関節だけ変えて親から組み直す
const TREE = [['PEL', 'TRX'], ['TRX', 'HED']];
for (const s of ['L', 'R']) TREE.push(['PEL', s + 'FE'], [s + 'FE', s + 'TI'], [s + 'TI', s + 'FO'], [s + 'FO', s + 'TO'], ['TRX', s + 'HU'], [s + 'HU', s + 'RA'], [s + 'RA', s + 'HN'], ['TRX', s + 'CL']);
const _sa = {}, _sb = {}, _s0 = {};
// e: 出力側の経過時間(秒)。戻り: 修正後の segment 向き（Quaternion のmap）と、骨盤位置（修正前のまま）
export function modSegments(R, e, M) {
  const A = (_sa.c ||= R.mk()), B = (_sb.c ||= R.mk()), S0 = (_s0.c ||= R.mk());
  const k = M.timeScale, base = R.sample(e / k, A), start = R.sample(0, S0);
  const rel = (c, p, ch) => inv(c.q[p]).multiply(c.q[ch]);
  const out = {}; out.PEL = base.q.PEL.clone();
  const relOf = {};
  for (const [p, ch] of TREE) relOf[ch] = rel(base, p, ch);
  // 脚：関節角（相対回転）を遅らせた時刻から取る。骨盤は現在時刻のまま
  for (const [s, delay, kg] of [['R', M.rightLegTimeDelay, M.rightKneeExtensionGain], ['L', M.leftLegTimeDelay, M.leftKneeExtensionGain]]) {
    if (delay !== 0) { const d = R.sample(Math.max(0, e - delay) / k, B); for (const [p, ch] of TREE) if (ch === s + 'FE' || ch === s + 'TI' || ch === s + 'FO' || ch === s + 'TO') relOf[ch] = rel(d, p, ch); }
    if (kg !== 1) { const k0 = rel(start, s + 'FE', s + 'TI'); relOf[s + 'TI'] = k0.clone().slerp(relOf[s + 'TI'], kg); }   // 開始姿勢(座位)からの膝の変化量をkg倍
  }
  // 体幹：胸郭のworld向きの、開始姿勢からの変化量をgain倍。頭・腕・鎖骨は胸郭に対する実測の相対角のまま
  let trx = base.q.TRX.clone();
  if (M.trunkFlexionGain !== 1) { trx = start.q.TRX.clone().slerp(base.q.TRX, M.trunkFlexionGain); }
  out.TRX = trx;
  for (const [p, ch] of TREE) { if (ch === 'TRX') continue; const par = p === 'TRX' ? out.TRX : out[p]; out[ch] = par.clone().multiply(relOf[ch]); }
  return out;
}
