// Neglect-like モデルの純関数群(THREE非依存 → Nodeでテスト可能)。
// 重要: ここでは「見えなくする」処理は一切行わない。salience(コントラスト・彩度・hover強度)を軽度に下げるだけ。

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (t) => t * t * (3 - 2 * t);

/** 身体正中基準の角度(負=左)から抑制の基本強度 0..1。右・正中は常に0。 */
export function baseSuppression(angleDeg, cfg) {
  if (angleDeg >= 0) return 0;
  return smoothstep(clamp(-angleDeg / cfg.fullAngleDeg, 0, 1));
}

/** 頭部を左へ回旋している間、解除度reliefを徐々に上げる。head_yaw: 負=左。 */
export function stepRelief(relief, headYawDeg, dt, cfg) {
  const left = Math.max(0, -headYawDeg);
  const r = cfg.relief;
  if (left >= r.thresholdDeg) {
    const gain = 1 + 0.5 * clamp((left - r.thresholdDeg) / 30, 0, 1);
    relief += r.rise * gain * dt;
  } else if (left <= r.returnDeg) {
    relief -= r.decay * dt;
  }
  return clamp(relief, 0, 1);
}

/** 実効抑制 0..1。neglectScale はデブリーフ時に1→0へ下げて通常表示へ戻す。 */
export function effectiveSuppression(angleDeg, relief, neglectScale, cfg) {
  return baseSuppression(angleDeg, cfg) * (1 - relief) * neglectScale;
}

/** 実効抑制から見た目パラメータ。opacityは含まない(透明化しないことをAPIレベルで保証)。 */
export function visualParams(eff, cfg) {
  return {
    mix: cfg.contrastMix * eff, // 机色へ寄せる割合(コントラスト低下)
    satScale: 1 - cfg.satDrop * eff,
    hoverScale: 1 - cfg.hoverDrop * eff,
  };
}

export function nextCaptureDelay(cfg, rand) {
  const c = cfg.capture;
  return c.minInterval + (c.maxInterval - c.minInterval) * rand();
}

/** attention captureの対象は「右側で未回収」の物体のみ。 */
export function pickCaptureTarget(objects, rand) {
  const c = objects.filter((o) => o.side === 'right' && !o.inBox && !o.held);
  return c.length ? c[Math.floor(rand() * c.length)] : null;
}

export function captureGlow(t, cfg) {
  const c = cfg.capture;
  if (t < 0 || t > c.duration) return 0;
  return c.intensity * Math.sin((Math.PI * t) / c.duration);
}
