// 一時的なデバッグパネル（?beddebug=1 を付けたときだけ main.js から読み込まれる）。
// Quest Browser はconsole操作が難しいため、VR内のパネルにボタン3つだけ置く。OSCE進行・採点・loggerには接続しない。
import * as THREE from 'three';
import { Panel } from './ui.js';

export function initBedDebug({ scene, camera, renderer, controllers }) {
  const panel = new Panel({ width: 0.5, height: 0.5, px: 640 });
  panel.mesh.name = 'beddebug-panel'; panel.mesh.frustumCulled = false;   // 画面外でも位置更新（onBeforeRender）を走らせる
  scene.add(panel.mesh);
  let status = '待機中';
  const page = () => ({
    title: 'Bed mobility debug（症例1）',
    body: status,
    buttons: [{ id: 'play', label: 'Play Bed Mobility' }, { id: 'stand', label: 'Bed → Stand' }, { id: 'reset', label: 'Reset' }],
  });
  const refresh = () => panel.setPage(page());
  refresh();

  const api = () => window.osceBed;
  const act = (id) => {
    const b = api();
    if (!b || !b.ready) { status = '症例1の患者が未読込です'; refresh(); return; }
    if (id === 'play') { status = '再生中: bed mobility'; refresh(); b.play({ done: () => { status = '完了: 端座位（STS初期姿勢）'; refresh(); } }); }
    else if (id === 'stand') { status = '再生中: bed mobility → STS'; refresh(); b.playThenStand({ done: () => { status = '完了: 立位'; refresh(); } }); }
    else if (id === 'reset') { b.stop(); b.at(0); status = 'リセット: 仰臥位'; refresh(); }
  };

  // パネルは、VR開始時と、離れすぎたときだけ目の前（やや左下）へ置き直す（頭に固定はしない）
  const _p = new THREE.Vector3(), _d = new THREE.Vector3();
  let placed = false;
  const place = () => {
    camera.getWorldPosition(_p); camera.getWorldDirection(_d); _d.y = 0; _d.normalize();
    const side = new THREE.Vector3(-_d.z, 0, _d.x);   // 視線の右
    panel.mesh.position.copy(_p).addScaledVector(_d, 0.9).addScaledVector(side, -0.35); panel.mesh.position.y = _p.y - 0.25;
    panel.mesh.rotation.set(0, Math.atan2(_p.x - panel.mesh.position.x, _p.z - panel.mesh.position.z), 0);
    placed = true;
  };
  const rc = new THREE.Raycaster(), _m = new THREE.Matrix4(), _o = new THREE.Vector3(), _dir = new THREE.Vector3();
  let mouseHover = null;
  panel.mesh.onBeforeRender = () => {
    camera.getWorldPosition(_p);
    if (!placed || _p.distanceTo(panel.mesh.position) > 2.2) place();
    let hover = mouseHover;
    for (const c of controllers) {
      _m.identity().extractRotation(c.matrixWorld); _o.setFromMatrixPosition(c.matrixWorld); _dir.set(0, 0, -1).applyMatrix4(_m).normalize();
      rc.set(_o, _dir); const h = rc.intersectObject(panel.mesh, false)[0];
      c.userData.bdHover = h ? panel.hitTest(h.uv) : null;
      if (c.userData.bdHover) hover = c.userData.bdHover;
    }
    panel.setHover(hover);
  };
  renderer.xr.addEventListener('sessionstart', () => { placed = false; });
  let last = 0;
  for (const c of controllers) c.addEventListener('selectstart', () => {
    const now = performance.now(); if (now - last < 350) return;
    const b = c.userData.bdHover; if (b) { last = now; act(b.id); }
  });
  // PC（マウス）確認用。パネル上のクリックは既存OSCE側（main.js の pointerup）へ貫通させない
  const pcHit = (e) => {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    rc.setFromCamera(ndc, camera); const h = rc.intersectObject(panel.mesh, false)[0];
    return h ? panel.hitTest(h.uv) || { id: null } : null;
  };
  window.__bdBlockPc = (e) => !!pcHit(e);
  renderer.domElement.addEventListener('click', (e) => {
    const b = pcHit(e); if (b && b.id) act(b.id);
  });
  return { panel, act };
}
