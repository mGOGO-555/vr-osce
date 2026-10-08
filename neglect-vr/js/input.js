import * as THREE from 'three';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { CFG } from './config.js';

// 共通の手インターフェース:
//   { id, handedness, tracked, pinching, pinchStarted, pinchEnded, pinchPos(V3,world), tip(V3,world), holding }

function makeState(id) {
  return {
    id, handedness: null, tracked: false, pinching: false, pinchStarted: false, pinchEnded: false,
    pinchPos: new THREE.Vector3(), tip: new THREE.Vector3(), holding: null,
  };
}

/** Quest実機: WebXR Hand Tracking。左右両方の実手モデルを表示し、ピンチを距離+ヒステリシスで検出。 */
export class XRHands {
  constructor(renderer, scene) {
    this.states = [makeState(0), makeState(1)];
    this.objs = [];
    // 手モデルは同梱GLBを使用(CDN不要)。three.js examples/webxr_vr_handinput_cubes と同じファクトリ方式。
    const factory = new XRHandModelFactory().setPath('vendor/hand/');
    for (let i = 0; i < 2; i++) {
      const hand = renderer.xr.getHand(i);
      hand.add(factory.createHandModel(hand, 'mesh'));
      scene.add(hand);
      const st = this.states[i];
      hand.addEventListener('connected', (e) => { st.handedness = e.data.handedness; });
      hand.addEventListener('disconnected', () => { st.tracked = false; });
      this.objs.push(hand);
    }
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
  }

  update() {
    const { pinchOn, pinchOff } = CFG.grab;
    this.states.forEach((st, i) => {
      const hand = this.objs[i];
      const j = hand.joints || {};
      const ti = j['thumb-tip'];
      const ii = j['index-finger-tip'];
      st.pinchStarted = false;
      st.pinchEnded = false;
      st.tracked = !!(ti && ii && ti.visible && ii.visible && hand.visible !== false);
      if (!st.tracked) {
        if (st.pinching) { st.pinching = false; st.pinchEnded = true; }
        return;
      }
      ti.getWorldPosition(this._a);
      ii.getWorldPosition(this._b);
      st.tip.copy(this._b);
      st.pinchPos.copy(this._a).add(this._b).multiplyScalar(0.5);
      const d = this._a.distanceTo(this._b);
      if (!st.pinching && d < pinchOn) { st.pinching = true; st.pinchStarted = true; }
      else if (st.pinching && d > pinchOff) { st.pinching = false; st.pinchEnded = true; }
    });
  }
  get hands() { return this.states; }
}

/** PCプレビュー用: マウス=片手(クリックでピンチ)、A/D=頭部ヨー、W/S=ピッチ、Shift=手を持ち上げ。 */
export class SimHands {
  constructor(renderer, camera, scene, getDeskWorldY) {
    this.camera = camera;
    this.getDeskWorldY = getDeskWorldY;
    this.state = makeState(0);
    this.state.handedness = 'right';
    this.state.tracked = true;
    this.ndc = new THREE.Vector2(0, -0.3);
    this.down = false;
    this.shift = false;
    this.ray = new THREE.Raycaster();
    this.cursor = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0x0b5bd3 }));
    scene.add(this.cursor);
    this.keys = new Set();
    this.uiClick = null; // main側が設定: (ndc)=>bool  UIボタンを押したらtrue
    const el = renderer.domElement;
    const rect = () => el.getBoundingClientRect();
    el.addEventListener('pointermove', (e) => {
      const r = rect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    });
    el.addEventListener('pointerdown', (e) => {
      const r = rect();
      this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
      if (this.uiClick && this.uiClick(this.ndc)) return;
      this.down = true;
    });
    window.addEventListener('pointerup', () => { this.down = false; });
    window.addEventListener('keydown', (e) => { this.keys.add(e.key.toLowerCase()); this.shift = e.shiftKey; });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.key.toLowerCase()); this.shift = e.shiftKey; });
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();
  }

  updateHead(dt) {
    const rate = 1.2;
    const c = this.camera;
    if (this.keys.has('a') || this.keys.has('arrowleft')) c.rotation.y += rate * dt;
    if (this.keys.has('d') || this.keys.has('arrowright')) c.rotation.y -= rate * dt;
    if (this.keys.has('w')) c.rotation.x = Math.min(0.6, c.rotation.x + rate * dt);
    if (this.keys.has('s')) c.rotation.x = Math.max(-1.2, c.rotation.x - rate * dt);
  }

  update() {
    const st = this.state;
    st.pinchStarted = false;
    st.pinchEnded = false;
    const h = this.getDeskWorldY() + (this.shift ? 0.17 : 0.06);
    this.plane.constant = -h;
    this.ray.setFromCamera(this.ndc, this.camera);
    if (this.ray.ray.intersectPlane(this.plane, this._hit)) {
      st.pinchPos.copy(this._hit);
      st.tip.copy(this._hit);
    }
    this.cursor.position.copy(st.pinchPos);
    if (this.down && !st.pinching) { st.pinching = true; st.pinchStarted = true; }
    if (!this.down && st.pinching) { st.pinching = false; st.pinchEnded = true; }
  }
  get hands() { return [this.state]; }
}
