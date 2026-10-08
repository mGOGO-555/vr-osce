import * as THREE from 'three';
import { CFG } from './config.js';
import { effectiveSuppression, visualParams, captureGlow } from './salience.js';

const DESK_COLOR = new THREE.Color(CFG.desk.color);
const _hsl = { h: 0, s: 0, l: 0 };
const _tmp = new THREE.Color();

const lambert = (c) => new THREE.MeshLambertMaterial({ color: c });

function build(spec) {
  const g = new THREE.Group();
  const parts = [];
  const add = (geo, color, x = 0, y = 0, z = 0, rot) => {
    const m = new THREE.Mesh(geo, lambert(color));
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    g.add(m);
    parts.push({ mesh: m, base: new THREE.Color(color) });
    return m;
  };
  let restY = 0.03;
  const c = spec.color;
  switch (spec.type) {
    case 'apple':
      add(new THREE.SphereGeometry(0.035, 20, 14), c);
      add(new THREE.CylinderGeometry(0.003, 0.003, 0.014, 6), 0x5a3a1a, 0, 0.038, 0);
      restY = 0.035;
      break;
    case 'cup':
      add(new THREE.CylinderGeometry(0.034, 0.028, 0.075, 20), c);
      add(new THREE.TorusGeometry(0.02, 0.005, 8, 14), c, 0.04, 0, 0);
      restY = 0.0375;
      break;
    case 'ball':
      add(new THREE.SphereGeometry(0.033, 20, 14), c);
      restY = 0.033;
      break;
    case 'pen':
      add(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 10), c, 0, 0, 0, [0, 0, Math.PI / 2]);
      add(new THREE.ConeGeometry(0.008, 0.02, 10), 0x333333, -0.08, 0, 0, [0, 0, Math.PI / 2]);
      restY = 0.008;
      break;
    case 'spoon':
      add(new THREE.CylinderGeometry(0.005, 0.006, 0.1, 8), c, 0, 0, 0, [0, 0, Math.PI / 2]);
      add(new THREE.SphereGeometry(1, 14, 10), c, 0.06, 0, 0).scale.set(0.028, 0.008, 0.02);
      restY = 0.008;
      break;
    case 'card':
      add(new THREE.BoxGeometry(0.085, 0.004, 0.055), c);
      restY = 0.002;
      break;
    case 'bottle':
      add(new THREE.CylinderGeometry(0.025, 0.025, 0.09, 16), c);
      add(new THREE.CylinderGeometry(0.01, 0.014, 0.03, 12), c, 0, 0.06, 0);
      restY = 0.045;
      break;
    case 'eraser':
      add(new THREE.BoxGeometry(0.05, 0.02, 0.03), c);
      restY = 0.01;
      break;
  }
  return { group: g, parts, restY };
}

export function inBoxFootprint(x, z, margin = 0.02) {
  const b = CFG.box;
  return Math.abs(x - b.cx) < b.w / 2 - margin && Math.abs(z - b.cz) < b.d / 2 - margin;
}

export class ObjectSet {
  constructor(parent) {
    this.parent = parent;
    this.items = [];
    this.halos = [];
    this.captureTarget = null;
    this.captureT = -1;
  }

  clear() {
    for (const o of this.items) this.parent.remove(o.group);
    for (const h of this.halos) this.parent.remove(h);
    this.items = [];
    this.halos = [];
    this.captureTarget = null;
  }

  build(layout) {
    this.clear();
    for (const spec of layout) {
      const b = build(spec);
      const yaw = ((spec.slot * 97) % 360) * (Math.PI / 180);
      b.group.rotation.y = yaw;
      b.group.position.set(spec.x, b.restY, spec.z);
      this.parent.add(b.group);
      this.items.push({
        id: spec.id, side: spec.side, angle: spec.angle, type: spec.type, ja: spec.ja,
        group: b.group, parts: b.parts, restY: b.restY, pos: b.group.position,
        home: new THREE.Vector3(spec.x, b.restY, spec.z),
        held: null, inBox: false, falling: false, vy: 0, hover: 0, hoverTarget: 0,
      });
    }
  }

  get remaining() { return this.items.filter((o) => !o.inBox); }
  get(id) { return this.items.find((o) => o.id === id); }

  update(dt, ctx) {
    // ctx: { neglect: bool, relief, neglectScale, floorLocalY, boxCount }
    for (const o of this.items) {
      if (o.falling) this._fall(o, dt, ctx);
      o.hover += (o.hoverTarget - o.hover) * Math.min(1, dt * 14);
    }
    if (this.captureTarget) {
      this.captureT += dt;
      if (this.captureT > CFG.neglect.capture.duration) this.captureTarget = null;
    }
    const ncfg = CFG.neglect;
    for (const o of this.items) {
      const eff = ctx.neglect ? effectiveSuppression(o.angle, ctx.relief, ctx.neglectScale, ncfg) : 0;
      const vp = visualParams(eff, ncfg);
      const glow =
        o.hover * ncfg.hoverGain * vp.hoverScale +
        (this.captureTarget === o ? captureGlow(this.captureT, ncfg) : 0);
      o.eff = eff; // デバッグ/検証用
      for (const p of o.parts) {
        p.base.getHSL(_hsl);
        _tmp.setHSL(_hsl.h, _hsl.s * vp.satScale, _hsl.l).lerp(DESK_COLOR, vp.mix);
        p.mesh.material.color.copy(_tmp);
        p.mesh.material.emissive.setRGB(glow, glow, glow * 0.85);
        // opacity/visible には一切触らない(透明化・消失の禁止)
      }
    }
  }

  triggerCapture(o) {
    this.captureTarget = o;
    this.captureT = 0;
  }

  release(o, ctx) {
    o.held = null;
    o.falling = true;
    o.vy = 0;
    o.inBox = inBoxFootprint(o.pos.x, o.pos.z);
  }

  _fall(o, dt, ctx) {
    o.vy -= 9.8 * dt;
    o.pos.y += o.vy * dt;
    const onDesk = Math.abs(o.pos.x) < CFG.desk.w / 2 && o.pos.z < CFG.desk.frontZ && o.pos.z > CFG.desk.frontZ - CFG.desk.d;
    let support = ctx.floorLocalY;
    if (o.inBox) support = CFG.box.wall + Math.min(0.05, 0.005 * ctx.boxCount);
    else if (onDesk) support = 0;
    const floorY = support + o.restY;
    if (o.pos.y <= floorY) {
      o.pos.y = floorY;
      o.falling = false;
      o.vy = 0;
    }
  }

  showHalos(items) {
    for (const o of items) {
      const h = new THREE.Mesh(
        new THREE.RingGeometry(0.055, 0.064, 32),
        new THREE.MeshBasicMaterial({ color: 0x0b5bd3, side: THREE.DoubleSide }),
      );
      h.rotation.x = -Math.PI / 2;
      h.position.set(o.pos.x, 0.003, o.pos.z);
      this.parent.add(h);
      this.halos.push(h);
    }
  }
}
