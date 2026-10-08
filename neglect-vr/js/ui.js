import * as THREE from 'three';
import { CFG } from './config.js';

const FONT = '"Noto Sans JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > maxW && line) { out.push(line); line = ch; }
      else line += ch;
    }
    out.push(line);
  }
  return out;
}

/** canvasテクスチャのパネル。指先(または PCではクリック)で押せるボタンを持つ。 */
export class Panel {
  constructor({ width = 0.9, cw = 1024, ch = 640 }) {
    this.cw = cw; this.ch = ch;
    this.w = width; this.h = (width * ch) / cw;
    this.canvas = document.createElement('canvas');
    this.canvas.width = cw; this.canvas.height = ch;
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.w, this.h),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: false }),
    );
    this.mesh.visible = false;
    this.mesh.renderOrder = 500;
    this.buttons = [];
    this.hover = null;
    this.content = null;
    this.armed = new Map(); // hand id -> bool
  }

  show(content) { this.content = content; this.mesh.visible = true; this.draw(); }
  hide() { this.mesh.visible = false; }

  /** content: {title, lines[], table:{head,rows}, buttons:[{id,label,primary,disabled}], footer, small} */
  draw() {
    const c = this.content; if (!c) return;
    const { ctx, cw, ch } = this;
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#10151d';
    roundRect(ctx, 0, 0, cw, ch, 28); ctx.fill();
    ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 4; roundRect(ctx, 2, 2, cw - 4, ch - 4, 28); ctx.stroke();
    const pad = 36;
    let y = pad;
    const fs = c.small ? 30 : 44;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'top';
    if (c.title) {
      ctx.font = `bold ${fs}px ${FONT}`;
      for (const l of wrap(ctx, c.title, cw - pad * 2)) { ctx.fillText(l, pad, y); y += fs * 1.3; }
      y += 8;
    }
    const bs = c.small ? 24 : 30;
    ctx.font = `${bs}px ${FONT}`;
    ctx.fillStyle = '#e6edf7';
    for (const line of c.lines || []) {
      for (const l of wrap(ctx, line, cw - pad * 2)) { ctx.fillText(l, pad, y); y += bs * 1.45; }
      y += bs * 0.25;
    }
    if (c.table) {
      const cols = c.table.head.length;
      const colW = [0.4, ...Array(cols - 1).fill(0.6 / (cols - 1))].map((f) => f * (cw - pad * 2));
      ctx.font = `bold ${bs}px ${FONT}`;
      const drawRow = (cells, color, bold) => {
        ctx.fillStyle = color; ctx.font = `${bold ? 'bold ' : ''}${bs}px ${FONT}`;
        let x = pad;
        cells.forEach((t, i) => { ctx.fillText(String(t), x, y); x += colW[i]; });
        y += bs * 1.5;
      };
      drawRow(c.table.head, '#93c5fd', true);
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(pad, y - 6); ctx.lineTo(cw - pad, y - 6); ctx.stroke();
      for (const r of c.table.rows) drawRow(r, '#f1f5f9', false);
    }
    if (c.footer) {
      ctx.font = `${c.small ? 18 : 22}px ${FONT}`;
      ctx.fillStyle = '#9aa7b8';
      const lines = wrap(ctx, c.footer, cw - pad * 2);
      let fy = ch - pad - (c.buttons?.length ? (c.small ? 96 : 130) : 0) - lines.length * 30;
      for (const l of lines) { ctx.fillText(l, pad, fy); fy += 30; }
    }
    // ボタン
    this.buttons = [];
    const bl = c.buttons || [];
    if (bl.length) {
      const bh = c.small ? 72 : 96;
      const gap = 24;
      const bw = (cw - pad * 2 - gap * (bl.length - 1)) / bl.length;
      const by = ch - pad - bh;
      bl.forEach((b, i) => {
        const bx = pad + i * (bw + gap);
        this.buttons.push({ id: b.id, x: bx, y: by, w: bw, h: bh, disabled: !!b.disabled });
        const hov = this.hover === b.id && !b.disabled;
        ctx.fillStyle = b.disabled ? '#334155' : hov ? '#60a5fa' : b.primary ? '#2563eb' : '#1e3a8a';
        roundRect(ctx, bx, by, bw, bh, 18); ctx.fill();
        ctx.fillStyle = b.disabled ? '#94a3b8' : '#ffffff';
        ctx.font = `bold ${c.small ? 30 : 32}px ${FONT}`;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.fillText(b.label, bx + bw / 2, by + bh / 2 + 2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      });
    }
    this.tex.needsUpdate = true;
  }

  buttonAtLocal(x, y) { // パネルローカル座標(m) → ボタン
    const px = (x / this.w + 0.5) * this.cw;
    const py = (0.5 - y / this.h) * this.ch;
    return this.buttons.find((b) => !b.disabled && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) || null;
  }

  setHover(id) {
    if (this.hover !== id) { this.hover = id; this.draw(); }
  }
}

export class UI {
  constructor(scene, camera) {
    this.camera = camera;
    this.main = new Panel({ width: 0.78, cw: 1024, ch: 820 });
    this.task = new Panel({ width: 0.46, cw: 768, ch: 300 });
    this.panels = [this.main, this.task];
    for (const p of this.panels) scene.add(p.mesh);
    this.onPress = () => {};
    this.cool = 0;
    this._v = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
  }

  /** 頭部の向き(ヨーのみ)の正面 dist[m]、高さ yOffset に、ユーザーの方を向けて置く。 */
  placeFacing(panel, head, yawL, dist, y, tiltDeg = 0) {
    const fx = -Math.sin(yawL), fz = -Math.cos(yawL);
    panel.mesh.position.set(head.x + fx * dist, y, head.z + fz * dist);
    panel.mesh.rotation.set(0, yawL, 0);
    panel.mesh.rotateX((tiltDeg * Math.PI) / 180);
  }

  update(dt, hands) {
    this.cool = Math.max(0, this.cool - dt);
    for (const p of this.panels) {
      if (!p.mesh.visible) continue;
      let hov = null;
      for (const h of hands) {
        if (!h.tracked) continue;
        this._v.copy(h.tip);
        p.mesh.worldToLocal(this._v);
        const inside = Math.abs(this._v.x) < p.w / 2 && Math.abs(this._v.y) < p.h / 2;
        const b = inside ? p.buttonAtLocal(this._v.x, this._v.y) : null;
        const z = this._v.z;
        if (b && z > -0.05 && z < 0.08) {
          hov = b.id;
          const armed = p.armed.get(h.id) ?? false;
          if (z > 0.03) p.armed.set(h.id, true);
          else if (z < 0.008 && armed && this.cool <= 0) {
            p.armed.set(h.id, false);
            this.cool = CFG.ui.pokeCooldown;
            this.onPress(b.id);
          }
        } else {
          p.armed.set(h.id, false);
        }
      }
      p.setHover(hov);
    }
  }

  /** PCプレビュー用: NDCクリックでUIボタンを押す。押したらtrue。 */
  clickNdc(ndc) {
    this._ray.setFromCamera(ndc, this.camera);
    for (const p of this.panels) {
      if (!p.mesh.visible) continue;
      const hit = this._ray.intersectObject(p.mesh)[0];
      if (!hit) continue;
      const l = p.mesh.worldToLocal(hit.point.clone());
      const b = p.buttonAtLocal(l.x, l.y);
      if (b) { this.onPress(b.id); return true; }
    }
    return false;
  }
}
