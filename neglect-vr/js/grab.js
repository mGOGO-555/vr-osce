import * as THREE from 'three';
import { CFG } from './config.js';

// 直接つかむ(ピンチ)。左右の手・左右の物体で同一の半径・同一ロジック(差をつけない)。
// 物体の位置は机ローカル座標で扱う。
export class GrabManager {
  constructor(desk, objectSet, { onGrab, onRelease }) {
    this.desk = desk;
    this.set = objectSet;
    this.onGrab = onGrab;
    this.onRelease = onRelease;
    this._p = new THREE.Vector3();
  }

  update(hands, active) {
    for (const o of this.set.items) o.hoverTarget = 0;
    for (const h of hands) {
      if (!active) {
        if (h.holding) this._release(h);
        continue;
      }
      if (h.holding && (h.pinchEnded || !h.tracked)) this._release(h);
      if (!h.tracked) continue;
      this._p.copy(h.pinchPos);
      this.desk.worldToLocal(this._p);
      if (h.holding) {
        h.holding.pos.copy(this._p).add(h.holding.offset);
        continue;
      }
      // hover(把持前ハイライト)と把持対象の探索: 最近傍の未把持物体
      let best = null;
      let bd = Infinity;
      for (const o of this.set.items) {
        if (o.held) continue;
        const d = o.pos.distanceTo(this._p);
        if (d < bd) { bd = d; best = o; }
      }
      if (best && bd < CFG.grab.hoverRadius) best.hoverTarget = 1;
      if (h.pinchStarted && best && bd < CFG.grab.radius) {
        best.held = h;
        best.falling = false;
        best.inBox = false;
        best.offset = best.pos.clone().sub(this._p);
        h.holding = best;
        this.onGrab(best, h);
      }
    }
  }

  _release(h) {
    const o = h.holding;
    h.holding = null;
    if (!o) return;
    this.set.release(o);
    this.onRelease(o, h);
  }
}
