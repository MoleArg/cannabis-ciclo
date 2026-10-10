import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { animate, createTimeline } from 'animejs';
import { MOLECULES } from './molecules.js';

// Microscopio: un zoom continuo desde el cogollo hasta el interior de un átomo
// de carbono de su THC. Cada nivel vive en su propio grupo, normalizado a
// ~1 unidad, y la escala real se muestra en la regla.

const LEVELS = [
  { id: 'cogollo', name: 'Cogollo', far: 4.4, near: 1.1, span: [3e-2, 4e-3] },
  { id: 'tricoma', name: 'Tricomas', far: 2.6, near: 0.5, span: [1.2e-3, 1e-4] },
  { id: 'resina', name: 'Dentro de la resina', far: 2.4, near: 0.7, span: [4e-8, 6e-9] },
  { id: 'molecula', name: 'Molécula', far: 2.3, near: 0.75, span: [2.2e-9, 6e-10] },
  { id: 'atomo', name: 'Átomo de carbono', far: 2.4, near: 0.55, span: [5e-10, 1.2e-10] },
];
const CPK = { C: 0x2b2f33, H: 0xf2f2f2, O: 0xe23b2e };
const RADIUS = { C: 0.34, H: 0.22, O: 0.32 }; // fracción del radio de van der Waals, en Å
const ELEMENT = { C: 'Carbono', H: 'Hidrógeno', O: 'Oxígeno' };
const NAMES = { thc: 'Δ9-THC', cbd: 'CBD', cbn: 'CBN' };
const FORMULA = { thc: 'C₂₁H₃₀O₂', cbd: 'C₂₁H₃₀O₂', cbn: 'C₂₁H₂₆O₂' };

