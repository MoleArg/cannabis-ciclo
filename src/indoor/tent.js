import * as THREE from 'three';
import { Plant } from './plant.js';
import * as TX from './textures.js';
import { TENT } from './sim.js';

const W = TENT.w, D = TENT.d, H = TENT.h;
export const SOIL_Y = 0.25;
export const POTS = [
  [-0.19, -0.19], [0.19, -0.19],
  [-0.19, 0.19], [0.19, 0.19],
];

const BLUE = 0x2f6fd8;

function ribbedTube(curve, radius, ribs, mat, amp = 0.13) {
  const segs = ribs * 4;
  const radial = 12;
  const g = new THREE.TubeGeometry(curve, segs, radius, radial, false);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, c);
    const f = 1 + amp * Math.sin((i / segs) * ribs * Math.PI * 2);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(f).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

function tube(points, r, mat, segs = 64) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, r, 6, false), mat);
  m.castShadow = true;
  return m;
}

function at(m, x, y, z) {
  m.position.set(x, y, z);
  return m;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function rounded(w, h, d, r, mat) {
  // cheap rounded box: a box with its vertices pushed towards a superellipse
  const g = new THREE.BoxGeometry(w, h, d, 8, 4, 8);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const ix = Math.max(0, Math.abs(v.x) - (w / 2 - r)) * Math.sign(v.x);
    const iy = Math.max(0, Math.abs(v.y) - (h / 2 - r)) * Math.sign(v.y);
    const iz = Math.max(0, Math.abs(v.z) - (d / 2 - r)) * Math.sign(v.z);
    const inner = new THREE.Vector3(v.x - ix, v.y - iy, v.z - iz);
    const off = new THREE.Vector3(ix, iy, iz);
    if (off.lengthSq() > 0) off.setLength(r);
    v.copy(inner).add(off);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Axial fan: hub + blades, returned so the app can spin `rotor`. */
function fanRotor(radius, blades, color, depth = 0.01) {
  const rotor = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, side: THREE.DoubleSide });
  const shape = new THREE.Shape();
  shape.moveTo(0, radius * 0.18);
  shape.quadraticCurveTo(radius * 0.55, radius * 0.25, radius * 0.95, radius * 0.05);
  shape.quadraticCurveTo(radius * 0.7, -radius * 0.35, 0, -radius * 0.12);
  const bg = new THREE.ShapeGeometry(shape);
  for (let i = 0; i < blades; i++) {
    const b = new THREE.Mesh(bg, bladeMat);
    b.rotation.z = (i / blades) * Math.PI * 2;
    b.rotation.x = 0.0;
    const pivot = new THREE.Group();
    pivot.add(b);
    pivot.rotation.z = (i / blades) * Math.PI * 2;
    b.rotation.set(0.35, 0, 0);
    rotor.add(pivot);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, depth, 16), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4 }));
  hub.rotation.x = Math.PI / 2;
  rotor.add(hub);
  return rotor;
}

function grill(radius, mat) {
  const g = new THREE.Group();
  for (const r of [radius, radius * 0.7, radius * 0.4]) {
    g.add(new THREE.Mesh(new THREE.TorusGeometry(r, 0.0016, 4, 40), mat));
  }
  for (let i = 0; i < 12; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, radius * 2, 4), mat);
    s.rotation.z = (i / 12) * Math.PI;
    g.add(s);
  }
  return g;
}

