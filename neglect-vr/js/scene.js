import * as THREE from 'three';
import { CFG } from './config.js';

export function createWorld(scene, camera) {
  scene.background = new THREE.Color(0xffffff);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd0d0d0, 2.2));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(1, 3, 1.5);
  scene.add(dir);

  // 白い部屋(向きに依存しない: 四方の壁も白)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(10, 20, 0xdddddd, 0xe6e6e6);
  grid.position.y = 0.001;
  scene.add(grid);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.BackSide }));
  walls.position.y = 2;
  scene.add(walls);

  // 机(原点 = 机上面の校正時頭部直下)
  const desk = new THREE.Group();
  scene.add(desk);
  const dcfg = CFG.desk;
  const top = new THREE.Mesh(new THREE.BoxGeometry(dcfg.w, dcfg.t, dcfg.d), new THREE.MeshLambertMaterial({ color: dcfg.color }));
  top.position.set(0, -dcfg.t / 2, dcfg.frontZ - dcfg.d / 2);
  desk.add(top);
  const legMat = new THREE.MeshLambertMaterial({ color: 0xb8ab90 });
  const legs = new THREE.Group();
  for (const sx of [-1, 1]) {
    for (const sz of [0.05, 0.95]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1, 0.05), legMat);
      leg.position.set(sx * (dcfg.w / 2 - 0.05), -0.5, dcfg.frontZ - dcfg.d * sz);
      legs.add(leg);
    }
  }
  desk.add(legs);

  // 収納箱(上面開放)
  const b = CFG.box;
  const boxMat = new THREE.MeshLambertMaterial({ color: b.color });
  const box = new THREE.Group();
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.wall, b.d), boxMat);
  bottom.position.set(b.cx, b.wall / 2, b.cz);
  box.add(bottom);
  for (const sx of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(b.wall, b.h, b.d), boxMat);
    w.position.set(b.cx + (sx * (b.w - b.wall)) / 2, b.h / 2, b.cz);
    box.add(w);
  }
  for (const sz of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.wall), boxMat);
    w.position.set(b.cx, b.h / 2, b.cz + (sz * (b.d - b.wall)) / 2);
    box.add(w);
  }
  desk.add(box);

  // B: 頭部追従の左視野欠損(半盲の教育用比較条件)。Neglect条件では使わない。
  // 遠方(5m)に置いた黒板の縁を正面方向に合わせ、左右眼の視差を小さく保つ。
  const maskMat = new THREE.MeshBasicMaterial({ color: 0x000000, depthTest: false, depthWrite: false, transparent: true, opacity: 1 });
  const mask = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), maskMat);
  mask.position.set(-20, 0, -5);
  mask.renderOrder = 1000;
  mask.frustumCulled = false;
  mask.visible = false;
  scene.add(camera);
  camera.add(mask);

  // D: 左方向へのvisual scanning cue(左端アンカー＋右→左へ流れるシェブロン)
  const cue = new THREE.Group();
  const cueMat = () => new THREE.MeshBasicMaterial({ color: 0x0b5bd3 });
  const anchor = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.4, 0.02), cueMat());
  anchor.position.set(-0.72, 0.2, -0.74);
  cue.add(anchor);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.05), cueMat());
  flag.position.set(-0.675, 0.37, -0.74);
  cue.add(flag);
  const shape = new THREE.Shape();
  shape.moveTo(-0.03, 0); shape.lineTo(0, 0.03); shape.lineTo(0.014, 0.03);
  shape.lineTo(-0.016, 0); shape.lineTo(0.014, -0.03); shape.lineTo(0, -0.03); shape.closePath();
  const chevGeo = new THREE.ShapeGeometry(shape);
  const chevrons = [];
  for (let i = 0; i < 9; i++) {
    const m = new THREE.Mesh(chevGeo, cueMat());
    m.rotation.x = -Math.PI / 2;
    m.position.set(0.64 - i * 0.16, 0.003, -0.74);
    cue.add(m);
    chevrons.push(m);
  }
  cue.visible = false;
  desk.add(cue);
  const light = new THREE.Color(0xb9d3ff);
  const strong = new THREE.Color(0x0b5bd3);

  return {
    desk, legs, box, mask, cue,
    placeDesk(x, z, deskY, yawL) {
      desk.position.set(x, deskY, z);
      desk.rotation.y = yawL;
      legs.scale.y = deskY;
    },
    updateCue(t) {
      // シェブロンの強調が右→左へ約1.8秒周期で流れる
      const head = 1 - ((t / 1.8) % 1); // 1(右端) → 0(左端)
      chevrons.forEach((m, i) => {
        const pos = 1 - i / (chevrons.length - 1); // i=0が右端(1)
        const k = Math.max(0, 1 - Math.abs(pos - head) * 4);
        m.material.color.copy(light).lerp(strong, k);
      });
    },
  };
}
