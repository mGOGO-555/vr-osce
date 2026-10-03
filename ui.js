// VR-OSCE PoC  STEP 4: canvasテクスチャによる選択UIパネル
// 文字とボタンをcanvasに描き、板ポリに貼る。当たり判定はレイキャストのuv座標→canvas座標で行う。
import * as THREE from 'three';

const FONT = '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif';
const C = {
  bg: '#f2f3f1', header: '#2f6f8f', text: '#1f2d33', sub: '#55666d',
  btn: '#2f6f8f', btnHover: '#3f8fb5', btnText: '#ffffff',
  back: '#e3e9ec', backHover: '#cfd9de', backText: '#1f2d33',
  disabled: '#b9c3c8', footer: '#e9eef0',
};

export class Panel {
  constructor({ width = 1.0, height = 0.75, px = 1024 } = {}) {
    this.W = px;
    this.H = Math.round(px * height / width);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.mesh.name = 'panel';
    this.page = { title: '', body: '', buttons: [] };
    this.hud = { left: '', right: '' };
    this.buttons = [];   // 描画済みボタンの矩形（当たり判定用）
    this.hover = null;   // ホバー中のボタンid
    this.draw();
  }

  // page = { title, body, buttons: [{id, label, kind?: 'back', disabled?}] }
  setPage(page) { this.page = page; this.hover = null; this.draw(); }

  setHud(hud) {
    if (hud.left === this.hud.left && hud.right === this.hud.right) return;
    this.hud = hud; this.draw();
  }

  // btn は hitTest の戻り値（または null）
  setHover(btn) {
    const id = btn ? btn.id : null;
    if (id === this.hover) return;
    this.hover = id; this.draw();
  }

  // uv（0..1、左下原点）→ ボタン。無効ボタンは対象外。
  hitTest(uv) {
    if (!uv) return null;
    const x = uv.x * this.W, y = (1 - uv.y) * this.H;
    for (const b of this.buttons) {
      if (!b.disabled && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    }
    return null;
  }

  // 日本語向け：1文字ずつ折り返す。戻り値は行の配列（空行は''）
  wrap(text, maxW) {
    const ctx = this.ctx, lines = [];
    for (const para of String(text).split('\n')) {
      if (para === '') { lines.push(''); continue; }
      let cur = '';
      for (const ch of para) {
        if (ctx.measureText(cur + ch).width > maxW && cur) { lines.push(cur); cur = ch; }
        else cur += ch;
      }
      lines.push(cur);
    }
    return lines;
  }

  draw() {
    const { ctx, W, H } = this;
    const pad = 36, footerH = 56, btnH = 70, gap = 14;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

    // ヘッダー
    ctx.fillStyle = C.header; ctx.fillRect(0, 0, W, 96);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.font = `700 36px ${FONT}`;
    ctx.fillText(this.page.title || '', pad, 50, W - pad * 2);

    // 本文
    ctx.fillStyle = C.text; ctx.textBaseline = 'alphabetic';
    const size = this.page.bodySize || 32;                       // 結果画面など、文章が長いページは小さめにできる
    const step = this.page.bodySize ? Math.round(size * 1.5) : 50;
    ctx.font = `500 ${size}px ${FONT}`;
    let y = 96 + 28;
    for (const line of this.wrap(this.page.body || '', W - pad * 2)) {
      if (line === '') { y += 22; continue; }
      y += step - 10; ctx.fillText(line, pad, y); y += 10;
    }

    // ボタン（通常は本文の下に、戻る系は下端に）
    this.buttons = [];
    const normal = (this.page.buttons || []).filter(b => b.kind !== 'back');
    const backs = (this.page.buttons || []).filter(b => b.kind === 'back');
    const cols = normal.length > 5 ? 2 : 1;
    const bw = (W - pad * 2 - gap * (cols - 1)) / cols;
    const top = y + 18;
    normal.forEach((b, i) => {
      const r = Math.floor(i / cols), c = i % cols;
      this.buttons.push({ ...b, x: pad + c * (bw + gap), y: top + r * (btnH + gap), w: bw, h: btnH });
    });
    const backY = H - footerH - 16 - btnH;
    backs.forEach((b, i) => {
      this.buttons.push({ ...b, x: pad + i * (300 + gap), y: backY, w: 300, h: btnH });
    });

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const b of this.buttons) {
      const isBack = b.kind === 'back', hov = this.hover === b.id;
      ctx.fillStyle = b.disabled ? C.disabled : isBack ? (hov ? C.backHover : C.back) : (hov ? C.btnHover : C.btn);
      ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 12); ctx.fill();
      ctx.fillStyle = b.disabled ? '#fff' : isBack ? C.backText : C.btnText;
      ctx.font = `600 32px ${FONT}`;
      ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 1, b.w - 24);
    }

    // フッター（学生ID・残り時間）
    ctx.fillStyle = C.footer; ctx.fillRect(0, H - footerH, W, footerH);
    ctx.fillStyle = C.sub; ctx.font = `500 28px ${FONT}`; ctx.textBaseline = 'middle';
    ctx.textAlign = 'left'; ctx.fillText(this.hud.left || '', pad, H - footerH / 2);
    ctx.textAlign = 'right'; ctx.fillText(this.hud.right || '', W - pad, H - footerH / 2);

    this.texture.needsUpdate = true;
  }
}
