// VR-OSCE  症例1（右片麻痺）：仰臥位 → 左（非麻痺側）へ寝返り → 側臥位 → 下肢をベッド端から下ろす → 左肘支持 → 左手支持 → 端座位
// すべて patientRoot の局所座標系で計算する（x=患者の左、y=上、z=患者の前方。座位時の向き）。
// 患者の向き（yaw）は動作中ずっと固定。骨盤・体幹の「長軸まわりのroll」と「前額面の側屈」で起き上がる。
//   Q(φ,β) = Rz(β)·Rx(φ)·Rsup   φ: 仰臥位→側臥位（0→90°）、β: 側臥位→端座位（0→90°）。β=90°・φ=90°で単位回転＝座位。
// 区間ごとに速度が0にならないよう、各チャンネルは cubic Hermite。On Elbow は通過イベント。
// 初期値は WebXR 上で見て調整するための値（医学的基準ではない）。
import * as THREE from 'three';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const D2R = Math.PI / 180;

function hermite(keys) {                      // [t, v, 傾き(省略可)]。省略時は単調保存の接線（極値は0）。両端は速度0
  const n = keys.length, tt = keys.map(k => k[0]), vv = keys.map(k => k[1]), m = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    if (keys[i][2] !== undefined) { m[i] = keys[i][2]; continue; }
    const h0 = tt[i] - tt[i - 1], h1 = tt[i + 1] - tt[i], d0 = (vv[i] - vv[i - 1]) / h0, d1 = (vv[i + 1] - vv[i]) / h1;
    if (d0 * d1 > 0) { const w1 = 2 * h1 + h0, w2 = h1 + 2 * h0; m[i] = (w1 + w2) / (w1 / d0 + w2 / d1); }
  }
  return (t) => {
    if (t <= tt[0]) return vv[0];
    if (t >= tt[n - 1]) return vv[n - 1];
    let i = 0; while (i < n - 2 && t > tt[i + 1]) i++;
    const h = tt[i + 1] - tt[i], u = (t - tt[i]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * vv[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * vv[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}
function hermiteV(keys) {                      // [t, Vector3] → t で Vector3
  const f = [0, 1, 2].map(a => hermite(keys.map(k => [k[0], k[1].getComponent(a)])));
  return (t, out = new THREE.Vector3()) => out.set(f[0](t), f[1](t), f[2](t));
}
const ss = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
const ramp = (t, a, b) => hermite([[a, 0, 0], [b, 1, 0]])(t);   // a→b で 0→1（両端速度0）

// ---- 動作定義（初期値）----
export const BEDMOB = {
  T: 6.2,
  // 臨床的に確認できるlandmark（秒）
  ev: { tPreparation: 0.0, tRollStart: 0.5, tSideLying: 2.0, tLegsOff: 2.6, tOnElbow: 3.0, tHandSupport: 3.9, tUpright: 5.4, tStable: 6.2 },
  chestLead: 0.25,        // 上部体幹のrollは骨盤より先行（秒）
  headLead: 0.45,         // 頭部はさらに先行
  chestRollGain: 0.78,    // 側臥位での胸郭の回旋量（骨盤90°に対する比）。下側の肩を床から浮かせる
  pareticLag: 0.0,       // 右（麻痺側）下肢が左より遅れる時間（秒）
  pareticAmp: 0.88,       // 右下肢の動き量（0=完全弛緩, 1=健側と同じ）。完全に弛緩した表現にはしない
  armLag: 0.30,           // 右（麻痺側）上肢の追従遅れ
  contact: { elbow: [2.0, 3.7], hand: [2.0, 5.0] },    // 左肘・左手が床面に固定される区間
  handRelease: [5.0, 5.6],   // 左手がベッドを離れて太ももへ
  rightArmGo: [4.8, 5.8],
  phi: [[0, 0, 0], [0.75, 0, 0], [1.35, 0.95], [2.0, 90 * D2R, 0], [6.2, 90 * D2R, 0]],
  // 骨盤の高さ（ベッド面0.50＋寝姿勢の厚み）と水平位置の自由経路。接触区間は肩の位置から体幹の傾きを解く
  hipsY: [[0, 0.615], [0.6, 0.615], [1.0, 0.66], [1.6, 0.675], [2.0, 0.68], [2.7, 0.675], [3.4, 0.665], [4.4, 0.655], [5.0, 0.64], [5.4, 0.62], [5.8, 0.60], [6.2, 0.60]],
  hipsXZ: [[0, V(0, 0, -0.40)], [0.75, V(0, 0, -0.40)], [2.0, V(-0.10, 0, -0.15)]],
  // 左肘・左手の固定点（局所座標。ベッド上面は y=0.50）
  elbowPt: V(0.50, 0.555, -0.13),
  forearmDir: V(-0.85, 0.0, 0.52),
  // 左の手首：接触前は経路、接触区間は固定点
  wristPre: [[0, V(0.04, 0.545, -0.30)], [0.7, V(0.06, 0.55, -0.28)], [1.4, V(0.24, 0.58, -0.14)]],
  // 肩の経路：肘固定中は 高さ y(t) と、肘→肩の水平方向 ψ(t) で球面上に置く（肘は動かない）。手固定後は 手首からの相対位置
  shoulderY: [[2.0, 0.56], [2.6, 0.66], [3.0, 0.71], [3.7, 0.765]],
  shoulderPsi: [[2.0, V(-0.98, 0, 0.20)], [3.0, V(-0.90, 0, 0.35)], [3.7, V(-0.60, 0, 0.20)]],
  shoulderRel: [[4.4, V(0.17, 0.34, -0.08)], [4.9, V(0.12, 0.40, -0.06)]],   // 手首→肩（手固定中）
  // 下肢：股関節→膝（大腿）、膝→足首（下腿）の方向（局所座標）。左=健側。右は遅れて追従
  thighL: [[0, V(-0.99, 0.08, 0.10)], [0.8, V(-0.99, 0.08, 0.10)], [1.1, V(-0.95, 0.04, 0.25)], [1.4, V(-0.90, -0.02, 0.40)], [2.0, V(-0.62, -0.10, 0.78)], [2.6, V(-0.30, -0.15, 0.94)], [3.3, V(0.05, -0.12, 0.99)]],
  shankL: [[0, V(-0.99, 0.12, 0.06)], [0.8, V(-0.99, 0.12, 0.06)], [1.1, V(-0.97, 0.12, 0.08)], [1.4, V(-0.97, 0.15, 0.10)], [2.0, V(-0.80, 0.00, 0.10)], [2.35, V(-0.70, -0.10, 0.70)], [2.6, V(-0.55, -0.75, 0.20)], [3.3, V(-0.05, -0.98, 0.15)]],
  footFree: [2.3, 3.4],   // 足が体幹に追従→重力で下がる（足底が床へ）
  // 右腕（麻痺側）：胸郭座標系での手首の目標（腹部の上）
  rightArmChest: V(-0.10, -0.10, 0.17),
};

export function createBedMobility(C) {
  const { root, B, arm } = C, P = BEDMOB, T = P.T, ev = P.ev;
  const Qn = () => new THREE.Quaternion();
  const Rx = (a) => Qn().setFromAxisAngle(V(1, 0, 0), a), Rz = (a) => Qn().setFromAxisAngle(V(0, 0, 1), a);
  const Rsup = Qn().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(1, 0, 0), V(0, 1, 0)));   // x→z, y→x, z→y
  const Qlie = (phi, beta) => Rz(beta).multiply(Rx(phi)).multiply(Rsup);
  const fPhi = hermite(P.phi);
  const gainC = (t) => P.chestRollGain + (1 - P.chestRollGain) * ramp(t, 3.0, 5.0);   // 側臥位では胸郭の回旋を抑え、座位へ向かって1へ
  let gTab = [];                                   // 胸郭β(t)の解（接触区間では肩・骨盤高さの拘束から逐次解く）
  const gAt = (t) => {
    if (!gTab.length || t <= gTab[0][0]) return 0;
    const n = gTab.length; if (t >= gTab[n - 1][0]) return gTab[n - 1][1];
    let i = 0; while (i < n - 2 && t > gTab[i + 1][0]) i++;
    const u = (t - gTab[i][0]) / (gTab[i + 1][0] - gTab[i][0]); return gTab[i][1] * (1 - u) + gTab[i + 1][1] * u;
  };
  const phiP = (t) => fPhi(t), betaP = (t) => gAt(t - P.chestLead);
  const phiC = (t) => gainC(t) * fPhi(Math.min(T, t + P.chestLead)), betaC = (t) => gAt(t);
  const phiH = (t) => fPhi(Math.min(T, t + P.headLead)), betaH = (t) => gAt(t + P.headLead);
  const rQi = () => root.getWorldQuaternion(Qn()).invert();
  const Lq = (o) => o.getWorldQuaternion(Qn()).premultiply(rQi());
  const Lp = (o) => root.worldToLocal(o.getWorldPosition(V(0, 0, 0)));
  const names = ['hips', 'spine', 'chest', 'neck', 'head', 'clav_L', 'uarm_L', 'larm_L', 'hand_L', 'clav_R', 'uarm_R', 'larm_R', 'hand_R',
    'uleg_L', 'lleg_L', 'foot_L', 'uleg_R', 'lleg_R', 'foot_R'];
  const captureState = () => names.map(n => [B[n].position.clone(), B[n].quaternion.clone()]);
  const applyState = (st) => names.forEach((n, i) => { B[n].position.copy(st[i][0]); B[n].quaternion.copy(st[i][1]); });
  const blendStates = (a, b, w) => a.map((s, i) => [s[0].clone().lerp(b[i][0], w), s[1].clone().slerp(b[i][1], w)]);

  // ---- STS initial pose（目標）を一度読み取る ----
  C.applySts0();
  root.updateMatrixWorld(true);
  const STS0 = captureState();
  const hipsSts = B.hips.position.clone();
  const SSts = { L: Lp(B.uarm_L), R: Lp(B.uarm_R) }, WSts = { L: Lp(B.hand_L), R: Lp(B.hand_R) };
  const thighSts = {}, shankSts = {};
  for (const [s, n] of [['L', 'left'], ['R', 'right']]) {
    const qt = B['uleg_' + s].quaternion.clone(), qs = qt.clone().multiply(B['lleg_' + s].quaternion);
    thighSts[s] = V(0, -1, 0).applyQuaternion(qt); shankSts[s] = V(0, -1, 0).applyQuaternion(qs);
  }
  const rest = {   // レスト姿勢の骨の方向（腕のIK用）
    L: arm.L, R: arm.R,
  };
  // 床面（局所座標）：ワールドのベッド箱を局所へ
  root.updateMatrixWorld(true);
  const bedW = C.bed, bedL = { min: V(1e9, 1e9, 1e9), max: V(-1e9, -1e9, -1e9) };
  for (const x of [bedW.x0, bedW.x1]) for (const z of [bedW.z0, bedW.z1]) for (const y of [bedW.top - 0.14, bedW.top]) {
    const p = root.worldToLocal(V(x, y, z)); bedL.min.min(p); bedL.max.max(p);
  }
  const TOP = bedL.max.y;   // ベッド上面（局所y）

  const Lu = arm.L.Lu, Lf = arm.L.Lf;
  const Pe = P.elbowPt.clone();
  const Ph = Pe.clone().addScaledVector(P.forearmDir.clone().normalize(), Lf);
  // 左の手首の経路（接触前→固定点）
  const wristKeys = [...P.wristPre, [ev.tSideLying, Ph.clone()]];
  const fWristPre = hermiteV(wristKeys);
  const fSy = hermite(P.shoulderY), fPsi = hermiteV(P.shoulderPsi.map(k => [k[0], k[1].clone().normalize()]));
  const fHy = hermite(P.hipsY), fHxz = hermiteV(P.hipsXZ);
  const fThighL = hermiteV(P.thighL.concat([[T, thighSts.L]]));
  const fShankL = hermiteV(P.shankL.concat([[T, shankSts.L]]));

  // 下肢方向：右は左を遅らせ、動き量を下げる（完全に弛緩した表現にしない）
  const thighDir = (side, t) => {
    if (side === 'L') return fThighL(t).normalize();
    const d = fThighL(t - P.pareticLag), r = fThighL(Math.max(0, Math.min(t, 0.9)));
    const v = d.clone().lerp(r, 1 - P.pareticAmp).normalize();
    const f = ramp(t, T - 1.4, T);   // 終端はSTS初期姿勢へ
    return v.lerp(thighSts.R, f).normalize();
  };
  const shankDir = (side, t) => {
    if (side === 'L') return fShankL(t).normalize();
    const d = fShankL(t - P.pareticLag), r = fShankL(Math.max(0, Math.min(t, 0.9)));
    const v = d.clone().lerp(r, 1 - P.pareticAmp).normalize();
    const f = ramp(t, T - 1.4, T);
    return v.lerp(shankSts.R, f).normalize();
  };
  const dirQ = (d) => Qn().setFromUnitVectors(V(0, -1, 0), d);

  // 肩の経路（接触区間）：肘固定中は球面 |S-Pe|=Lu 上、手固定後は 手首＋相対位置
  const Selb = (t) => {
    const y = fSy(Math.min(t, 3.7)), dy = y - Pe.y, h = Math.sqrt(Math.max(0, Lu * Lu - dy * dy));
    const psi = fPsi(Math.min(t, 3.7)).normalize();
    return V(Pe.x + psi.x * h, y, Pe.z + psi.z * h);
  };
  const fRel = hermiteV([[3.7, Selb(3.7).sub(Ph)], P.shoulderRel[0], P.shoulderRel[1], [5.5, SSts.L.clone().sub(Ph)], [T, SSts.L.clone().sub(Ph)]]);
  function shoulderTarget(t) {
    const wp = 1 - ramp(t, P.contact.elbow[1] - 0.2, P.contact.elbow[1] + 0.6);   // 肘接触の重み
    if (t >= 3.7) return { S: fRel(t).add(Ph), wp: 0 };
    const Se = Selb(t), Sh = fRel(Math.max(t, 3.7)).add(Ph);
    return { S: Se.lerp(Sh, 1 - wp), wp };
  }

  function ik(S, Tp, poleDir, df_out) {          // 2リンクIK（局所座標）。戻り値: 肘位置
    const L1 = arm.L.Lu, L2 = arm.L.Lf;
    const toT = Tp.clone().sub(S); const d = Math.min(toT.length(), (L1 + L2) * 0.999); const e = toT.normalize();
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const pole = poleDir.clone(); pole.addScaledVector(e, -pole.dot(e)); if (pole.lengthSq() < 1e-9) pole.set(0, -1, 0); pole.normalize();
    const E = S.clone().addScaledVector(e, a).addScaledVector(pole, hh);
    df_out.copy(S.clone().addScaledVector(e, d).sub(E).normalize());
    return E;
  }
  function aimLocal(bone, parentQ, d0, dLocal, roll) {
    const dl = dLocal.clone().applyQuaternion(parentQ.clone().invert());
    bone.quaternion.setFromUnitVectors(d0, dl);
    if (roll) bone.quaternion.premultiply(Qn().setFromAxisAngle(dl, roll));
  }
  function placeArm(sfx, S, Tp, poleDir, handDir, palmWant) {
    const A = arm[sfx], U = B['uarm_' + sfx], F = B['larm_' + sfx], H = B['hand_' + sfx];
    const df = V(0, 0, 0), E = ik(S, Tp, poleDir, df);
    const du = E.clone().sub(S).normalize();
    aimLocal(U, Lq(B['clav_' + sfx]), A.d0u, du, 0); U.updateMatrixWorld(true);
    aimLocal(F, Lq(U), A.d0f, df, 0); F.updateMatrixWorld(true);
    const dh = (handDir ? handDir.clone().lerp(df, 0) : df).clone().normalize();
    const Qf = Lq(F);
    aimLocal(H, Qf, A.d0f, dh, 0); H.updateMatrixWorld(true);
    const n = A.palm0.clone().applyQuaternion(Lq(H));
    const pn = n.addScaledVector(dh, -n.dot(dh)).normalize(), pw = palmWant.clone().addScaledVector(dh, -palmWant.dot(dh)).normalize();
    const roll = Math.atan2(dh.dot(new THREE.Vector3().crossVectors(pn, pw)), pn.dot(pw));
    aimLocal(H, Qf, A.d0f, dh, roll);
    return E;
  }

  // 現在の骨盤・体幹の回転で、骨盤原点（hips=0）から見た肩の位置
  function shoulderOffset(sfx) {
    B.hips.position.set(0, 0, 0); root.updateMatrixWorld(true);
    return Lp(B['uarm_' + sfx]);
  }

  function setTrunk(Qp, Qc, Qh) {
    B.hips.quaternion.copy(Qp);
    const relC = Qp.clone().invert().multiply(Qc);
    const sp = Qn().slerp(relC, 0.45); B.spine.quaternion.copy(sp);
    B.chest.quaternion.copy(sp.clone().invert().multiply(relC));
    const relH = Qc.clone().invert().multiply(Qh);
    const nk = Qn().slerp(relH, 0.5); B.neck.quaternion.copy(nk);
    B.head.quaternion.copy(nk.clone().invert().multiply(relH));
  }
  // 接触区間：肩ターゲットと骨盤高さから胸郭βを逐次解く（二分法）
  function solveBeta() {
    gTab = []; const t0 = 1.8, t1 = 5.95, dt = 0.05;
    for (let t = t0; t <= t1 + 1e-9; t += dt) {
      const S = shoulderTarget(t).S, hy = fHy(t);
      const pp = fPhi(t), bp = gAt(t - P.chestLead), pc = gainC(t) * fPhi(Math.min(T, t + P.chestLead));
      const f = (x) => { setTrunk(Qlie(pp, bp), Qlie(pc, x), Qlie(pp, bp)); return S.y - shoulderOffset('L').y - hy; };
      let lo = 0, hi = Math.PI / 2;
      if (f(lo) < 0) hi = lo; else if (f(hi) > 0) lo = hi;
      for (let k = 0; k < 40 && hi > lo; k++) { const m = (lo + hi) / 2; if (f(m) > 0) lo = m; else hi = m; }
      const x = (lo + hi) / 2;
      gTab.push([t, Math.max(x, gTab.length ? gTab[gTab.length - 1][1] : 0)]);
      if (gTab.length === 1) gTab.unshift([1.4, 0]);
    }
    for (let i = gTab.length - 1; i >= 0 && gTab[i][0] > 5.6; i--) gTab[i][1] = Math.PI / 2; gTab.push([T + 1, Math.PI / 2]);
  }

  let lastInfo = null;
  const ARMW = [1.3, 2.0];   // この区間は、左腕の骨の向きを両端のIK解の間で補間（手首と肩が近く、IKの極が不安定になるため）
  const armNames = ['uarm_L', 'larm_L', 'hand_L'];
  function bedPose(t) {
    t = Math.max(0, Math.min(T, t));
    if (t > ARMW[0] && t < ARMW[1]) {
      const qs = ARMW.map(tt => { bedPoseCore(tt); return armNames.map(n => B[n].quaternion.clone()); });
      const info = bedPoseCore(t), w = ss((t - ARMW[0]) / (ARMW[1] - ARMW[0]));
      armNames.forEach((n, i) => B[n].quaternion.copy(qs[0][i].clone().slerp(qs[1][i], w)));
      root.updateMatrixWorld(true);
      return info;
    }
    return bedPoseCore(t);
  }
  function bedPoseCore(t) {
    if (!gTab.length) solveBeta();
    const Qp = Qlie(phiP(t), betaP(t)), Qc = Qlie(phiC(t), betaC(t)), Qh = Qlie(phiH(t), betaH(t));
    setTrunk(Qp, Qc, Qh);
    // 下肢（局所座標の方向）
    for (const [s, n] of [['L', 'left'], ['R', 'right']]) {
      const sgn = s === 'L' ? 1 : -1, dly = s === 'L' ? 0 : P.pareticLag;
      B['uleg_' + s].position.set(sgn * C.HIP_X, 0, 0);
      const Qt = dirQ(thighDir(s, t)), Qs = dirQ(shankDir(s, t));
      B['uleg_' + s].quaternion.copy(Qp.clone().invert().multiply(Qt));
      B['lleg_' + s].quaternion.copy(Qt.clone().invert().multiply(Qs));
      const wf = ramp(t - dly, P.footFree[0], P.footFree[1]);
      const Qfw = Qp.clone().slerp(Qn(), wf);
      B['foot_' + s].quaternion.copy(Qs.clone().invert().multiply(Qfw));
    }
    // 骨盤位置：接触区間は肩の位置から逆算（肘・手が滑らない）、それ以前は自由経路
    const vshL = shoulderOffset('L');
    const wA = ramp(t, 1.4, 2.0);
    const { S: Starget, wp } = shoulderTarget(t);
    const fh = fHxz(t), hipsFree = V(fh.x, fHy(t), fh.z);
    const hipsD = Starget.clone().sub(vshL);
    B.hips.position.copy(hipsFree.lerp(hipsD, wA));
    root.updateMatrixWorld(true);
    // 左腕：肘・手を床面に固定
    const rel = ramp(t, P.handRelease[0], P.handRelease[1]);
    const Wpre = t < ev.tSideLying ? fWristPre(t) : Ph.clone();
    const WL = Wpre.lerp(WSts.L, rel);
    const SL = Lp(B.uarm_L);
    const poleL = Pe.clone().sub(SL).setY(0).multiplyScalar(ramp(t, 1.3, 2.0)).add(V(0, 0.12, 0).multiplyScalar(1 - ramp(t, 1.3, 2.0))).add(V(0, ramp(t, 1.3, 2.0) * (Pe.y - SL.y), 0)); const eL = WL.clone().sub(SL).normalize(); poleL.addScaledVector(eL, -poleL.dot(eL));
    const flat = P.forearmDir.clone(); flat.y = 0;
    placeArm('L', SL, WL, poleL.lengthSq() > 1e-8 ? poleL : V(0, -1, 0), flat.lerp(V(0, 0, 1), rel).normalize(), V(0, -1, 0));
    // 右腕（麻痺側）：胸郭の前（腹部の上）→ 遅れて太ももへ。弛緩させ切らず肘を軽く屈曲
    const SR = Lp(B.uarm_R);
    const cm = B.chest.matrixWorld.clone();
    const Wc = root.worldToLocal(P.rightArmChest.clone().add(V(0, 0, 0)).applyMatrix4(cm));
    const rr = ramp(t, P.rightArmGo[0], P.rightArmGo[1]);
    const WR = Wc.lerp(WSts.R, rr);
    const chestQ = Lq(B.chest);
    const poleR = V(-0.45, -0.35, -0.8).applyQuaternion(chestQ);
    placeArm('R', SR, WR, poleR.lerp(V(-0.45, -0.35, -0.8), rr), null, V(0, -1, 0).lerp(V(0.4, -0.6, 0).applyQuaternion(chestQ), 1 - rr).normalize());
    root.updateMatrixWorld(true);
    // 終端：最後の0.25秒だけ小さく位置合わせ。t=T ではSTS初期姿勢そのもの
    const tA = T - 0.25;
    if (t >= T) { C.applySts0(); }
    else if (t > tA) {
      const cur = captureState(); C.applySts0(); const tgt = captureState();
      applyState(blendStates(cur, tgt, ss((t - tA) / 0.25)));
    }
    root.updateMatrixWorld(true);
    lastInfo = { t, wp, wA };
    return lastInfo;
  }

  // ===== 検証（貫通・接触誤差・STS初期姿勢との差）=====
  const meshOf = () => { let m = null; body_traverse(m0 => { if (m0.isSkinnedMesh) m = m0; }); return m; };
  const body_traverse = (fn) => C.bodyScene.traverse(fn);
  function penetration(byBone) {
    const mesh = meshOf(); mesh.skeleton.update();
    const v = V(0, 0, 0); let worst = 0;
    const pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
    const bn = mesh.skeleton.bones.map(x => x.name);
    for (let i = 0; i < pos.count; i += 2) {
      mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld);   // ワールド座標
      if (v.x < bedW.x0 + 0.02 || v.x > bedW.x1 - 0.02 || v.z < bedW.z0 + 0.03 || v.z > bedW.z1 - 0.005) continue;   // ベッドの上にある頂点だけ
      const d = bedW.top - v.y;
      if (d > worst) worst = d;
      if (byBone && d > 0) { let k = 0, bw = -1; for (let j = 0; j < 4; j++) if (sw.getComponent(i, j) > bw) { bw = sw.getComponent(i, j); k = si.getComponent(i, j); } const n = bn[k]; byBone[n] = Math.max(byBone[n] || 0, d); }
    }
    return worst;
  }
  function headboardGap() {   // 頭がヘッドボード(z=bed.z0)にぶつからないか
    const mesh = meshOf(); let zmin = 1e9; const v = V(0, 0, 0);
    for (let i = 0; i < mesh.geometry.attributes.position.count; i += 4) { mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld); if (v.y > 0.45) zmin = Math.min(zmin, v.z); }
    return zmin - bedW.z0;
  }
  function validate() {
    const rows = {}; const dt = 0.05; const N = Math.round(T / dt);
    const byBone = {}; let eMax = 0, hMax = 0, pen = 0, penT = 0, lowLeg = { L: null, R: null }, stsDiff = 0, minGap = 1e9;
    const edgeZ = bedL.max.z;
    for (let i = 0; i <= N; i++) {
      const t = i * dt; bedPose(t);
      if (t >= P.contact.elbow[0] && t <= P.contact.elbow[1] - 0.2) eMax = Math.max(eMax, Lp(B.larm_L).distanceTo(Pe));
      if (t >= P.contact.hand[0] && t <= P.contact.hand[1] - 0.05) hMax = Math.max(hMax, Lp(B.hand_L).distanceTo(Ph));
      const bb = {}; const p = penetration(bb); if (p > pen) { pen = p; penT = t; }
      for (const [k, d] of Object.entries(bb)) if (d > 0.005 && (!byBone[k] || d > byBone[k][0])) byBone[k] = [d, t];
      minGap = Math.min(minGap, headboardGap());
      for (const s of ['L', 'R']) if (lowLeg[s] === null && t > 1.0 && Lp(B['foot_' + s]).y < TOP - 0.01) lowLeg[s] = t;   // 足首がベッド面より下＝下肢がベッド端を越えた
    }
    // STS initial pose との差（t=T）
    bedPose(T); const a = captureState(); C.applySts0(); const b = captureState();
    for (let i = 0; i < a.length; i++) { { const q = a[i][1].dot(b[i][1]) < 0 ? -1 : 1; stsDiff = Math.max(stsDiff, a[i][0].distanceTo(b[i][0]), Math.abs(a[i][1].x - q * b[i][1].x), Math.abs(a[i][1].y - q * b[i][1].y), Math.abs(a[i][1].z - q * b[i][1].z), Math.abs(a[i][1].w - q * b[i][1].w)); } }
    // phi/beta landmark（測定）
    const meas = (f, thr) => { for (let t = 0; t <= T; t += 0.01) if (f(t) >= thr) return Math.round(t * 100) / 100; return null; };
    const r2 = (v) => Math.round(v * 100) / 100;
    return {
      beta_chest_deg: gTab.filter((_, i) => i % 4 === 0).map(a => `${r2(a[0])}:${Math.round(a[1] / D2R)}`).join(' '),
      total_duration_s: T,
      tRollStart: meas((t) => phiC(t), 1 * D2R), tRollStart_pelvis: meas((t) => phiP(t), 1 * D2R),
      chest_lead_over_pelvis_s: r2(meas((t) => phiP(t), 45 * D2R) - meas((t) => phiC(t) / P.chestRollGain, 45 * D2R)),
      tSideLying: meas((t) => phiP(t), 88 * D2R), tLegsOff_left: lowLeg.L ? r2(lowLeg.L) : null, tLegsOff_right: lowLeg.R ? r2(lowLeg.R) : null,
      paretic_leg_lag_s: lowLeg.L && lowLeg.R ? r2(lowLeg.R - lowLeg.L) : null,
      tOnElbow: ev.tOnElbow, tHandSupport: ev.tHandSupport, tUpright: meas((t) => betaP(t), 88 * D2R), tStable: T,
      elbow_contact_error_mm: Math.round(eMax * 1000 * 10) / 10, hand_contact_error_mm: Math.round(hMax * 1000 * 10) / 10,
      max_bed_penetration_mm: Math.round(pen * 1000 * 10) / 10, max_penetration_at_s: r2(penT),
      head_to_headboard_gap_mm: Math.round(minGap * 1000),
      diff_from_STS_initial_pose_at_T: stsDiff,
      penetration_by_bone_mm: Object.fromEntries(Object.entries(byBone).map(([k, [d, t]]) => [k, `${Math.round(d * 1000)}mm @${r2(t)}s`])),
    };
  }
  return { T, ev, pose: bedPose, validate, dbg: () => gTab.map(a => [a[0], Math.round(a[1] / D2R)]), Pe, Ph, TOP, bedL };
}