export function buildScene(scene) {
  const refs = {
    walls: [], poles: [], equipment: [], items: {}, spinners: [], leaks: [],
    plants: [], soils: [], pinAnchors: {},
  };

  // ───────── materials ─────────
  const wrinkle = TX.wrinkleTexture(3);
  wrinkle.repeat.set(1.2, 2);
  const mylarMat = () => new THREE.MeshStandardMaterial({
    color: 0xdfe3e6, metalness: 0.62, roughness: 0.36, bumpMap: wrinkle, bumpScale: 2.2,
    emissive: 0xffffff, emissiveIntensity: 0, transparent: true,
  });
  const fabricMat = (map) => new THREE.MeshStandardMaterial({
    map, roughness: 0.92, metalness: 0.0, bumpMap: wrinkle, bumpScale: 1.6, transparent: true,
  });
  const poleMat = new THREE.MeshStandardMaterial({ color: BLUE, roughness: 0.45, metalness: 0.3 });
  const blackPlastic = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.55 });
  const whitePlastic = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.5 });
  const greyMetal = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.35, metalness: 0.8 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 0.95 });
  const cableBlack = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.6 });
  const cableWhite = new THREE.MeshStandardMaterial({ color: 0xe6e2d6, roughness: 0.6 });
  const ropeBlue = new THREE.MeshStandardMaterial({ color: 0x1f3fb0, roughness: 0.8 });

  // ───────── room ─────────
  const room = new THREE.Group();
  scene.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ map: TX.tileTexture(), roughness: 0.25, metalness: 0.1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  room.add(floor);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.1), new THREE.MeshStandardMaterial({ map: TX.rugTexture(), roughness: 1 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0.05, 0.002, 0.08);
  rug.receiveShadow = true;
  room.add(rug);
  const wallMat = new THREE.MeshStandardMaterial({ map: TX.wallTexture(), roughness: 0.95 });
  // back wall with a window to the right of the tent: the sun comes in by the clock
  const WIN = { x: 1.55, y: 1.45, w: 1.0, h: 0.95 };
  const bwShape = new THREE.Shape();
  bwShape.moveTo(-4, -1.3); bwShape.lineTo(4, -1.3); bwShape.lineTo(4, 1.3); bwShape.lineTo(-4, 1.3); bwShape.lineTo(-4, -1.3);
  const winHole = new THREE.Path();
  winHole.moveTo(WIN.x - WIN.w / 2, WIN.y - 1.3 - WIN.h / 2);
  winHole.lineTo(WIN.x + WIN.w / 2, WIN.y - 1.3 - WIN.h / 2);
  winHole.lineTo(WIN.x + WIN.w / 2, WIN.y - 1.3 + WIN.h / 2);
  winHole.lineTo(WIN.x - WIN.w / 2, WIN.y - 1.3 + WIN.h / 2);
  winHole.lineTo(WIN.x - WIN.w / 2, WIN.y - 1.3 - WIN.h / 2);
  bwShape.holes.push(winHole);
  const bwGeo = new THREE.ShapeGeometry(bwShape);
  {
    const p = bwGeo.attributes.position, uv = bwGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + 4) / 8, (p.getY(i) + 1.3) / 2.6);
  }
  const backWall = new THREE.Mesh(bwGeo, wallMat);
  backWall.position.set(0, 1.3, -0.72);
  backWall.receiveShadow = true;
  backWall.castShadow = true;
  room.add(backWall);
  // thickness of the wall around the window (reveal) so it casts a believable shadow
  const revealMat = new THREE.MeshStandardMaterial({ color: 0xd8d0bd, roughness: 0.95 });
  const rv = (w, h, x, y) => { const m = box(w, h, 0.18, revealMat, x, y, -0.81); m.castShadow = true; room.add(m); };
  rv(WIN.w + 0.04, 0.02, WIN.x, WIN.y + WIN.h / 2 + 0.01);
  rv(WIN.w + 0.04, 0.02, WIN.x, WIN.y - WIN.h / 2 - 0.01);
  rv(0.02, WIN.h, WIN.x - WIN.w / 2 - 0.01, WIN.y);
  rv(0.02, WIN.h, WIN.x + WIN.w / 2 + 0.01, WIN.y);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.5 });
  const fr = (w, h, x, y) => { const m = box(w, h, 0.04, frameMat, x, y, -0.86); m.castShadow = true; room.add(m); };
  fr(WIN.w, 0.05, WIN.x, WIN.y + WIN.h / 2 - 0.025);
  fr(WIN.w, 0.05, WIN.x, WIN.y - WIN.h / 2 + 0.025);
  fr(0.05, WIN.h, WIN.x - WIN.w / 2 + 0.025, WIN.y);
  fr(0.05, WIN.h, WIN.x + WIN.w / 2 - 0.025, WIN.y);
  fr(0.035, WIN.h, WIN.x, WIN.y);
  fr(WIN.w, 0.035, WIN.x, WIN.y + 0.1);
  room.add(box(WIN.w + 0.16, 0.03, 0.14, frameMat, WIN.x, WIN.y - WIN.h / 2 - 0.02, -0.66));
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(WIN.w, WIN.h), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, metalness: 0, transmission: 0.95, transparent: true, opacity: 0.2 }));
  glass.position.set(WIN.x, WIN.y, -0.87);
  room.add(glass);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: new THREE.Color(0x9ec9ff) }, uBottom: { value: new THREE.Color(0xe8f1ff) }, uSun: { value: new THREE.Vector2(0.6, 0.5) }, uSunI: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uBottom; uniform vec2 uSun; uniform float uSunI; varying vec2 vUv;
      void main(){ vec3 c = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
        float d = distance(vUv, uSun); c += vec3(1.0, 0.85, 0.6) * (smoothstep(0.06, 0.0, d) * 2.0 + exp(-d * 6.0) * 0.5) * uSunI;
        // distant rooftops
        float roof = step(vUv.y, 0.18 + 0.05 * step(0.5, fract(vUv.x * 3.0)) + 0.03 * step(0.7, fract(vUv.x * 7.0)));
        c = mix(c, uBottom * 0.25, roof * 0.85);
        gl_FragColor = vec4(c, 1.0); }`,
    depthWrite: true,
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), skyMat);
  sky.position.set(WIN.x, WIN.y, -2.4);
  room.add(sky);
  refs.sky = skyMat;
  refs.window = WIN;
  const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.6), wallMat);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.position.set(-0.85, 1.3, 0);
  leftWall.receiveShadow = true;
  room.add(leftWall);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.MeshStandardMaterial({ color: 0xe8e4da, roughness: 1, side: THREE.BackSide }));
  ceiling.rotation.x = -Math.PI / 2;
  ceiling.position.y = 2.6;
  room.add(ceiling);
  // skirting
  room.add(box(8, 0.08, 0.015, new THREE.MeshStandardMaterial({ color: 0x6b4a33 }), 0, 0.04, -0.71));
  // supplies next to the tent (spray bottle + nutrient bottles, like the photos)
  const supplies = new THREE.Group();
  supplies.position.set(0.75, 0, -0.35);
  const spray = new THREE.Group();
  spray.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.2, 20), new THREE.MeshStandardMaterial({ color: 0xa7c43a, roughness: 0.4 })), 0, 0.1, 0));
  spray.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0x2a2a2a })), 0, 0.24, 0));
  spray.add(at(new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 8, 20, Math.PI), new THREE.MeshStandardMaterial({ color: 0x2a2a2a })), 0, 0.29, 0));
  supplies.add(spray);
  const bottleColors = [0x1d2a6b, 0x7a1d1d, 0x1d5a2b, 0xd89a1a, 0x5a1d6b];
  bottleColors.forEach((c, i) => {
    const b = new THREE.Group();
    b.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.13, 14), new THREE.MeshStandardMaterial({ color: c, roughness: 0.35 })), 0, 0.065, 0));
    b.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.025, 10), new THREE.MeshStandardMaterial({ color: 0xc23030, roughness: 0.4 })), 0, 0.14, 0));
    b.position.set(0.05 + (i % 3) * 0.07, 0, 0.15 + Math.floor(i / 3) * 0.07);
    supplies.add(b);
  });
  supplies.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  room.add(supplies);
  refs.room = room;

  // ───────── tent ─────────
  const tent = new THREE.Group();
  scene.add(tent);
  refs.tent = tent;

  // frame
  const poleR = 0.011;
  const poleGeo = new THREE.CylinderGeometry(poleR, poleR, 1, 10);
  const addPole = (a, b) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const m = new THREE.Mesh(poleGeo, poleMat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.scale.y = A.distanceTo(B);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    m.castShadow = true;
    tent.add(m);
    refs.poles.push(m);
    return m;
  };
  const ix = W / 2 - 0.012, iz = D / 2 - 0.012, top = H - 0.012;
  for (const [x, z] of [[-ix, -iz], [ix, -iz], [ix, iz], [-ix, iz]]) addPole([x, 0.012, z], [x, top, z]);
  for (const y of [0.012, top]) {
    addPole([-ix, y, -iz], [ix, y, -iz]);
    addPole([-ix, y, iz], [ix, y, iz]);
    addPole([-ix, y, -iz], [-ix, y, iz]);
    addPole([ix, y, -iz], [ix, y, iz]);
  }
  // hanging crossbars
  addPole([-ix, top, -0.12], [ix, top, -0.12]);
  addPole([-ix, top, 0.12], [ix, top, 0.12]);
  // corner connectors
  const cornerGeo = new THREE.BoxGeometry(0.035, 0.035, 0.035);
  for (const x of [-ix, ix]) for (const z of [-iz, iz]) for (const y of [0.012, top]) {
    const c = new THREE.Mesh(cornerGeo, blackPlastic);
    c.position.set(x, y, z);
    tent.add(c);
    refs.poles.push(c);
  }

  // walls: a pivot at the floor so the intro can raise them
  const makeWall = (name, w, h, outerTex, normal, pos, rot, { innerOnly = false } = {}) => {
    const pivot = new THREE.Group();
    const g = new THREE.Group();
    pivot.add(g);
    const outerMat = fabricMat(outerTex);
    const innerMat = mylarMat();
    innerMat.bumpMap = wrinkle;
    const geo = new THREE.PlaneGeometry(w, h);
    const outer = new THREE.Mesh(geo, outerMat);
    outer.position.z = 0.002;
    outer.receiveShadow = true;
    outer.castShadow = true;
    const inner = new THREE.Mesh(geo, innerMat);
    inner.rotation.y = Math.PI;
    inner.receiveShadow = true;
    if (!innerOnly) g.add(outer);
    g.add(inner);
    g.rotation.copy(rot);
    pivot.position.copy(pos);
    tent.add(pivot);
    const wall = { name, pivot, group: g, outer, inner, mats: [outerMat, innerMat], normal: normal.clone(), center: pos.clone(), opacity: 1 };
    refs.walls.push(wall);
    return wall;
  };

  const sideL = makeWall('izq', D, H, TX.sideTexture(7, true), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(-W / 2, 0, 0), new THREE.Euler(0, -Math.PI / 2, 0));
  const sideR = makeWall('der', D, H, TX.sideTexture(8, false), new THREE.Vector3(1, 0, 0), new THREE.Vector3(W / 2, 0, 0), new THREE.Euler(0, Math.PI / 2, 0));
  const back = makeWall('fondo', W, H, TX.plainFabricTexture(9), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -D / 2), new THREE.Euler(0, Math.PI, 0));
  for (const w of [sideL, sideR, back]) w.group.position.y = H / 2;
  const roof = makeWall('techo', W, D, TX.plainFabricTexture(10), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, H, 0), new THREE.Euler(-Math.PI / 2, 0, 0));
  roof.outer.material.map.repeat.set(1, 1);
  const floorWall = makeWall('piso', W, D, null, new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0.004, 0), new THREE.Euler(Math.PI / 2, 0, 0), { innerOnly: true });
  floorWall.inner.material.roughness = 0.5;
  floorWall.inner.material.metalness = 0.4;
  floorWall.inner.material.bumpScale = 0.8;
  floorWall.inner.material.color.set(0xcfd3d6);
  floorWall.noXray = true;

  // front: frame with a D-shaped hole + a door that rolls up
  const frontTex = TX.frontTexture();
  const doorShape = (s) => {
    const x0 = -0.37, x1 = 0.33, y0 = -0.77, y1 = 0.72, r = 0.18;
    s.moveTo(x0, y1);
    s.lineTo(x1 - r, y1);
    s.quadraticCurveTo(x1, y1, x1, y1 - r);
    s.lineTo(x1, y0 + r);
    s.quadraticCurveTo(x1, y0, x1 - r, y0);
    s.lineTo(x0, y0);
    s.lineTo(x0, y1);
    return s;
  };
  const frameShape = new THREE.Shape();
  frameShape.moveTo(-W / 2, -H / 2); frameShape.lineTo(W / 2, -H / 2); frameShape.lineTo(W / 2, H / 2); frameShape.lineTo(-W / 2, H / 2); frameShape.lineTo(-W / 2, -H / 2);
  frameShape.holes.push(doorShape(new THREE.Path()));
  const remapUV = (g) => {
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + W / 2) / W, (p.getY(i) + H / 2) / H);
    return g;
  };
  const frameGeo = remapUV(new THREE.ShapeGeometry(frameShape, 16));
  const front = makeWall('frente', W, H, frontTex, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, D / 2), new THREE.Euler(0, 0, 0));
  front.group.position.y = H / 2;
  front.outer.geometry = frameGeo;
  front.inner.geometry = frameGeo;
  const doorGeo = remapUV(new THREE.ShapeGeometry(doorShape(new THREE.Shape()), 16));
  doorGeo.translate(0, -0.72, 0); // hinge line at the top of the door
  const doorPivot = new THREE.Group();
  doorPivot.position.set(0, 0.72, 0);
  front.group.add(doorPivot);
  const doorOuter = new THREE.Mesh(doorGeo, front.mats[0]);
  doorOuter.position.z = 0.003;
  doorOuter.castShadow = true;
  const doorInner = new THREE.Mesh(doorGeo, front.mats[1]);
  doorInner.rotation.y = Math.PI;
  doorInner.position.z = 0.001;
  doorPivot.add(doorOuter, doorInner);
  // UV for door: compensate the translate so the texture lines up
  {
    const p = doorGeo.attributes.position, uv = doorGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + W / 2) / W, (p.getY(i) + 0.72 + H / 2) / H);
  }
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.7, 20), new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.9 }));
  roll.rotation.z = Math.PI / 2;
  roll.position.set(-0.02, 0, 0.02);
  roll.scale.set(0.012, 1, 0.012);
  roll.visible = false;
  doorPivot.parent.add(roll);
  refs.door = { pivot: doorPivot, roll, height: 1.49, open: 0 };
  refs.frontWall = front;

  // ports (blue rim) and mesh windows on the side walls
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x2251c9, roughness: 0.5 });
  const holeMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 1 });
  const sockMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.95, side: THREE.DoubleSide });
  const leakMat = () => new THREE.MeshBasicMaterial({ color: 0xfff1d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const port = (wall, u, y, r, { sock = true } = {}) => {
    // u: horizontal offset along the wall in its local X, y: height from floor
    const g = new THREE.Group();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.008, 8, 32), rimMat);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(r, 32), holeMat);
    hole.position.z = 0.001;
    g.add(rim, hole);
    if (sock) {
      const s = new THREE.Mesh(new THREE.ConeGeometry(r * 0.9, r * 1.6, 16, 1, true), sockMat);
      s.rotation.x = Math.PI / 2 + 0.5;
      s.position.set(0, -r * 0.3, r * 0.75);
      s.scale.set(1, 1, 0.75);
      g.add(s);
    }
    const leak = new THREE.Mesh(new THREE.CircleGeometry(r * 0.75, 24), leakMat());
    leak.position.z = 0.004;
    g.add(leak);
    refs.leaks.push({ mesh: leak, k: sock ? 0.25 : 0.6 });
    g.position.set(u, y - H / 2, 0.006);
    wall.group.add(g);
    return g;
  };
  const windowMesh = (wall, u, y) => {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.11), new THREE.MeshStandardMaterial({ color: 0x0d0d0d }));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.09), new THREE.MeshStandardMaterial({ map: TX.meshTexture(), color: 0xcaa79a, transparent: true, roughness: 0.8 }));
    mesh.position.z = 0.001;
    const leak = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.09), leakMat());
    leak.position.z = 0.002;
    refs.leaks.push({ mesh: leak, k: 0.9 });
    g.add(frame, mesh, leak);
    g.position.set(u, y - H / 2, 0.004);
    wall.group.add(g);
  };
  // right wall: local +x points towards the back (-z) after the rotation
  port(sideR, 0.0, 1.26, 0.075, { sock: false });
  port(sideR, 0.29, 0.14, 0.06);
  windowMesh(sideR, -0.1, 0.13);
  const leftTopPort = port(sideL, 0.02, 1.26, 0.075, { sock: false });
  port(sideL, -0.29, 0.14, 0.06);
  windowMesh(sideL, 0.1, 0.13);

  // ───────── pots, saucers, soil, drip rings ─────────
  const felt = TX.feltTexture();
  const soilTex = TX.soilTexture();
  const potMat = new THREE.MeshStandardMaterial({ map: felt, color: 0x9a9a95, roughness: 1, side: THREE.DoubleSide });
  const saucerMat = new THREE.MeshStandardMaterial({ color: 0xc9643a, roughness: 0.6 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.5 });
  const potGroup = new THREE.Group();
  tent.add(potGroup);
  refs.potGroup = potGroup;
  const tubeColors = [0x2a6fd6, 0x7a3b28, 0x2a6fd6, 0x7a3b28];
  const dripGroup = new THREE.Group();
  tent.add(dripGroup);
  refs.dripGroup = dripGroup;
  refs.drippers = [];
  POTS.forEach(([x, z], i) => {
    const pot = new THREE.Group();
    pot.position.set(x, 0, z);
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.14, 0.022, 32), saucerMat);
    saucer.position.y = 0.015;
    saucer.receiveShadow = true;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.138, 0.25, 36, 3, true), potMat);
    body.position.y = 0.026 + 0.125;
    body.castShadow = true;
    body.receiveShadow = true;
    // a little sag on the felt
    const bp = body.geometry.attributes.position;
    for (let k = 0; k < bp.count; k++) {
      const a = Math.atan2(bp.getZ(k), bp.getX(k));
      const f = 1 + Math.sin(a * 5 + i) * 0.012;
      bp.setX(k, bp.getX(k) * f); bp.setZ(k, bp.getZ(k) * f);
    }
    body.geometry.computeVertexNormals();
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.006, 6, 40), potMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.276;
    const soilMat = new THREE.MeshStandardMaterial({ map: soilTex, roughness: 1, color: 0xffffff });
    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.145, 36), soilMat);
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = SOIL_Y;
    soil.receiveShadow = true;
    refs.soils.push(soilMat);
    // handles
    // fabric straps: half loops sticking out of the felt on opposite sides
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.0045, 6, 16, Math.PI), potMat);
      h.position.set(s * 0.149, 0.235, 0);
      h.rotation.z = s > 0 ? -Math.PI / 2 : Math.PI / 2;
      h.castShadow = true;
      pot.add(h);
    }
    // drip ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.0035, 6, 40), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = SOIL_Y + 0.004;
    ring.castShadow = true;
    pot.add(saucer, body, rim, soil, ring);
    potGroup.add(pot);
    // feed line from the ring up to a manifold on the front crossbar
    const tc = new THREE.MeshStandardMaterial({ color: tubeColors[i], roughness: 0.45 });
    const t = tube([
      [x + 0.075, SOIL_Y + 0.004, z],
      [x + 0.09, SOIL_Y + 0.12, z + 0.02],
      [x * 0.8 + 0.08, 0.9, z * 0.6 + 0.04],
      [x * 0.3 + 0.05, 1.45, 0.12],
      [0.05 + i * 0.012, top - 0.01, 0.12],
    ], 0.0035, tc, 80);
    dripGroup.add(t);
    refs.drippers.push(new THREE.Vector3(x, SOIL_Y + 0.006, z));
    // plant
    const plant = new Plant(17 + i * 31);
    plant.group.position.set(x, SOIL_Y, z);
    plant.group.rotation.y = i * 1.3;
    tent.add(plant.group);
    refs.plants.push(plant);
  });

  // ───────── LED bar ─────────
  const led = new THREE.Group();
  tent.add(led);
  const ledBody = box(0.62, 0.028, 0.075, greyMetal, 0, 0, 0);
  led.add(ledBody);
  // fins along the top
  for (let i = 0; i < 24; i++) led.add(box(0.004, 0.012, 0.07, greyMetal, -0.3 + i * 0.026, 0.02, 0));
  const drivers = [];
  for (const sx of [-0.215, 0.215]) {
    const dbox = box(0.15, 0.062, 0.095, blackPlastic, sx, 0.045, 0);
    led.add(dbox);
    const fr = fanRotor(0.032, 7, 0x222222, 0.006);
    fr.rotation.x = -Math.PI / 2;
    fr.position.set(sx, 0.078, 0);
    led.add(fr);
    refs.spinners.push({ obj: fr, axis: 'z', speed: 30, key: 'led' });
    const gr = grill(0.034, greyMetal);
    gr.rotation.x = -Math.PI / 2;
    gr.position.set(sx, 0.08, 0);
    led.add(gr);
    drivers.push(dbox);
  }
  const philips = box(0.2, 0.034, 0.05, new THREE.MeshStandardMaterial({ color: 0xc7c9cc, metalness: 0.7, roughness: 0.3 }), 0, 0.032, 0);
  led.add(philips);
  led.add(box(0.07, 0.035, 0.051, new THREE.MeshStandardMaterial({ color: 0x6b2c74, roughness: 0.4 }), 0.06, 0.032, 0));
  // little label
  const lblC = document.createElement('canvas'); lblC.width = 256; lblC.height = 64;
  const lg = lblC.getContext('2d'); lg.fillStyle = '#c7c9cc'; lg.fillRect(0, 0, 256, 64); lg.fillStyle = '#1b3f8f'; lg.font = 'bold 34px Arial'; lg.fillText('PHILIPS', 12, 44);
  const lblTex = new THREE.CanvasTexture(lblC); lblTex.colorSpace = THREE.SRGBColorSpace;
  const lbl = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.02), new THREE.MeshBasicMaterial({ map: lblTex }));
  lbl.position.set(-0.04, 0.032, 0.0255);
  led.add(lbl);
  // driver cable
  led.add(tube([[0.1, 0.05, 0], [0.2, 0.1, 0.03], [0.33, 0.02, 0.08], [0.385, -0.25, 0.12]], 0.0035, cableBlack));
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.05), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xfff4e2, emissiveIntensity: 0 }));
  strip.rotation.x = Math.PI / 2;
  strip.position.y = -0.0145;
  led.add(strip);
  // LED dots
  const dotGeo = new THREE.CircleGeometry(0.0045, 8);
  const dotMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8ee, emissiveIntensity: 0 });
  for (let i = 0; i < 28; i++) for (let j = 0; j < 2; j++) {
    const d = new THREE.Mesh(dotGeo, dotMat);
    d.rotation.x = Math.PI / 2;
    d.position.set(-0.27 + i * 0.02, -0.0155, -0.012 + j * 0.024);
    led.add(d);
  }
  led.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  strip.castShadow = false;
  refs.led = { group: led, strip, dotMat };

  // chains + ratchet ropes; rebuilt when the height changes
  const linkGeo = new THREE.TorusGeometry(0.006, 0.0015, 4, 10);
  const chains = new THREE.InstancedMesh(linkGeo, steel, 400);
  chains.castShadow = true;
  chains.frustumCulled = false;
  tent.add(chains);
  const ropes = new THREE.Group();
  tent.add(ropes);
  refs.setLedY = (y) => {
    led.position.set(0, y, 0);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    let n = 0;
    for (const [cx, cz] of [[-0.29, -0.12], [0.29, -0.12], [-0.29, 0.12], [0.29, 0.12]]) {
      const isChain = cz < 0;
      const y0 = y + 0.02, y1 = top - 0.015;
      const sx = cx, sz = cz * 0.25;
      if (isChain) {
        const len = y1 - y0;
        const links = Math.max(1, Math.floor(len / 0.0095));
        for (let k = 0; k < links; k++) {
          const t = k / links;
          p.set(sx, y0 + t * len, sz + (cz - sz) * t);
          q.setFromEuler(new THREE.Euler(0, k % 2 ? Math.PI / 2 : 0, Math.PI / 2));
          m.compose(p, q, s);
          chains.setMatrixAt(n++, m);
        }
      }
    }
    chains.count = n;
    chains.instanceMatrix.needsUpdate = true;
    ropes.clear();
    for (const cx of [-0.29, 0.29]) {
      const a = new THREE.Vector3(cx, y + 0.02, 0.0), b = new THREE.Vector3(cx * 0.95, top - 0.01, 0.12);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.0018, 0.0018, a.distanceTo(b), 5), ropeBlue);
      r.position.copy(a).add(b).multiplyScalar(0.5);
      r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      ropes.add(r);
      const ratchet = box(0.018, 0.04, 0.012, blackPlastic);
      ratchet.position.copy(a).lerp(b, 0.75);
      ropes.add(ratchet);
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.009, 0.0018, 5, 12), steel);
      hook.position.copy(a);
      ropes.add(hook);
    }
  };

  // ───────── extractor + ducts ─────────
  const extractor = new THREE.Group();
  extractor.position.set(0.0, 1.43, -0.2);
  const sockSilver = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.55, roughness: 0.5, bumpMap: wrinkle, bumpScale: 3 });
  const exBody = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.15, 28, 4), sockSilver);
  {
    const p = exBody.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const a = Math.atan2(p.getZ(k), p.getX(k));
      const f = 1 + Math.sin(a * 9) * 0.03 + Math.sin(p.getY(k) * 60) * 0.015;
      p.setX(k, p.getX(k) * f); p.setZ(k, p.getZ(k) * f);
    }
    exBody.geometry.computeVertexNormals();
  }
  exBody.castShadow = true;
  extractor.add(exBody);
  const exGrillRing = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.068, 0.012, 28), blackPlastic);
  exGrillRing.position.y = -0.08;
  extractor.add(exGrillRing);
  const exRotor = fanRotor(0.06, 5, 0x1e1e1e);
  exRotor.rotation.x = Math.PI / 2;
  exRotor.position.y = -0.088;
  extractor.add(exRotor);
  refs.spinners.push({ obj: exRotor, axis: 'z', speed: 40, key: 'extractor' });
  const exG = grill(0.062, blackPlastic);
  exG.rotation.x = Math.PI / 2;
  exG.position.y = -0.092;
  extractor.add(exG);
  // straps to the crossbar
  extractor.add(tube([[-0.05, 0.07, 0], [-0.04, 0.12, 0.04], [-0.02, 0.155, 0.08]], 0.002, ropeBlue));
  extractor.add(tube([[0.05, 0.07, 0], [0.04, 0.12, 0.04], [0.02, 0.155, 0.08]], 0.002, ropeBlue));
  tent.add(extractor);
  const ductMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.55, metalness: 0.2 });
  const duct = ribbedTube(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.0, 1.5, -0.2),
    new THREE.Vector3(0.03, 1.56, -0.2),
    new THREE.Vector3(0.18, 1.55, -0.12),
    new THREE.Vector3(0.33, 1.42, -0.03),
    new THREE.Vector3(0.375, 1.3, 0.0),
    new THREE.Vector3(0.405, 1.26, 0.0),
  ]), 0.045, 40, ductMat, 0.1);
  tent.add(duct);
  const blueDuctMat = new THREE.MeshStandardMaterial({ color: 0x1f47c9, roughness: 0.4, metalness: 0.15 });
  const blueDuct = ribbedTube(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.4, 1.26, 0.0),
    new THREE.Vector3(0.5, 1.3, 0.0),
    new THREE.Vector3(0.56, 1.5, -0.02),
    new THREE.Vector3(0.45, 1.66, -0.08),
    new THREE.Vector3(0.2, 1.66, -0.2),
    new THREE.Vector3(-0.15, 1.66, -0.28),
  ]), 0.05, 70, blueDuctMat, 0.14);
  tent.add(blueDuct);

  // ───────── clip fan ─────────
  const clip = new THREE.Group();
  clip.position.set(ix, 0.95, -iz);
  const clamp = box(0.04, 0.05, 0.04, whitePlastic);
  clip.add(clamp);
  const neck = new THREE.Group();
  neck.position.set(-0.03, 0.03, 0.03);
  clip.add(neck);
  const arm = box(0.015, 0.06, 0.015, whitePlastic, 0, 0.02, 0);
  neck.add(arm);
  const head = new THREE.Group();
  head.position.set(0, 0.06, 0.02);
  neck.add(head);
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.05, 16), whitePlastic);
  motor.rotation.x = Math.PI / 2;
  motor.position.z = -0.03;
  head.add(motor);
  const cage = grill(0.085, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
  const cageRing = new THREE.Mesh(new THREE.TorusGeometry(0.088, 0.004, 6, 40), whitePlastic);
  head.add(cage, cageRing);
  cage.position.z = 0.012;
  const clipRotor = fanRotor(0.078, 3, 0x5da0e8);
  clipRotor.position.z = 0.0;
  head.add(clipRotor);
  const cageBack = grill(0.085, new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 }));
  cageBack.position.z = -0.012;
  head.add(cageBack);
  clip.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  tent.add(clip);
  refs.clipFan = { group: clip, neck, rotor: clipRotor, base: -Math.PI / 4 };
  neck.rotation.y = -Math.PI / 4;
  refs.spinners.push({ obj: clipRotor, axis: 'z', speed: 25, key: 'clip' });

  // ───────── 80 mm PC fans ─────────
  const pcFan = (pos, rotY) => {
    const g = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.025), blackPlastic);
    const holeFace = new THREE.Mesh(new THREE.CircleGeometry(0.037, 24), new THREE.MeshStandardMaterial({ color: 0x050505 }));
    holeFace.position.z = 0.0126;
    g.add(frame, holeFace);
    const rotor = fanRotor(0.036, 7, 0x161616, 0.012);
    rotor.position.z = 0.0135;
    g.add(rotor);
    const sticker = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), new THREE.MeshStandardMaterial({ color: 0x5fbf3a }));
    sticker.position.z = 0.0205;
    rotor.add(sticker);
    g.position.copy(pos);
    g.rotation.y = rotY;
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    tent.add(g);
    refs.spinners.push({ obj: rotor, axis: 'z', speed: 55, key: 'pc' });
    // wires
    tent.add(tube([[pos.x, pos.y - 0.04, pos.z], [pos.x, pos.y - 0.2, pos.z + 0.05], [pos.x * 0.98, pos.y - 0.25, pos.z + 0.2]], 0.0016, new THREE.MeshStandardMaterial({ color: 0x8a2a2a })));
    return g;
  };
  const pc1 = pcFan(new THREE.Vector3(W / 2 - 0.016, 0.55, 0.1), -Math.PI / 2);
  const pc2 = pcFan(new THREE.Vector3(-W / 2 + 0.016, 0.3, 0.26), Math.PI / 2);

  // ───────── humidifier ─────────
  const hum = new THREE.Group();
  hum.position.set(0, 0.004, 0);
  const egg = new THREE.Mesh(new THREE.SphereGeometry(0.06, 32, 24), new THREE.MeshPhysicalMaterial({
    color: 0x7fb4f0, roughness: 0.15, transmission: 0.55, thickness: 0.05, ior: 1.4, transparent: true, opacity: 0.95,
  }));
  egg.scale.set(1, 1.3, 1);
  egg.position.y = 0.075;
  egg.castShadow = true;
  const humBase = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0xdfe8f2, roughness: 0.4 }));
  humBase.position.y = 0.01;
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.015, 16), whitePlastic);
  nozzle.position.y = 0.152;
  const humLed = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 8), new THREE.MeshBasicMaterial({ color: 0x55c8ff }));
  humLed.position.set(0, 0.03, 0.05);
  hum.add(egg, humBase, nozzle, humLed);
  tent.add(hum);
  tent.add(tube([[0, 0.02, -0.05], [0.05, 0.01, -0.2], [0.2, 0.01, -0.38], [0.38, 0.05, -0.39]], 0.002, cableWhite));
  refs.humidifier = { group: hum, led: humLed, nozzle: new THREE.Vector3(0, 0.16, 0) };

  // ───────── thermo-hygrometer + timer ─────────
  const lcd = new TX.LcdScreen(256, 176, (g, w, h, d) => {
    g.fillStyle = '#b9c2b0'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d2219';
    g.font = 'bold 64px "SF Mono", Menlo, monospace';
    g.textAlign = 'right';
    g.fillText(d.T.toFixed(1), 190, 70);
    g.font = 'bold 26px Menlo, monospace'; g.fillText('°C', 240, 50);
    g.font = 'bold 58px Menlo, monospace'; g.fillText(Math.round(d.RH), 190, 150);
    g.font = 'bold 26px Menlo, monospace'; g.fillText('%', 232, 140);
    g.textAlign = 'left'; g.font = '16px Menlo, monospace';
    g.fillText('IN', 14, 30); g.fillText('RH', 14, 110);
    g.fillText(`max ${d.Tmax.toFixed(1)}`, 14, 168);
  });
  const thermo = new THREE.Group();
  thermo.position.set(-0.2, 1.33, -D / 2 + 0.03);
  thermo.add(box(0.1, 0.075, 0.018, new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.5, roughness: 0.4 })));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.084, 0.058), new THREE.MeshBasicMaterial({ map: lcd.texture }));
  scr.position.z = 0.0095;
  thermo.add(scr);
  thermo.add(tube([[0.0, 0.035, 0], [0.0, 0.1, 0.01], [0.02, 0.24, 0.06]], 0.0018, ropeBlue));
  tent.add(thermo);
  refs.thermoLcd = lcd;

  const timerLcd = new TX.LcdScreen(256, 160, (g, w, h, d) => {
    g.fillStyle = '#d7e3e6'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#123';
    g.font = 'bold 54px Menlo, monospace';
    g.textAlign = 'center';
    g.fillText(d.time, w / 2, 70);
    g.font = 'bold 22px Menlo, monospace';
    g.fillText(d.on ? '● LUZ ON' : '○ LUZ OFF', w / 2, 110);
    g.font = '18px Menlo, monospace';
    g.fillText(d.schedule, w / 2, 145);
  });
  const timer = new THREE.Group();
  timer.position.set(W / 2 - 0.025, 1.38, 0.27);
  timer.rotation.y = -Math.PI / 2;
  timer.add(box(0.11, 0.085, 0.03, whitePlastic));
  const tscr = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.045), new THREE.MeshBasicMaterial({ map: timerLcd.texture }));
  tscr.position.set(-0.012, 0.008, 0.0155);
  timer.add(tscr);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 12), new THREE.MeshStandardMaterial({ color: 0x2ab3a6 }));
    b.rotation.x = Math.PI / 2;
    b.position.set(0.038, 0.027 - i * 0.017, 0.016);
    timer.add(b);
  }
  tent.add(timer);
  refs.timerLcd = timerLcd;

  // cable socks hanging from the roof
  const socks = new THREE.Group();
  for (const [x, z] of [[-0.22, -0.05], [0.28, 0.2], [-0.05, 0.25]]) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide }));
    s.rotation.x = Math.PI;
    s.position.set(x, H - 0.065, z);
    socks.add(s);
    socks.add(tube([[x, H - 0.12, z], [x + 0.01, H - 0.3, z + 0.01], [x * 0.9, H - 0.6, z * 1.1]], 0.0025, cableBlack));
  }
  tent.add(socks);

  // power strip in the upper left port, cable down to the floor
  const strip2 = new THREE.Group();
  strip2.position.set(-W / 2 - 0.03, 1.2, 0.02);
  strip2.add(box(0.03, 0.12, 0.05, whitePlastic));
  strip2.add(box(0.026, 0.03, 0.03, new THREE.MeshStandardMaterial({ color: 0xd9d4c7 }), -0.02, 0.08, 0));
  strip2.rotation.z = 0.25;
  scene.add(strip2);
  scene.add(tube([[-W / 2 - 0.04, 1.29, 0.02], [-W / 2 - 0.08, 1.45, 0.05], [-W / 2 - 0.03, 1.66, 0.1], [-0.25, 1.62, 0.2]], 0.003, cableWhite));
  scene.add(tube([
    [-W / 2 - 0.035, 1.14, 0.02], [-W / 2 - 0.05, 0.8, 0.08], [-W / 2 - 0.04, 0.25, 0.2], [-W / 2 - 0.05, 0.02, 0.3],
    [-W / 2 - 0.1, 0.004, 0.42], [-0.7, 0.004, 0.5], [-0.835, 0.01, 0.55], [-0.845, 0.2, 0.6], [-0.845, 0.3, 0.62],
  ], 0.003, cableWhite, 140));
  // wall outlet
  const outlet = box(0.012, 0.1, 0.07, whitePlastic, -0.844, 0.32, 0.62);
  scene.add(outlet);
  scene.add(box(0.014, 0.03, 0.03, new THREE.MeshStandardMaterial({ color: 0xd9d4c7 }), -0.836, 0.31, 0.62));

  // stuff on the roof: towels + green bag, as in the photos
  const roofStuff = new THREE.Group();
  const towelColors = [0x8a8f86, 0xa9c48a, 0xd6cbb7];
  towelColors.forEach((c, i) => {
    const t = rounded(0.3, 0.035, 0.22, 0.015, new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));
    t.position.set(-0.22 + i * 0.01, H + 0.02 + i * 0.033, 0.12 - i * 0.015);
    t.rotation.y = (i - 1) * 0.12;
    roofStuff.add(t);
  });
  const bag = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 16), new THREE.MeshPhysicalMaterial({ color: 0x8bd05a, roughness: 0.35, transmission: 0.3, transparent: true, opacity: 0.85 }));
  {
    const p = bag.geometry.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
      const f = 1 + Math.sin(x * 40) * 0.06 + Math.cos(z * 37 + y * 20) * 0.06;
      p.setXYZ(k, x * f, (y > 0 ? y * 1.3 : y * 0.6) * f, z * f);
    }
    bag.geometry.computeVertexNormals();
  }
  bag.position.set(0.02, H + 0.1, 0.18);
  bag.castShadow = true;
  roofStuff.add(bag);
  roofStuff.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  tent.add(roofStuff);
  refs.roofStuff = roofStuff;

  // ───────── equipment registry (pins + info card) ─────────
  const reg = (id, object, anchor, info) => {
    refs.items[id] = { id, object, anchor: anchor.clone(), ...info };
    object.traverse((o) => { o.userData.item = id; });
  };
  reg('carpa', back.group, new THREE.Vector3(0.38, 1.62, 0.4), {
    kind: 'Estructura', title: 'Carpa Cultivarg 80×80×160',
    text: 'Tela oxford negra por fuera y mylar plateado por dentro, sobre una estructura de caños de acero azules. Puerta frontal en D con cierre, ventanas de malla y puertos con manga en los laterales.',
    specs: [['Medidas', '80 × 80 × 160 cm'], ['Superficie', '0,64 m²'], ['Volumen', '≈ 1,02 m³'], ['Reflexión mylar', '≈ 90 %']],
  });
  reg('led', led, new THREE.Vector3(0.31, 0, 0), {
    kind: 'Iluminación', title: 'Barra LED con fuente Philips',
    text: 'Barra lineal de aluminio con dos módulos refrigerados por cooler y fuente Philips Xitanium al centro. Cuelga de cadenas en el lado del fondo y de poleas con trinquete en el frente, así se regula la altura.',
    specs: [['Montaje', 'Cadenas + trinquetes'], ['Largo', '≈ 62 cm'], ['Refrigeración', '2 coolers activos']],
  });
  reg('extractor', extractor, new THREE.Vector3(0.0, 1.43, -0.2), {
    kind: 'Aire', title: 'Extractor en manga',
    text: 'Ventilador cubierto por una manga plateada, colgado del techo. Saca el aire caliente por el ducto negro hacia el puerto superior derecho, y de ahí sale al ducto azul sobre el techo.',
    specs: [['Ubicación', 'Techo, lado del fondo'], ['Salida', 'Puerto lateral superior'], ['Ducto', 'Flexible Ø ~10 cm']],
  });
  reg('clip', clip, new THREE.Vector3(ix - 0.05, 1.04, -iz + 0.05), {
    kind: 'Aire', title: 'Ventilador de clip oscilante',
    text: 'Agarrado del caño del fondo, mueve el aire entre las plantas. Rompe la capa de aire húmedo de las hojas, fortalece los tallos y evita zonas de calor bajo la luz.',
    specs: [['Diámetro', '≈ 15 cm'], ['Aspas', '3, azules'], ['Oscilación', '± 35°']],
  });
  reg('coolers', pc1, pc1.position.clone().add(new THREE.Vector3(-0.03, 0.06, 0)), {
    kind: 'Aire', title: 'Coolers de 80 mm',
    text: 'Dos coolers de PC en las paredes laterales, en la mitad inferior. Meten aire fresco de la habitación, que el extractor saca por arriba: así se arma una corriente de abajo hacia arriba.',
    specs: [['Tamaño', '80 × 80 mm'], ['Posición', 'Laterales, zona baja'], ['Función', 'Entrada de aire']],
  });
  reg('humidificador', hum, new THREE.Vector3(0, 0.2, 0), {
    kind: 'Clima', title: 'Humidificador ultrasónico',
    text: 'El "huevo" azul en el centro, entre las macetas. Sube la humedad, clave en plántula y vegetativo; en floración conviene apagarlo para evitar hongos.',
    specs: [['Tipo', 'Ultrasónico, niebla fría'], ['Caudal estimado', '≈ 250 ml/h']],
  });
  reg('termo', thermo, new THREE.Vector3(-0.2, 1.4, -D / 2 + 0.03), {
    kind: 'Sensores', title: 'Termohigrómetro digital',
    text: 'Colgado cerca del techo. Mide temperatura y humedad, y guarda la máxima. La pantalla de la escena muestra los valores simulados en vivo.',
    specs: [['Altura', '≈ 1,33 m'], ['Variables', 'T °C · HR %']],
  });
  reg('timer', timer, new THREE.Vector3(W / 2 - 0.03, 1.45, 0.27), {
    kind: 'Control', title: 'Timer / controlador',
    text: 'Programa el fotoperiodo de la luz. En la escena muestra la hora simulada y el estado de la luz.',
    specs: [['Ubicación', 'Pared derecha, arriba']],
  });
  reg('macetas', potGroup, new THREE.Vector3(-0.19, 0.3, 0.33), {
    kind: 'Sustrato', title: 'Macetas de tela × 4',
    text: 'Macetas de geotextil sobre platos, con sustrato aireado con perlita. Cada una tiene un anillo de riego por goteo alrededor de la plántula.',
    specs: [['Diámetro', '≈ 30 cm'], ['Volumen', '≈ 15–18 L'], ['Distribución', '2 × 2']],
  });
  reg('goteo', dripGroup, new THREE.Vector3(0.1, 1.4, 0.12), {
    kind: 'Riego', title: 'Riego por goteo',
    text: 'Mangueras azules y marrones bajan desde el caño delantero del techo hasta un anillo en cada maceta. Con el botón "Regar" se simula un riego.',
    specs: [['Líneas', '4'], ['Emisor', 'Anillo perimetral']],
  });
  reg('plantas', refs.plants[0].group, new THREE.Vector3(0.19, 0.33, 0.19), {
    kind: 'Cultivo', title: 'Plantas',
    text: 'Cuatro plantas fotoperiódicas generadas de forma procedural. Crecen según el día del ciclo, se estiran al pasar a 12/12 y desarrollan flores.',
    specs: [],
  });
  refs.plants.forEach((p) => p.group.traverse((o) => { o.userData.item = 'plantas'; }));
  reg('ducto', blueDuct, new THREE.Vector3(0.52, 1.5, -0.02), {
    kind: 'Aire', title: 'Ducto flexible azul',
    text: 'Continúa la salida del extractor por fuera de la carpa y apoya sobre el techo.',
    specs: [['Tipo', 'Aluminio corrugado']],
  });
  reg('zapatilla', strip2, new THREE.Vector3(-W / 2 - 0.04, 1.28, 0.02), {
    kind: 'Eléctrico', title: 'Zapatilla eléctrica',
    text: 'Entra por el puerto superior izquierdo y alimenta todo el equipo. Conviene revisar la carga total y que no quede apoyada sobre superficies húmedas.',
    specs: [],
  });
  reg('ventanas', sideR.group.children[sideR.group.children.length - 1], new THREE.Vector3(W / 2 + 0.01, 0.16, 0.1), {
    kind: 'Aire', title: 'Ventanas de malla y puertos bajos',
    text: 'Entradas pasivas de aire en la parte baja de cada lateral. Cuando la luz está encendida se ve el resplandor a través de la malla.',
    specs: [],
  });
  refs.sideWalls = { sideL, sideR, back, roof, front };
  refs.pcFans = [pc1, pc2];
  refs.extractor = extractor;
  refs.leftTopPort = leftTopPort;
  return refs;
}
