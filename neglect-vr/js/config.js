// 全パラメータをここに集約。値を変えて実験条件を調整できる。
// 座標系: 「机ローカル座標」= 原点は机上面の、キャリブレーション時の頭部直下。
//   +x = ユーザーの右, +y = 上, -z = 正面(身体正中方向)。
//   object_angle = atan2(x, -z) [deg]。負 = 左, 正 = 右。

export const CFG = {
  desk: { w: 1.6, d: 0.9, t: 0.04, frontZ: -0.06, drop: 0.5, color: 0xd9ccb2 },
  box: { cx: 0, cz: -0.42, w: 0.24, d: 0.2, h: 0.1, wall: 0.008, color: 0x8a8f99 },

  // 左右対称の16スロット(片側 4列 x 2行)。物体の割当は実行ごとにシャッフルする。
  layout: { cols: [0.22, 0.33, 0.44, 0.56], rows: [-0.3, -0.56], jitter: 0.015 },

  // 把持パラメータ。左右の手・左右の物体で共通(差をつけない)。
  grab: { radius: 0.075, hoverRadius: 0.1, pinchOn: 0.022, pinchOff: 0.036 },

  // Neglect-like: 身体正中基準で左空間ほどsalienceを「軽度に」低下。透明化・消失はしない。
  neglect: {
    fullAngleDeg: 50, // このangleで抑制が最大に達する(左方向)
    contrastMix: 0.3, // 最大時、机色へ30%だけ近づける(コントラスト低下)
    satDrop: 0.4, // 最大時、彩度を40%低下
    hoverDrop: 0.7, // 最大時、hoverハイライトを70%弱める
    hoverGain: 0.35, // 通常時のhover発光強度
    relief: {
      thresholdDeg: 20, // 左へこれ以上回旋している間、抑制を徐々に解除
      returnDeg: 10, // これより正面寄りに戻ると、ゆっくり抑制が戻る
      rise: 0.15, // 解除速度 [/s](回旋角が大きいほど最大1.5倍)
      decay: 0.03, // 再抑制速度 [/s]
    },
    revealSec: 1.5, // デブリーフ時に通常表示へ戻す時間
    capture: { minInterval: 8, maxInterval: 14, duration: 0.8, intensity: 0.1 }, // 右側への非常に弱いattention capture
  },

  scan: { leftThresholdDeg: 20 }, // 「左方向を探索した」とみなす頭部回旋角
  yawSampleHz: 30,
  ui: { pokeCooldown: 0.7 },
  seedBase: 1000,
};

export const CONDITIONS = {
  normal: { label: 'A. Normal', neglect: false, hemianopia: false, scanCue: false },
  hemianopia: { label: 'B. Hemianopia demonstration', neglect: false, hemianopia: true, scanCue: false },
  neglect: { label: 'C. Neglect-like', neglect: true, hemianopia: false, scanCue: false },
  scanning: { label: 'D. Scanning cue (Neglect-like + cue)', neglect: true, hemianopia: false, scanCue: true },
};