const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
function seeded(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function fmtLen(m) {
  const u = [[1e-2, 'cm', 1e2], [1e-3, 'mm', 1e3], [1e-6, 'µm', 1e6], [1e-9, 'nm', 1e9], [1e-12, 'pm', 1e12]];
  for (const [lim, name, k] of u) if (m >= lim) { const v = m * k; return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace('.', ',')} ${name}`; }
  return `${Math.round(m * 1e15)} fm`;
}

/* ---------------- geometrías ---------------- */
function calyxGeometry() {
  // lágrima con la punta hacia +Y
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const r = Math.sin(Math.PI * Math.pow(t, 0.8)) * (1 - 0.55 * Math.pow(t, 2.2)) * 0.5;
    pts.push(new THREE.Vector2(Math.max(0.001, r), -0.5 + t * 1.25));
  }
  const g = new THREE.LatheGeometry(pts, 22);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = 1 + 0.06 * Math.sin(x * 23 + y * 11) * Math.cos(z * 19 - y * 7);
    p.setXYZ(i, x * f, y, z * f);
  }
  g.computeVertexNormals();
  return { g, pts };
}
function curlGeometry(turns = 1.4, r = 0.07, len = 1) {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24, a = t * Math.PI * 2 * turns;
    pts.push(new THREE.Vector3(Math.sin(a) * r * t, t * len, (Math.cos(a) - 1) * r * t));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.018, 5);
}
function leafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  const n = 14;
  for (let i = 1; i <= n; i++) { const t = i / n, w = Math.sin(Math.PI * t) * 0.18 * (1 - t * 0.3); s.lineTo(w * (i % 2 ? 1.25 : 0.85), t); }
  for (let i = n - 1; i >= 0; i--) { const t = i / n, w = Math.sin(Math.PI * t) * 0.18 * (1 - t * 0.3); s.lineTo(-w * (i % 2 ? 1.25 : 0.85), t); }
  const g = new THREE.ShapeGeometry(s, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), x = p.getX(i); p.setZ(i, y * y * 0.35 + x * x * 2.5); }
  g.computeVertexNormals();
  return g;
}

/* nube electrónica: capas aditivas con ruido */
function cloudMaterial(color, power = 2.2, alpha = 0.55) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uPow: { value: power }, uA: { value: alpha } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main(){
        #ifdef USE_INSTANCING
          mat4 im = instanceMatrix;
        #else
          mat4 im = mat4(1.0);
        #endif
        vec4 mv = modelViewMatrix * im * vec4(position,1.0);
        vN = normalize(normalMatrix * mat3(im) * normal); vV = normalize(-mv.xyz); vP = position + im[3].xyz * 0.37;
        gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime, uPow, uA; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; varying vec3 vP;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
      float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
      void main(){
        float facing = abs(dot(normalize(vN), normalize(vV)));
        float body = pow(facing, uPow);
        float grain = n3(vP*9.0 + uTime*0.6) * 0.6 + n3(vP*23.0 - uTime*0.9) * 0.4;
        float a = body * (0.45 + 0.75*grain) * uA;
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
}

export function createMacro({ renderer, root, onExit }) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  scene.environmentIntensity = 0.3;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.005, 60);
  camera.position.set(0, 0.3, 3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableZoom = false;
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.35;
  controls.enabled = false;

  // fondo con degradé que cambia por nivel
  const bgU = { uTop: { value: new THREE.Color(0x0d1410) }, uBot: { value: new THREE.Color(0x020403) }, uTime: { value: 0 }, uFluid: { value: 0 } };
  const bg = new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: bgU,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop, uBot; uniform float uTime, uFluid; varying vec3 vD;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
      float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y); }
      void main(){
        vec3 c = mix(uBot, uTop, smoothstep(-0.7, 0.9, vD.y));
        // cáusticas para el interior de la resina
        vec2 q = vD.xz*6.0 + vD.y*3.0;
        float k = n(q + uTime*0.25) * n(q*1.7 - uTime*0.18);
        c += uFluid * vec3(1.0, 0.8, 0.45) * pow(k, 2.0) * 0.9;
        gl_FragColor = vec4(c, 1.0);
      }`,
  }));
  scene.add(bg);

  const key = new THREE.DirectionalLight(0xfff3e2, 1.7);
  key.position.set(2, 3, 2.5);
  const rim = new THREE.DirectionalLight(0xbfe0ff, 1.1);
  rim.position.set(-3, 1.2, -2.5);
  const hemi = new THREE.HemisphereLight(0xeaf6e8, 0x1b2416, 0.3);
  scene.add(key, rim, hemi);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.2, 0.35, 0.96);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const data = { tri: { clear: 0.4, cloudy: 0.5, amber: 0.1, density: 0.8 }, pist: 0.5, chemo: 'thc', purple: 0, flower: true, male: false };
  const groups = [];
  const updaters = [];

  /* ===================== nivel 0: cogollo ===================== */
  {
    const g = new THREE.Group();
    const R = seeded(11);
    const { g: calyxG, pts: calyxPts } = calyxGeometry();
    const calyxMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, sheen: 0.18, sheenColor: new THREE.Color(0xe8ffe0), sheenRoughness: 0.6, clearcoat: 0.1 });
    const NC = 620;
    const calyx = new THREE.InstancedMesh(calyxG, calyxMat, NC);
    const stalkG = new THREE.CylinderGeometry(0.0025, 0.004, 1, 5); stalkG.translate(0, 0.5, 0);
    const headG = new THREE.SphereGeometry(1, 10, 8);
    const NT = 26000;
    const stalks = new THREE.InstancedMesh(stalkG, new THREE.MeshStandardMaterial({ color: 0xc9d4bf, roughness: 0.5 }), NT);
    const heads = new THREE.InstancedMesh(headG, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.12, clearcoat: 0.6, clearcoatRoughness: 0.08, metalness: 0, ior: 1.5, specularIntensity: 0.7 }), NT);
    const pistG = curlGeometry(1.2, 0.09, 1);
    const NP = 420;
    const pistils = new THREE.InstancedMesh(pistG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }), NP);
    const leafG = leafGeometry();
    const NL = 26;
    const leaves = new THREE.InstancedMesh(leafG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, side: THREE.DoubleSide }), NL);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, 2.6, 12), new THREE.MeshStandardMaterial({ color: 0x6f8f45, roughness: 0.7 }));
    stem.position.y = -0.2;
    g.add(stem, calyx, stalks, heads, pistils, leaves);

    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const up = new THREE.Vector3(0, 1, 0);
    const calyxM = [], kinds = new Float32Array(NT), pistR = new Float32Array(NP);
    let ci = 0;
    // cola: más ancha en el medio, con punta
    const prof = (t) => Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.04)) * (1 - 0.35 * t) * 0.52 + 0.06;
    while (ci < NC) {
      const t = R();
      const y = -1.05 + t * 2.15;
      const a = R() * Math.PI * 2;
      const rr = prof(t) * Math.sqrt(0.25 + 0.75 * R());
      p.set(Math.cos(a) * rr, y, Math.sin(a) * rr);
      const out = new THREE.Vector3(Math.cos(a), 0.9 + R() * 0.6, Math.sin(a)).normalize();
      q.setFromUnitVectors(up, out);
      const sc = (0.15 + R() * 0.07) * (0.7 + 0.5 * prof(t));
      s.set(sc, sc * (1 + R() * 0.25), sc);
      m.compose(p, q, s);
      calyx.setMatrixAt(ci, m);
      calyxM.push(m.clone());
      ci++;
    }
    // tricomas sobre la superficie de cada cáliz
    const lp = new THREE.Vector3(), ln = new THREE.Vector3(), nm = new THREE.Matrix3();
    let ti = 0;
    for (let k = 0; ti < NT; k = (k + 1) % NC) {
      const M = calyxM[k];
      nm.getNormalMatrix(M);
      const i = 2 + Math.floor(R() * (calyxPts.length - 4));
      const ang = R() * Math.PI * 2;
      const a0 = calyxPts[i], a1 = calyxPts[i + 1];
      lp.set(Math.cos(ang) * a0.x, a0.y, Math.sin(ang) * a0.x);
      const dy = a1.y - a0.y, dr = a1.x - a0.x;
      ln.set(Math.cos(ang) * dy, -dr, Math.sin(ang) * dy).normalize();
      lp.applyMatrix4(M);
      ln.applyMatrix3(nm).normalize();
      ln.x += (R() - 0.5) * 0.5; ln.z += (R() - 0.5) * 0.5; ln.normalize();
      q.setFromUnitVectors(up, ln);
      const hgt = 0.022 + R() * 0.02;
      m.compose(lp, q, s.set(1, hgt, 1));
      stalks.setMatrixAt(ti, m);
      p.copy(lp).addScaledVector(ln, hgt);
      const hr = 0.0058 + R() * 0.0035;
      m.compose(p, q, s.set(hr, hr, hr));
      heads.setMatrixAt(ti, m);
      kinds[ti] = R();
      ti++;
    }
    // pistilos que salen de las puntas de los cálices
    for (let i = 0; i < NP; i++) {
      const M = calyxM[Math.floor(R() * NC)];
      p.set(0, 0.72, 0).applyMatrix4(M);
      const dir = p.clone().setY(0).normalize().add(new THREE.Vector3((R() - 0.5) * 0.8, 0.6 + R() * 0.8, (R() - 0.5) * 0.8)).normalize();
      q.setFromUnitVectors(up, dir);
      e.set(0, R() * Math.PI * 2, 0);
      q.multiply(new THREE.Quaternion().setFromEuler(e));
      const L = 0.16 + R() * 0.16;
      m.compose(p, q, s.set(L, L, L));
      pistils.setMatrixAt(i, m);
      pistR[i] = R();
    }
    // hojas de azúcar entre los cálices
    for (let i = 0; i < NL; i++) {
      const t = 0.1 + R() * 0.75, a = R() * Math.PI * 2, rr = prof(t) * 0.8;
      p.set(Math.cos(a) * rr, -1.05 + t * 2.15, Math.sin(a) * rr);
      const dir = new THREE.Vector3(Math.cos(a), 0.7 + R() * 0.7, Math.sin(a)).normalize();
      q.setFromUnitVectors(up, dir);
      q.multiply(new THREE.Quaternion().setFromAxisAngle(up, R() * Math.PI));
      const L = 0.32 + R() * 0.22;
      m.compose(p, q, s.set(L, L, L));
      leaves.setMatrixAt(i, m);
    }
    const c = new THREE.Color();
    function paint() {
      const T = data.tri, base = new THREE.Color(0x8fbf62).lerp(new THREE.Color(0x7a4f9a), data.purple * 0.6);
      const frost = Math.max(0.15, T.density);
      for (let i = 0; i < NC; i++) calyx.setColorAt(i, c.copy(base).offsetHSL((R() - 0.5) * 0.03, 0, (R() - 0.5) * 0.08).lerp(new THREE.Color(0xdfeccc), frost * 0.12));
      const shown = Math.round(NT * (0.12 + 0.88 * frost));
      stalks.count = heads.count = shown;
      for (let i = 0; i < shown; i++) {
        const r = kinds[i];
        if (r < T.amber) c.setRGB(0.85, 0.48, 0.12);
        else if (r < T.amber + T.cloudy) c.setRGB(0.82, 0.83, 0.8);
        else c.setRGB(0.55, 0.66, 0.72);
        heads.setColorAt(i, c);
      }
      const orange = new THREE.Color(0xd2651f), brown = new THREE.Color(0x7d4422), white = new THREE.Color(0xf6f2e8);
      for (let i = 0; i < NP; i++) pistils.setColorAt(i, pistR[i] < data.pist ? c.copy(orange).lerp(brown, Math.max(0, data.pist - 0.6) * 2 * pistR[i]) : white);
      for (let i = 0; i < NL; i++) leaves.setColorAt(i, c.copy(base).offsetHSL(0, -0.05, -0.12).lerp(new THREE.Color(0xdfeccc), frost * 0.3));
      for (const im of [calyx, heads, pistils, leaves]) if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    paint();
    g.userData.paint = paint;
    g.rotation.z = 0.08;
    groups.push(g);
    updaters.push(() => {});
  }

  /* ===================== nivel 1: tricomas ===================== */
  {
    const g = new THREE.Group();
    const R = seeded(23);
    // epidermis del cáliz con células abombadas
    const surf = new THREE.PlaneGeometry(6, 6, 220, 220);
    surf.rotateX(-Math.PI / 2);
    const sp = surf.attributes.position;
    const col = new Float32Array(sp.count * 3);
    for (let i = 0; i < sp.count; i++) {
      const x = sp.getX(i), z = sp.getZ(i);
      const cx = Math.sin(x * 9.1 + Math.sin(z * 3.3)) * Math.sin(z * 8.7 + Math.sin(x * 2.9));
      const y = 0.035 * Math.abs(cx) + 0.12 * Math.sin(x * 0.9) * Math.cos(z * 0.7);
      sp.setY(i, y);
      const k = 0.75 + 0.25 * Math.abs(cx);
      col[i * 3] = 0.36 * k; col[i * 3 + 1] = 0.58 * k; col[i * 3 + 2] = 0.24 * k;
    }
    surf.setAttribute('color', new THREE.BufferAttribute(col, 3));
    surf.computeVertexNormals();
    const ground = new THREE.Mesh(surf, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, sheen: 0.5, sheenColor: new THREE.Color(0xcfe9b8), clearcoat: 0.3 }));
    g.add(ground);
    const groundY = (x, z) => 0.035 * Math.abs(Math.sin(x * 9.1 + Math.sin(z * 3.3)) * Math.sin(z * 8.7 + Math.sin(x * 2.9))) + 0.12 * Math.sin(x * 0.9) * Math.cos(z * 0.7);

    // tricomas capitados pedunculados: tallo de células apiladas + disco secretor + cabeza de resina
    const N = 150;
    const cellG = new THREE.CapsuleGeometry(0.5, 0.7, 4, 12);
    const cells = new THREE.InstancedMesh(cellG, new THREE.MeshPhysicalMaterial({ color: 0xa9bf96, roughness: 0.38, clearcoat: 0.4, sheen: 0.3, sheenColor: new THREE.Color(0xe6f5d8) }), N * 6);
    const disc = new THREE.InstancedMesh(cellG, new THREE.MeshStandardMaterial({ color: 0x9fcf6a, roughness: 0.4, emissive: 0x1a2a08 }), N * 8);
    const headMats = {
      // vidrio de resina: transparente con reflejos; lechosa opaca; ámbar como miel
      clear: new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, roughness: 0.03, transparent: true, opacity: 0.3, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 2.2, iridescence: 0.35, depthWrite: false }),
      cloudy: new THREE.MeshPhysicalMaterial({ color: 0xbdbdb4, roughness: 0.34, clearcoat: 0.45, sheen: 0.25, sheenColor: new THREE.Color(0xf4f4ee), envMapIntensity: 0.8 }),
      amber: new THREE.MeshPhysicalMaterial({ color: 0xd9822a, roughness: 0.1, transparent: true, opacity: 0.88, clearcoat: 1, envMapIntensity: 1.8, emissive: 0x2a1000 }),
    };
    const headG = new THREE.SphereGeometry(1, 40, 28);
    const heads = { clear: new THREE.InstancedMesh(headG, headMats.clear, N), cloudy: new THREE.InstancedMesh(headG, headMats.cloudy, N), amber: new THREE.InstancedMesh(headG, headMats.amber, N) };
    // pelos cistolíticos (no glandulares)
    const hair = new THREE.InstancedMesh(new THREE.ConeGeometry(0.02, 0.32, 8).translate(0, 0.16, 0), new THREE.MeshStandardMaterial({ color: 0xf1f4ea, roughness: 0.3 }), 90);
    // tricomas bulbosos chiquitos
    const bulb = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), headMats.clear, 160);
    g.add(cells, disc, heads.clear, heads.cloudy, heads.amber, hair, bulb);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const plan = [];
    for (let i = 0; i < N; i++) {
      const hero = i === 0;
      const x = hero ? 0 : (R() - 0.5) * 5.2, z = hero ? 0 : (R() - 0.5) * 5.2;
      // el lado de la cámara queda despejado para ver el tricoma principal
      if (!hero && (Math.hypot(x, z) < 0.38 || x * 0.48 + z * 0.88 > 0.25)) { i--; continue; }
      const lean = new THREE.Vector3((R() - 0.5) * 0.45, 1, (R() - 0.5) * 0.45).normalize();
      plan.push({ x, z, lean, h: hero ? 0.62 : 0.4 + R() * 0.35, hr: hero ? 0.2 : 0.13 + R() * 0.06, r: R() });
    }
    const counts = { clear: 0, cloudy: 0, amber: 0 };
    let nc = 0, nd = 0;
    for (const t of plan) {
      const base = new THREE.Vector3(t.x, groundY(t.x, t.z) - 0.01, t.z);
      q.setFromUnitVectors(up, t.lean);
      const ncell = 5;
      for (let k = 0; k < ncell; k++) {
        p.copy(base).addScaledVector(t.lean, ((k + 0.5) / ncell) * t.h);
        const w = 0.085 - k * 0.006;
        m.compose(p, q, s.set(w, t.h / ncell / 1.55, w));
        cells.setMatrixAt(nc++, m);
      }
      const top = base.clone().addScaledVector(t.lean, t.h);
      // disco de 8 células secretoras debajo de la cabeza
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const off = new THREE.Vector3(Math.cos(a) * t.hr * 0.42, t.hr * 0.18, Math.sin(a) * t.hr * 0.42).applyQuaternion(q);
        m.compose(p.copy(top).add(off), q, s.set(t.hr * 0.2, t.hr * 0.1, t.hr * 0.2));
        disc.setMatrixAt(nd++, m);
      }
      t.head = top.clone().addScaledVector(t.lean, t.hr * 0.85);
      t.q = q.clone();
    }
    cells.count = nc; disc.count = nd;
    for (let i = 0; i < 90; i++) {
      const x = (R() - 0.5) * 5.4, z = (R() - 0.5) * 5.4;
      q.setFromUnitVectors(up, new THREE.Vector3((R() - 0.5) * 1.6, 1, (R() - 0.5) * 1.6).normalize());
      m.compose(p.set(x, groundY(x, z), z), q, s.set(1, 0.6 + R() * 0.8, 1));
      hair.setMatrixAt(i, m);
    }
    for (let i = 0; i < 160; i++) {
      const x = (R() - 0.5) * 5.6, z = (R() - 0.5) * 5.6, r = 0.025 + R() * 0.02;
      m.compose(p.set(x, groundY(x, z) + r * 0.6, z), q.identity(), s.set(r, r, r));
      bulb.setMatrixAt(i, m);
    }
    function paint() {
      const T = data.tri;
      counts.clear = counts.cloudy = counts.amber = 0;
      for (const t of plan) {
        const kind = t === plan[0] ? (T.amber > 0.3 ? 'amber' : T.cloudy > 0.35 ? 'cloudy' : 'clear') : t.r < T.amber ? 'amber' : t.r < T.amber + T.cloudy ? 'cloudy' : 'clear';
        m.compose(t.head, t.q, s.set(t.hr, t.hr * 0.92, t.hr));
        heads[kind].setMatrixAt(counts[kind]++, m);
      }
      for (const k in heads) { heads[k].count = counts[k]; heads[k].instanceMatrix.needsUpdate = true; }
    }
    paint();
    g.userData.paint = paint;
    g.userData.target = new THREE.Vector3(0, 0.55, 0);
    groups.push(g);
    updaters.push(() => {});
  }

  /* moléculas reutilizables */
  function moleculeMesh(kind, detail = 18) {
    const M = MOLECULES[kind];
    const grp = new THREE.Group();
    const c = new THREE.Vector3();
    for (const a of M.atoms) c.add(new THREE.Vector3(a[1], a[2], a[3]));
    c.divideScalar(M.atoms.length);
    const sph = new THREE.SphereGeometry(1, detail, Math.round(detail * 0.75));
    const byEl = {};
    for (const a of M.atoms) (byEl[a[0]] ||= []).push(a);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const atomMeshes = [];
    for (const el in byEl) {
      const im = new THREE.InstancedMesh(sph, new THREE.MeshPhysicalMaterial({ color: CPK[el], roughness: el === 'C' ? 0.35 : 0.2, clearcoat: 0.8, clearcoatRoughness: 0.15, metalness: el === 'C' ? 0.15 : 0 }), byEl[el].length);
      byEl[el].forEach((a, i) => { const r = RADIUS[el]; m.compose(p.set(a[1], a[2], a[3]).sub(c), q, s.set(r, r, r)); im.setMatrixAt(i, m); });
      im.userData.el = el;
      im.userData.atoms = byEl[el];
      grp.add(im);
      atomMeshes.push(im);
    }
    const nb = M.bonds.reduce((n, b) => n + b[2], 0);
    const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
    const bonds = new THREE.InstancedMesh(cyl, new THREE.MeshStandardMaterial({ color: 0xb9c2c9, roughness: 0.35, metalness: 0.3 }), nb);
    let bi = 0;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3();
    for (const [i, j, o] of M.bonds) {
      A.set(M.atoms[i][1], M.atoms[i][2], M.atoms[i][3]).sub(c);
      B.set(M.atoms[j][1], M.atoms[j][2], M.atoms[j][3]).sub(c);
      dir.subVectors(B, A);
      const L = dir.length();
      q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      side.set(1, 0, 0).applyQuaternion(q).multiplyScalar(0.11);
      for (let k = 0; k < o; k++) {
        const off = o === 1 ? 0 : k - (o - 1) / 2;
        p.addVectors(A, B).multiplyScalar(0.5).addScaledVector(side, off);
        m.compose(p, q, s.set(o === 1 ? 0.075 : 0.05, L, o === 1 ? 0.075 : 0.05));
        bonds.setMatrixAt(bi++, m);
      }
    }
    grp.add(bonds);
    grp.userData.atomMeshes = atomMeshes;
    grp.userData.center = c;
    return grp;
  }

  /* ===================== nivel 2: dentro de la resina ===================== */
  {
    const g = new THREE.Group();
    const R = seeded(31);
    const kinds = { thc: moleculeMesh('thc', 8), cbd: moleculeMesh('cbd', 8), cbn: moleculeMesh('cbn', 8) };
    const swarm = [];
    for (let i = 0; i < 70; i++) {
      const proto = kinds.thc;
      const mol = proto.clone();
      mol.scale.setScalar(0.036);
      // flotan en una cáscara alrededor del recorrido de la cámara
      mol.position.set(R() - 0.5, (R() - 0.5) * 0.8, R() - 0.5).normalize().multiplyScalar(1.1 + R() * 2.2);
      mol.rotation.set(R() * 6, R() * 6, R() * 6);
      mol.userData.spin = new THREE.Vector3((R() - 0.5) * 0.6, (R() - 0.5) * 0.6, (R() - 0.5) * 0.6);
      mol.userData.drift = new THREE.Vector3((R() - 0.5) * 0.05, (R() - 0.5) * 0.04, (R() - 0.5) * 0.05);
      mol.userData.r = R();
      g.add(mol);
      swarm.push(mol);
    }
    // gotitas de terpenos (aceites volátiles) como burbujas brillantes
    const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshPhysicalMaterial({ color: 0xfff0c8, roughness: 0, transmission: 1, thickness: 0.4, ior: 1.47, iridescence: 0.6 }), 60);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = 0; i < 60; i++) { const r = 0.015 + R() * 0.045; drops.setMatrixAt(i, m.compose(p.set(R() - 0.5, R() - 0.5, R() - 0.5).normalize().multiplyScalar(1 + R() * 2.4), q, s.set(r, r, r))); }
    g.add(drops);
    let lastMix = '';
    function paint() {
      // en la resina madura parte del THC ya se oxidó a CBN; los quimiotipos CBD tienen CBD
      const amber = data.tri.amber, main = data.chemo === 'cbd' ? 'cbd' : 'thc';
      const mix = `${main}|${Math.round(amber * 20)}|${data.chemo}`;
      if (mix === lastMix) return;
      lastMix = mix;
      for (const mol of swarm) {
        const r = mol.userData.r;
        let want = main;
        if (data.chemo === 'mix') want = r < 0.5 ? 'thc' : 'cbd';
        if (r > 1 - amber * 0.6) want = 'cbn';
        if (mol.userData.kind === want) continue;
        mol.userData.kind = want;
        const src = kinds[want];
        mol.clear();
        for (const ch of src.children) mol.add(ch.clone());
      }
    }
    paint();
    g.userData.paint = paint;
    groups.push(g);
    updaters.push((dt) => {
      for (const mol of swarm) {
        mol.rotation.x += mol.userData.spin.x * dt; mol.rotation.y += mol.userData.spin.y * dt; mol.rotation.z += mol.userData.spin.z * dt;
        mol.position.addScaledVector(mol.userData.drift, dt);
        const r = mol.position.length();
        if (r > 3.4 || r < 0.95) mol.userData.drift.reflect(mol.position.clone().normalize());
      }
    });
  }

  /* ===================== nivel 3: molécula ===================== */
  let heroMol = null;
  {
    const g = new THREE.Group();
    g.userData.paint = () => {
      const want = data.chemo === 'cbd' ? 'cbd' : data.tri.amber > 0.45 ? 'cbn' : 'thc';
      if (heroMol && heroMol.userData.kind === want) return;
      if (heroMol) g.remove(heroMol);
      heroMol = moleculeMesh(want, 28);
      heroMol.userData.kind = want;
      heroMol.scale.setScalar(0.12);
      // una capa tenue de densidad electrónica sobre cada átomo
      const shell = cloudMaterial(0x7fd3ff, 3.0, 0.22);
      const halo = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), shell, MOLECULES[want].atoms.length);
      const mm = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      MOLECULES[want].atoms.forEach((a, i) => { const r = RADIUS[a[0]] * 2.4; halo.setMatrixAt(i, mm.compose(p.set(a[1], a[2], a[3]).sub(heroMol.userData.center), q, s.set(r, r, r))); });
      halo.userData.shell = shell;
      heroMol.add(halo);
      heroMol.userData.halo = halo;
      g.add(heroMol);
    };
    g.userData.paint();
    groups.push(g);
    updaters.push((dt, t) => { if (heroMol) { heroMol.rotation.y += dt * 0.12; heroMol.userData.halo.userData.shell.uniforms.uTime.value = t; } });
  }

  /* ===================== nivel 4: átomo de carbono ===================== */
  {
    const g = new THREE.Group();
    const R = seeded(7);
    // núcleo: 6 protones y 6 neutrones (dibujado ~10⁴ veces más grande de lo real)
    const nuc = new THREE.Group();
    const pm = new THREE.MeshPhysicalMaterial({ color: 0xff5a4a, roughness: 0.3, clearcoat: 1, emissive: 0x3a0804 });
    const nm = new THREE.MeshPhysicalMaterial({ color: 0x9aa6b4, roughness: 0.35, clearcoat: 1 });
    const sg = new THREE.SphereGeometry(0.05, 24, 18);
    const pts = [];
    while (pts.length < 12) {
      const v = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize().multiplyScalar(0.055 * Math.cbrt(R()) * 1.4);
      if (pts.every((u) => u.distanceTo(v) > 0.055)) pts.push(v);
    }
    pts.forEach((v, i) => { const b = new THREE.Mesh(sg, i % 2 ? nm : pm); b.position.copy(v); nuc.add(b); });
    g.add(nuc);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), cloudMaterial(0xffb08a, 1.5, 0.5));
    g.add(glow);
    // orbitales: 1s, 2s y tres 2p (dos lóbulos cada uno)
    const orb = [];
    const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.28, 40, 30), cloudMaterial(0x6fe0ff, 1.4, 0.55));
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.85, 48, 36), cloudMaterial(0x4f9dff, 2.6, 0.35));
    g.add(s1, s2); orb.push(s1, s2);
    const lobeG = new THREE.SphereGeometry(0.42, 40, 30);
    lobeG.scale(0.62, 1, 0.62);
    const pCols = [0x9b7bff, 0x6dffb0, 0xffd36b];
    const axes = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
    axes.forEach((ax, k) => {
      for (const sgn of [1, -1]) {
        const lobe = new THREE.Mesh(lobeG, cloudMaterial(pCols[k], 1.8, 0.42));
        lobe.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax.clone().multiplyScalar(sgn));
        lobe.position.copy(ax).multiplyScalar(0.46 * sgn);
        g.add(lobe); orb.push(lobe);
      }
    });
    // 6 electrones: aparecen donde la probabilidad los pone, cuadro a cuadro
    const eN = 6, trail = 40;
    const ePos = new Float32Array(eN * trail * 3), eCol = new Float32Array(eN * trail * 3);
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute('position', new THREE.BufferAttribute(ePos, 3));
    eGeo.setAttribute('color', new THREE.BufferAttribute(eCol, 3));
    const sprite = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(150,220,255,0.6)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    const electrons = new THREE.Points(eGeo, new THREE.PointsMaterial({ size: 0.07, map: sprite, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.add(electrons);
    let eHead = 0;
    const sample = (k) => {
      // 2 electrones en 1s, 2 en 2s, 2 en orbitales 2p
      const v = new THREE.Vector3(R() - 0.5, R() - 0.5, R() - 0.5).normalize();
      if (k < 2) return v.multiplyScalar(0.28 * -Math.log(1 - R() * 0.95) * 0.6);
      if (k < 4) return v.multiplyScalar(0.55 + R() * 0.45);
      const ax = axes[k - 4], sgn = R() < 0.5 ? 1 : -1;
      return ax.clone().multiplyScalar(sgn * (0.2 + R() * 0.65)).add(v.multiplyScalar(0.22 * R()));
    };
    groups.push(g);
    updaters.push((dt, t) => {
      for (const o of orb) o.material.uniforms.uTime.value = t;
      glow.material.uniforms.uTime.value = t;
      nuc.rotation.y += dt * 0.4; nuc.rotation.x += dt * 0.17;
      for (let k = 0; k < eN; k++) {
        const v = sample(k), o = (k * trail + eHead) * 3;
        ePos[o] = v.x; ePos[o + 1] = v.y; ePos[o + 2] = v.z;
      }
      eHead = (eHead + 1) % trail;
      for (let k = 0; k < eN; k++) for (let j = 0; j < trail; j++) {
        const age = ((eHead - 1 - j + trail) % trail) / trail, o = (k * trail + j) * 3, a = Math.pow(1 - age, 3);
        eCol[o] = 0.7 * a; eCol[o + 1] = 0.9 * a; eCol[o + 2] = 1.0 * a;
      }
      eGeo.attributes.position.needsUpdate = true;
      eGeo.attributes.color.needsUpdate = true;
    });
  }

  for (const g of groups) { g.visible = false; scene.add(g); }

  /* ---------------- interfaz ---------------- */
  const ui = document.createElement('div');
  ui.id = 'macro';
  ui.className = 'hidden';
  ui.innerHTML = `
    <div class="m-flash"></div>
    <div class="m-top"><div class="m-title"><small>Microscopio</small><b id="mLevel">Cogollo</b></div><button id="mExit" title="Salir (Esc)">✕ Salir</button></div>
    <ol class="m-levels">${LEVELS.map((L, i) => `<li data-i="${i}"><i></i><span>${L.name}</span></li>`).join('')}</ol>
    <div class="m-cap" id="mCap"></div>
    <div class="m-bottom"><div class="m-scale"><i></i><span id="mScale">1 cm</span></div>
      <div class="m-zoom"><button id="mOut" title="Alejar">－</button><input type="range" id="mZoom" min="0" max="4.99" step="0.01" value="0"><button id="mIn" title="Acercar">＋</button></div>
      <div class="m-hint">Rueda o pellizco para acercar · arrastrá para girar</div></div>
    <div class="m-tip hidden" id="mTip"></div>`;
  root.append(ui);
  const $ = (id) => ui.querySelector('#' + id);
  const zoomEl = $('mZoom');

  const st = { active: false, zoom: 0, shown: 0, level: -1, swapping: false, zoomAnim: null, t: 0 };
  const target = new THREE.Vector3();

  function caption(i) {
    const T = data.tri, pct = (x) => `${Math.round(x * 100)} %`;
    const main = NAMES[data.chemo === 'cbd' ? 'cbd' : 'thc'];
    const notFlower = !data.flower ? '<p class="warn">La planta todavía no florece: esto es lo que vas a ver cuando lo haga.</p>' : data.male ? '<p class="warn">Es macho: no forma cogollos con resina, solo sacos de polen.</p>' : '';
    return [
      `<h4>Cogollo: cálices, pistilos y escarcha</h4><p>Cada "bolita" es un <b>cáliz</b> que envuelve un óvulo; los pelos son <b>pistilos</b> (${pct(data.pist)} ya marrones u naranjas). La escarcha son miles de <b>tricomas</b>: ${pct(T.clear)} transparentes, ${pct(T.cloudy)} lechosos, ${pct(T.amber)} ámbar.</p>${notFlower}`,
      `<h4>Tricomas capitados pedunculados</h4><p>Un tallo de células sostiene un <b>disco de 8 células secretoras</b> que llenan de resina la cabeza (~0,1 mm). Transparente = inmadura; <b>lechosa</b> = pico de cannabinoides; <b>ámbar</b> = el THC empieza a oxidarse a CBN. Los pelos puntiagudos son cistolíticos: no producen resina.</p>`,
      `<h4>La resina por dentro</h4><p>Un aceite con cannabinoides y terpenos disueltos. La planta los fabrica como ácidos (THCA, CBDA): se vuelven ${main} activo con calor (descarboxilación). Las moléculas marrones de más son CBN, que aumenta con la madurez y la oxidación.</p>`,
      `<h4>${NAMES[heroMol?.userData.kind || 'thc']} · ${FORMULA[heroMol?.userData.kind || 'thc']}</h4><p>Carbono en gris, hidrógeno en blanco, oxígeno en rojo. Las barras dobles son enlaces dobles. El anillo con el –OH (fenol) y la cola de cinco carbonos (pentilo) son las partes que encajan en el receptor CB1. Pasá el puntero por un átomo.</p>`,
      `<h4>Un átomo de carbono</h4><p>6 protones y 6 neutrones en el núcleo y 6 electrones alrededor: 2 en el orbital 1s, 2 en el 2s y 2 en los 2p (los lóbulos). Los electrones no giran en órbitas: aparecen donde la probabilidad los pone. El núcleo está dibujado unas 10.000 veces más grande: a escala real sería invisible.</p>`,
    ][i];
  }
  function setLevel(i) {
    groups.forEach((g, k) => { g.visible = k === i; });
    st.level = i;
    groups[i].userData.paint?.();
    $('mLevel').textContent = LEVELS[i].name;
    $('mCap').innerHTML = caption(i);
    ui.querySelectorAll('.m-levels li').forEach((li, k) => { li.classList.toggle('on', k === i); li.classList.toggle('done', k < i); });
    target.copy(groups[i].userData.target || new THREE.Vector3());
    controls.target.copy(target);
    // colores de fondo por nivel
    const pal = [[0x15201a, 0x050806, 0], [0x1d2a17, 0x060a05, 0], [0x7a4a14, 0x1c0e03, 1], [0x0f1a26, 0x020408, 0], [0x07101f, 0x000002, 0]][i];
    bgU.uTop.value.set(pal[0]); bgU.uBot.value.set(pal[1]); bgU.uFluid.value = pal[2];
    if (i === 2 && data.tri.amber < 0.2) { bgU.uTop.value.set(0x6d6a44); bgU.uBot.value.set(0x15140a); }
    scene.environmentIntensity = [0.3, 0.32, 0.45, 0.6, 0.6][i];
    // cada nivel arranca con la cámara un poco desde arriba
    const view = [new THREE.Vector3(0.5, 0.15, 1), new THREE.Vector3(0.55, 0.55, 1), new THREE.Vector3(0.3, 0.2, 1), new THREE.Vector3(0.4, 0.3, 1), new THREE.Vector3(0.3, 0.35, 1)][i].normalize();
    camera.position.copy(target).addScaledVector(view, LEVELS[i].far * 1.25);
    bloom.strength = [0.18, 0.08, 0.35, 0.18, 0.8][i];
    tip.classList.add('hidden');
  }
  // salto de nivel: destello, cambio de grupo y la cámara llega desde lejos
  function swapTo(i, dir) {
    st.swapping = true;
    const flash = ui.querySelector('.m-flash');
    createTimeline({ onComplete: () => { st.swapping = false; } })
      .add(flash, { opacity: [0, 1], scale: [0.4, 1.6], duration: 260, ease: 'inQuad', onComplete: () => { setLevel(i); } })
      .add(flash, { opacity: 0, scale: 2.4, duration: 520, ease: 'outQuad' });
    st.shown = dir > 0 ? i : i + 0.999;
  }
  function distFor(z) {
    const i = Math.min(4, Math.floor(z)), L = LEVELS[i];
    return L.far + (L.near - L.far) * smooth(z - i);
  }
  function scaleText(z) {
    const i = Math.min(4, Math.floor(z)), [a, b] = LEVELS[i].span, f = z - i;
    return fmtLen(a * Math.pow(b / a, f));
  }
  function setZoom(z, animated) {
    z = Math.min(4.99, Math.max(0, z));
    st.zoomAnim?.pause();
    if (animated) st.zoomAnim = animate(st, { zoom: z, duration: 900 + Math.abs(z - st.zoom) * 500, ease: 'inOutCubic' });
    else st.zoom = z;
  }

  ui.querySelectorAll('.m-levels li').forEach((li) => li.addEventListener('click', () => setZoom(+li.dataset.i + 0.35, true)));
  $('mIn').addEventListener('click', () => setZoom(st.zoom + 0.5, true));
  $('mOut').addEventListener('click', () => setZoom(st.zoom - 0.5, true));
  zoomEl.addEventListener('input', () => setZoom(+zoomEl.value));
  $('mExit').addEventListener('click', () => onExit());
  renderer.domElement.addEventListener('wheel', (e) => {
    if (!st.active) return;
    e.preventDefault();
    setZoom(st.zoom - e.deltaY * 0.0016);
  }, { passive: false });
  let pinch = null;
  renderer.domElement.addEventListener('touchmove', (e) => {
    if (!st.active || e.touches.length !== 2) { pinch = null; return; }
    const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    if (pinch) setZoom(st.zoom + (d - pinch) * 0.006);
    pinch = d;
  }, { passive: true });

  // átomos con nombre al pasar el puntero (nivel molécula)
  const tip = $('mTip');
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (!st.active || st.level !== 3 || !heroMol) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(heroMol.userData.atomMeshes, false)[0];
    if (!hit) { tip.classList.add('hidden'); return; }
    const el = hit.object.userData.el;
    tip.innerHTML = `<b>${ELEMENT[el]}</b> (${el})${el === 'O' ? ' · parte del –OH o del anillo de éter' : el === 'C' ? ' · esqueleto de la molécula' : ''}`;
    tip.style.left = e.clientX - r.left + 14 + 'px'; tip.style.top = e.clientY - r.top + 14 + 'px';
    tip.classList.remove('hidden');
  });

  function resize(w, h, pr) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
  }

  return {
    get active() { return st.active; },
    setData(d) {
      const prev = JSON.stringify([data.tri, data.pist, data.chemo, data.purple]);
      Object.assign(data, d);
      if (st.active && st.level >= 0 && JSON.stringify([data.tri, data.pist, data.chemo, data.purple]) !== prev) { groups[st.level].userData.paint?.(); $('mCap').innerHTML = caption(st.level); }
    },
    enter() {
      st.active = true;
      controls.enabled = true;
      ui.classList.remove('hidden');
      st.zoom = 0; st.shown = 0;
      setLevel(0);
      camera.position.set(1.2, 0.5, LEVELS[0].far + 2.5);
      controls.target.set(0, 0, 0);
      animate(ui, { opacity: [0, 1], duration: 600, ease: 'outQuad' });
      setZoom(0.25, true);
    },
    exit() {
      st.active = false;
      controls.enabled = false;
      ui.classList.add('hidden');
      tip.classList.add('hidden');
      st.zoomAnim?.pause();
    },
    resize,
    render(dt) {
      st.t += dt;
      bgU.uTime.value = st.t;
      // nivel según el zoom (con salto animado entre niveles)
      const want = Math.min(4, Math.floor(st.zoom));
      if (want !== st.level && !st.swapping) swapTo(want, want > st.level ? 1 : -1);
      zoomEl.value = st.zoom;
      $('mScale').textContent = scaleText(st.zoom);
      // la cámara se acerca manteniendo la dirección que eligió la persona
      const d = distFor(st.swapping ? st.shown : st.zoom);
      const dir = camera.position.clone().sub(controls.target);
      if (dir.lengthSq() < 1e-6) dir.set(0, 0.2, 1);
      dir.normalize();
      const cur = camera.position.distanceTo(controls.target);
      camera.position.copy(controls.target).addScaledVector(dir, cur + (d - cur) * Math.min(1, dt * 6));
      controls.update();
      if (st.level >= 0) updaters[st.level](dt, st.t);
      composer.render();
    },
  };
}
