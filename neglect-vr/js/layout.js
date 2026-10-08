// 物体配置(純関数)。左右各8スロットは常に対称。物体の種類の割当だけを実行ごとにシャッフルする。
export const OBJECT_TYPES = [
  { type: 'apple', ja: 'リンゴ', color: 0xe02020 },
  { type: 'apple', ja: 'リンゴ', color: 0x5cb82e },
  { type: 'cup', ja: 'コップ', color: 0x1f6fe0 },
  { type: 'cup', ja: 'コップ', color: 0xf2c200 },
  { type: 'ball', ja: 'ボール', color: 0xff7a00 },
  { type: 'ball', ja: 'ボール', color: 0x8a2be2 },
  { type: 'pen', ja: 'ペン', color: 0x0aa66e },
  { type: 'pen', ja: 'ペン', color: 0xd81b60 },
  { type: 'spoon', ja: 'スプーン', color: 0x00a3b4 },
  { type: 'spoon', ja: 'スプーン', color: 0xc0392b },
  { type: 'card', ja: 'カード', color: 0x6c3fc9 },
  { type: 'card', ja: 'カード', color: 0x27ae60 },
  { type: 'bottle', ja: 'ボトル', color: 0x16a085 },
  { type: 'bottle', ja: 'ボトル', color: 0xe67e22 },
  { type: 'eraser', ja: '消しゴム', color: 0xff5fa2 },
  { type: 'eraser', ja: '消しゴム', color: 0x2c7be5 },
];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function angleDegOf(x, z) {
  return (Math.atan2(x, -z) * 180) / Math.PI; // 負=左, 正=右
}

/** 16個の {id, side, slot, x, z, angle, type, ja, color} を返す。 */
export function makeLayout(seed, layoutCfg) {
  const rand = mulberry32(seed);
  const slots = [];
  for (const side of ['left', 'right']) {
    const sgn = side === 'left' ? -1 : 1;
    for (const z of layoutCfg.rows) {
      for (const c of layoutCfg.cols) {
        const jx = (rand() * 2 - 1) * layoutCfg.jitter;
        const jz = (rand() * 2 - 1) * layoutCfg.jitter;
        slots.push({ side, x: sgn * c + jx, z: z + jz });
      }
    }
  }
  const specs = OBJECT_TYPES.slice();
  for (let i = specs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [specs[i], specs[j]] = [specs[j], specs[i]];
  }
  return slots.map((s, i) => ({
    id: `obj${String(i + 1).padStart(2, '0')}`,
    side: s.side,
    slot: i,
    x: s.x,
    z: s.z,
    angle: angleDegOf(s.x, s.z),
    ...specs[i],
  }));
}
