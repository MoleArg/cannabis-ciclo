import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { animate, createTimeline, stagger } from 'animejs';
import { buildScene, SOIL_Y } from './tent.js';
import { Climate, ppfdGrid, stageFor, photoperiodFor, TENT } from './sim.js';
import { plantUniforms } from './plant.js';
import { createBeam, createDust, createBurst, createThermalMaterial, FilmShader, SPRITE } from './fx.js';
import { Soundscape } from './audio.js';
import { buildOutdoor } from './outdoor.js';
import { createMacro } from './macro.js';

const $ = (id) => document.getElementById(id);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ───────── renderer / scene ─────────
const canvas = $('scene');
// sin WebGL no hay carpa: se avisa en pantalla y a la plataforma, que vuelve al 2D
const tellParent = (msg) => { if (window.parent !== window) window.parent.postMessage(Object.assign({ source: 'indoor3d' }, msg), '*'); };
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 1.5, powerPreference: 'high-performance' });
} catch (e) {
  document.querySelector('.loader-text').textContent = 'Este navegador no tiene WebGL activado: activá la aceleración por hardware para ver la carpa en 3D.';
  tellParent({ type: 'unsupported', reason: String(e.message || e) });
  throw e;
}
{
  // WebGL por software: anda, pero muy lento
  const gl = renderer.getContext(), dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu)) tellParent({ type: 'slow', gpu });
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const BG = new THREE.Color(0x0e0f10);
scene.background = BG.clone();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.01, 40);
camera.position.set(4.2, 3.2, 4.6);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.target.set(0, 0.8, 0);
controls.minDistance = 0.08;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI * 0.94;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.26, 0.5, 0.97);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const film = new ShaderPass(FilmShader);
composer.addPass(film);

const macro = createMacro({ renderer, root: document.body, onExit: () => closeMacro() });
macro.resize(window.innerWidth, window.innerHeight, Math.min(window.devicePixelRatio, 1.5));
const refs = buildScene(scene);
// lo que forma la habitación y la carpa, para sacarlo cuando la planta está afuera
const indoorSet = scene.children.slice();
const outdoor = buildOutdoor(scene);
const plantGroups = new Set(refs.plants.map((p) => p.group));
const outSaved = {};
function applyOutdoorVisibility(on) {
  for (const o of indoorSet) if (o !== refs.tent) o.visible = !on;
  for (const c of refs.tent.children) if (c !== refs.potGroup && !plantGroups.has(c)) c.visible = !on;
  outdoor.group.visible = on;
}
function setOutdoor(on) {
  if (link.out === on) return;
  link.out = on;
  document.documentElement.classList.toggle('outdoor', on);
  deselect();
  // afuera no hay ventiladores, extractor ni humidificador
  const keys = ['clipFan', 'pcFans', 'humidifier', 'extractor', 'beam'];
  if (on) { for (const k of keys) outSaved[k] = state[k]; Object.assign(state, { clipFan: false, pcFans: false, humidifier: false, extractor: 0, beam: false }); }
  else Object.assign(state, outSaved);
  scene.background = on ? null : BG.clone();
  applyOutdoorVisibility(on);
  renderedDay = -1;
  goView(on ? 'exterior' : 'plantas');
}
for (const w of refs.walls) w.group.traverse((o) => { if (!o.userData.item) o.userData.item = 'carpa'; });
for (const p of refs.poles) p.userData.item = 'carpa';

// ───────── lights ─────────
const hemi = new THREE.HemisphereLight(0xfff6e8, 0x40342a, 0.4);
scene.add(hemi);
// ceiling lamp of the room (a spot, so it only needs one shadow pass)
const roomLamp = new THREE.SpotLight(0xffe2b8, 0, 9, Math.PI / 2.4, 0.9, 1.4);
roomLamp.position.set(0.9, 2.56, 1.3);
roomLamp.target.position.set(0.3, 0, 0.3);
roomLamp.castShadow = true;
roomLamp.shadow.mapSize.set(1024, 1024);
roomLamp.shadow.bias = -0.0015;
roomLamp.shadow.autoUpdate = false;
scene.add(roomLamp, roomLamp.target);
const lampFixture = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.05, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b8, emissiveIntensity: 0 }));
lampFixture.position.set(0.9, 2.575, 1.3);
scene.add(lampFixture);
// sun through the window
const sun = new THREE.DirectionalLight(0xfff4e0, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 12 });
sun.shadow.bias = -0.0008;
sun.target.position.set(0.9, 0, 0.6);
sun.shadow.autoUpdate = false;
scene.add(sun, sun.target);
// the LED: a shadowed spot plus a short-range bounce from the mylar
const spot = new THREE.SpotLight(0xfff3e4, 0, 3, Math.PI * 0.38, 0.9, 1.4);
spot.castShadow = true;
spot.shadow.mapSize.set(1024, 1024);
spot.shadow.bias = -0.0006;
spot.shadow.normalBias = 0.01;
spot.shadow.camera.near = 0.02;
spot.shadow.autoUpdate = false;
scene.add(spot, spot.target);
const bounce = new THREE.PointLight(0xf6f8ff, 0, 0.95, 1.5);
scene.add(bounce);

const SPECTRA = {
  full: { color: 0xfff1dc, name: 'Full spectrum 3500K' },
  cool: { color: 0xe4eeff, name: 'Frío 6500K' },
  warm: { color: 0xffcf95, name: 'Cálido 2700K' },
  blurple: { color: 0xd46bff, name: 'Blurple' },
};

// ───────── state ─────────
const state = {
  simMin: (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })(),
  speed: 60, autoGrow: false, day: 10, flip: 50, photo: 'auto', onHour: 6,
  lightH: 0.9, dim: 0.6, watts: 150, spectrum: 'full', beam: true,
  extractor: 0.5, clipFan: true, oscillate: true, pcFans: true, humidifier: true,
  airflow: false, parMap: false, roomT: 20, xray: true, labels: true,
  roomMode: 'auto', film: true, doorOpen: false, thermal: false, cine: false,
};
// Dentro de la plataforma (indoor.html?linked en un iframe) el simulador de la
// pestaña Simulador maneja el reloj, la edad de la planta y el clima.
// Con ?embed la carpa es la vista 3D de la escena del simulador: sin paneles
// propios, se maneja desde Ajustes y la plataforma marca la coreografía.
const Q = new URLSearchParams(location.search);
const EMBED = Q.has('embed') && window.parent !== window;
const LINKED = EMBED || (Q.has('linked') && window.parent !== window);
const link = { s: null, touched: 0, paused: EMBED, entered: false, lampCm: 0, fast: 0, out: false };
if (LINKED) document.documentElement.classList.add('linked');
if (EMBED) document.documentElement.classList.add('embed');
const light = { level: 0, target: 0 };
const ambient = { lamp: 0, day: 0 };
const climate = new Climate();
let Tmax = climate.T;
let ppfd = { avg: 0, max: 0, grid: null, res: 0 };
let canopyY = SOIL_Y;
let renderedDay = -1;
let lastPlantBuild = 0;
let timelapse = null;
let introRunning = false;
const audio = new Soundscape();

// ───────── FX objects ─────────
const beam = createBeam();
scene.add(beam);
const dust = createDust();
scene.add(dust);
const thermalMat = createThermalMaterial();
const bursts = [];

// ───────── PAR heatmap plane ─────────
const PAR_PX = 256;
const parCanvas = document.createElement('canvas');
parCanvas.width = parCanvas.height = PAR_PX;
const parTex = new THREE.CanvasTexture(parCanvas);
parTex.colorSpace = THREE.SRGBColorSpace;
const parPlane = new THREE.Mesh(new THREE.PlaneGeometry(TENT.w - 0.02, TENT.d - 0.02), new THREE.MeshBasicMaterial({ map: parTex, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
parPlane.rotation.x = -Math.PI / 2;
parPlane.visible = false;
parPlane.renderOrder = 4;
scene.add(parPlane);
const ramp = [[0, '#1b1f6b'], [0.17, '#2a6bd6'], [0.33, '#23c4a0'], [0.5, '#9be04a'], [0.67, '#ffd23f'], [0.83, '#ff7a2a'], [1, '#ff2a5c']].map(([t, c]) => [t, new THREE.Color(c)]);
function rampColor(t, out) {
  t = clamp01(t);
  for (let i = 1; i < ramp.length; i++) {
    if (t <= ramp[i][0]) return out.copy(ramp[i - 1][1]).lerp(ramp[i][1], (t - ramp[i - 1][0]) / (ramp[i][0] - ramp[i - 1][0]));
  }
  return out.copy(ramp[ramp.length - 1][1]);
}
const parSmall = document.createElement('canvas');
function drawPar() {
  const g = parCanvas.getContext('2d');
  const { res, grid } = ppfd;
  parSmall.width = parSmall.height = res;
  const sg = parSmall.getContext('2d');
  const img = sg.createImageData(res, res);
  const c = new THREE.Color();
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    rampColor(grid[j * res + i] / 1200, c);
    const k = ((res - 1 - j) * res + i) * 4;
    img.data[k] = c.r * 255; img.data[k + 1] = c.g * 255; img.data[k + 2] = c.b * 255; img.data[k + 3] = 215;
  }
  sg.putImageData(img, 0, 0);
  g.clearRect(0, 0, PAR_PX, PAR_PX);
  g.imageSmoothingEnabled = true;
  g.drawImage(parSmall, 0, 0, PAR_PX, PAR_PX);
  // 10 cm grid + readings so the map reads like a real PAR survey
  g.strokeStyle = 'rgba(255,255,255,0.25)';
  g.lineWidth = 1;
  for (let k = 1; k < 8; k++) {
    const p = (k / 8) * PAR_PX;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, PAR_PX); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(PAR_PX, p); g.stroke();
  }
  g.font = 'bold 15px ui-sans-serif, Arial';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (const fy of [0.17, 0.5, 0.83]) for (const fx of [0.17, 0.5, 0.83]) {
    const v = grid[Math.floor((1 - fy) * res) * res + Math.floor(fx * res)] || 0;
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText(Math.round(v), fx * PAR_PX + 1, fy * PAR_PX + 1);
    g.fillStyle = '#fff';
    g.fillText(Math.round(v), fx * PAR_PX, fy * PAR_PX);
  }
  parTex.needsUpdate = true;
}
function recomputeLight() {
  const ledY = SOIL_Y + state.lightH;
  ppfd = ppfdGrid({ ppf: state.watts * state.dim * 2.4, lightY: ledY - 0.015, canopyY, res: 48 });
  drawPar();
  parPlane.position.y = canopyY + 0.01;
}

// ───────── airflow + mist particles ─────────
const AIR_N = 520;
const airGeo = new THREE.BufferGeometry();
const airPos = new Float32Array(AIR_N * 3);
const airCol = new Float32Array(AIR_N * 3);
airGeo.setAttribute('position', new THREE.BufferAttribute(airPos, 3));
airGeo.setAttribute('color', new THREE.BufferAttribute(airCol, 3));
const airPts = new THREE.Points(airGeo, new THREE.PointsMaterial({ size: 0.016, map: SPRITE, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
airPts.visible = false;
airPts.frustumCulled = false;
scene.add(airPts);
const exPos = new THREE.Vector3(0, 1.33, -0.2);
const inlets = [
  { p: new THREE.Vector3(0.39, 0.55, 0.1), pc: true },
  { p: new THREE.Vector3(-0.39, 0.3, 0.26), pc: true },
  { p: new THREE.Vector3(0.4, 0.14, -0.29) },
  { p: new THREE.Vector3(-0.4, 0.14, 0.29) },
  { p: new THREE.Vector3(0.4, 0.13, 0.1) },
  { p: new THREE.Vector3(-0.4, 0.13, -0.1) },
];
const airPaths = inlets.map(({ p }) => new THREE.CatmullRomCurve3([
  p.clone(),
  p.clone().multiply(new THREE.Vector3(0.55, 1, 0.55)).add(new THREE.Vector3(0, 0.08, 0)),
  new THREE.Vector3(p.x * 0.2, 0.55, p.z * 0.2 + 0.05),
  new THREE.Vector3(-p.x * 0.25, 0.95, -p.z * 0.25),
  new THREE.Vector3(p.x * 0.1, 1.2, -0.12),
  exPos.clone(),
]));
const airP = Array.from({ length: AIR_N }, (_, i) => ({ path: i % airPaths.length, t: Math.random(), off: new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.06, (Math.random() - 0.5) * 0.12), sp: 0.6 + Math.random() * 0.8 }));
const cold = new THREE.Color(0x4fb6ff), hot = new THREE.Color(0xff8a3d), tmpC = new THREE.Color(), tmpV = new THREE.Vector3();

const MIST_N = 160;
const mistGeo = new THREE.BufferGeometry();
const mistPos = new Float32Array(MIST_N * 3);
const mistCol = new Float32Array(MIST_N * 3);
mistGeo.setAttribute('position', new THREE.BufferAttribute(mistPos, 3));
mistGeo.setAttribute('color', new THREE.BufferAttribute(mistCol, 3));
const mist = new THREE.Points(mistGeo, new THREE.PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: SPRITE }));
mist.frustumCulled = false;
scene.add(mist);
const mistP = Array.from({ length: MIST_N }, () => ({ life: Math.random(), v: new THREE.Vector3(), p: new THREE.Vector3() }));
function resetMist(m) {
  m.life = 0;
  m.v.set((Math.random() - 0.5) * 0.05, 0.08 + Math.random() * 0.06, (Math.random() - 0.5) * 0.05);
  m.p.copy(refs.humidifier.nozzle);
}
mistP.forEach((m) => { resetMist(m); m.life = Math.random(); });

// ───────── selection, pins, info card ─────────
const labelsEl = $('labels');
const pins = {};
for (const item of Object.values(refs.items)) {
  const el = document.createElement('div');
  el.className = 'pin';
  el.innerHTML = `<span class="p"></span><span class="t">${item.title}</span>`;
  el.addEventListener('click', (e) => { e.stopPropagation(); select(item.id, true); });
  labelsEl.appendChild(el);
  pins[item.id] = { el, occluded: false };
}
const selBox = new THREE.Box3Helper(new THREE.Box3(), 0x7ee36b);
selBox.material.transparent = true;
selBox.material.depthTest = false;
selBox.renderOrder = 10;
selBox.visible = false;
scene.add(selBox);
let selected = null;
let selPulse = null;

function anchorWorld(item, out = new THREE.Vector3()) {
  if (item.id === 'led') return refs.led.group.localToWorld(out.copy(item.anchor));
  if (item.id === 'plantas') return out.set(0.19, canopyY + 0.04, 0.19);
  return out.copy(item.anchor);
}

function select(id, fly = false) {
  const item = refs.items[id];
  if (!item || state.cine) return;
  selected = id;
  for (const [k, p] of Object.entries(pins)) p.el.classList.toggle('sel', k === id);
  const box = new THREE.Box3();
  if (id === 'plantas') for (const p of refs.plants) box.expandByObject(p.group);
  else box.setFromObject(item.object);
  if (box.isEmpty()) box.setFromCenterAndSize(anchorWorld(item), new THREE.Vector3(0.1, 0.1, 0.1));
  box.expandByScalar(0.01);
  selBox.box.copy(box);
  selBox.visible = true;
  selPulse?.pause();
  selPulse = animate(selBox.material, { opacity: [1, 0.25], duration: 700, loop: true, alternate: true, ease: 'inOutSine' });

  $('cardKind').textContent = item.kind;
  $('cardTitle').textContent = item.title;
  $('cardText').textContent = item.text;
  $('cardSpecs').innerHTML = item.specs.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  updateCardLive();
  const card = $('card');
  card.classList.remove('hidden');
  animate(card, { opacity: [0, 1], translateX: [40, 0], duration: 500, ease: 'outExpo' });
  if (item.specs.length) animate('#card dl dt, #card dl dd', { opacity: [0, 1], translateY: [6, 0], delay: stagger(25, { start: 120 }), duration: 400, ease: 'outQuad' });

  if (fly) {
    const target = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const dir = camera.position.clone().sub(controls.target).normalize();
    const inside = Math.abs(target.x) < 0.4 && Math.abs(target.z) < 0.4 && target.y < 1.6;
    if (inside && !state.xray && !state.doorOpen) setDoor(true);
    flyTo(target.clone().add(dir.multiplyScalar(Math.max(0.35, size * 1.4))), target, 1100);
  }
}

function deselect() {
  if (!selected) return;
  selected = null;
  selBox.visible = false;
  selPulse?.pause();
  for (const p of Object.values(pins)) p.el.classList.remove('sel');
  const card = $('card');
  animate(card, { opacity: [1, 0], translateX: [0, 30], duration: 260, ease: 'inQuad', onComplete: () => { if (!selected) card.classList.add('hidden'); } });
}
$('cardClose').addEventListener('click', deselect);

function totalWatts() {
  return Math.round(state.watts * state.dim * (light.level > 0.5 ? 1 : 0) + state.extractor * 35 + (state.clipFan ? 20 : 0) + (state.pcFans ? 4 : 0) + (state.humidifier ? 24 : 0));
}
function updateCardLive() {
  if (!selected) return;
  const ledY = SOIL_Y + state.lightH;
  const flowM3h = (0.004 + state.extractor * 0.04 + (state.pcFans ? 0.004 : 0)) * 3600;
  const stage = stageFor(state.day, state.flip);
  const photo = photoperiodFor(state.photo, state.day, state.flip);
  const plant = refs.plants[0];
  const map = {
    carpa: `Aire renovado cada <b>${Math.round(1.02 / (flowM3h / 3600))} s</b> · puerta ${state.doorOpen ? 'abierta' : 'cerrada'}.`,
    led: `${SPECTRA[state.spectrum].name} · altura <b>${Math.round(state.lightH * 100)} cm</b> sobre la tierra · ${Math.round(state.watts * state.dim)} W reales · PPFD medio <b>${Math.round(ppfd.avg * light.level)}</b>, pico ${Math.round(ppfd.max * light.level)} µmol/m²/s.`,
    extractor: `Caudal estimado <b>${Math.round(flowM3h)} m³/h</b> · ${(flowM3h / 60 / 1.02).toFixed(1)} renovaciones por minuto.`,
    clip: state.clipFan ? `Encendido${state.oscillate ? ', oscilando' : ', fijo'}. Mirá cómo se mueven las hojas.` : 'Apagado: atención a los microclimas bajo la luz.',
    coolers: state.pcFans ? 'Metiendo aire fresco por los laterales.' : 'Apagados: el aire entra solo por las ventanas pasivas.',
    humidificador: state.humidifier ? `Encendido · HR interior <b>${Math.round(climate.RH)} %</b> (objetivo ${stage.RH[0]}–${stage.RH[1]} %).` : `Apagado · HR interior <b>${Math.round(climate.RH)} %</b>.`,
    termo: `<b>${climate.T.toFixed(1)} °C</b> · <b>${Math.round(climate.RH)} %</b> · máx de hoy ${Tmax.toFixed(1)} °C · VPD ${climate.vpd.toFixed(2)} kPa.`,
    timer: `Fotoperiodo <b>${photo}/${24 - photo}</b> · enciende ${fmtH(state.onHour)} y apaga ${fmtH((state.onHour + photo) % 24)}.`,
    macetas: `Humedad del sustrato <b>${Math.round(climate.soil)} %</b>${climate.soil < 30 ? ' — toca regar.' : '.'}`,
    goteo: `Sustrato al <b>${Math.round(climate.soil)} %</b>. Probá el botón 💧 Regar (o la tecla R).`,
    plantas: `Día <b>${Math.floor(state.day)}</b> · ${stage.name} · altura ≈ <b>${Math.round(plant.height * 100)} cm</b> · ${Math.round((ledY - canopyY) * 100)} cm hasta la luz.`,
    ducto: `Expulsando ≈ ${Math.round(flowM3h)} m³/h.`,
    zapatilla: `Consumo actual estimado: <b>${totalWatts()} W</b> · ≈ ${(totalWatts() * 24 / 1000).toFixed(1)} kWh/día.`,
    ventanas: 'Entrada de aire pasiva; con la luz encendida se ve el resplandor desde afuera.',
  };
  if (LINKED && link.s) {
    const L = link.s;
    map.plantas = `${L.stageName} · día <b>${Math.floor(L.age)}</b> · altura <b>${Math.round(L.plant.height * 100)} cm</b> · salud <b>${L.health} %</b> · ${Math.round((ledY - canopyY) * 100)} cm hasta la luz.`;
    map.macetas = `Maceta de <b>${L.potL} L</b> · sustrato al <b>${Math.round(climate.soil)} %</b> de humedad.`;
  }
  $('cardLive').innerHTML = map[selected] || '';
}

// ───────── camera flights ─────────
let flight = null;
const camAnim = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
function applyCam() { camera.position.set(camAnim.px, camAnim.py, camAnim.pz); controls.target.set(camAnim.tx, camAnim.ty, camAnim.tz); }
function syncCamAnim() {
  Object.assign(camAnim, { px: camera.position.x, py: camera.position.y, pz: camera.position.z, tx: controls.target.x, ty: controls.target.y, tz: controls.target.z });
}
function flyTo(pos, target, duration = 1400) {
  flight?.pause();
  syncCamAnim();
  flight = animate(camAnim, { px: pos.x, py: pos.y, pz: pos.z, tx: target.x, ty: target.y, tz: target.z, duration, ease: 'inOutCubic', onUpdate: applyCam });
}
const VIEWS = {
  exterior: { pos: [1.95, 1.55, 2.35], target: [0, 0.78, 0] },
  frente: { pos: [0.08, 1.12, 1.5], target: [0, 0.62, 0], door: true },
  cenital: { pos: [0.02, 1.47, 0.3], target: [0, 0.25, -0.06] },
  techo: { pos: [0.05, 0.45, 0.28], target: [0, 1.6, -0.12] },
  plantas: { door: true },
};
function goView(name) {
  document.querySelectorAll('#views button').forEach((x) => x.classList.toggle('active', x.dataset.view === name));
  const v = VIEWS[name];
  if (v.door && !state.doorOpen) setDoor(true);
  let pos, t;
  if (name === 'plantas') {
    // frame the whole canopy: back off as the plants get taller
    const ph = canopyY - SOIL_Y;
    t = new THREE.Vector3(0, SOIL_Y + ph * 0.55 + 0.04, 0);
    pos = new THREE.Vector3(0.3 + ph * 0.35, SOIL_Y + ph * 0.75 + 0.25, 0.6 + ph * 0.9);
  } else {
    pos = new THREE.Vector3(...v.pos);
    t = new THREE.Vector3(...v.target);
  }
  flyTo(pos, t);
}
document.querySelectorAll('#views button').forEach((b) => b.addEventListener('click', () => goView(b.dataset.view)));

// ───────── door ─────────
function setDoor(open) {
  state.doorOpen = open;
  $('doorBtn').textContent = open ? '🚪 Cerrar puerta' : '🚪 Abrir puerta';
  $('doorBtn').classList.toggle('on', open);
  const d = refs.door;
  d.roll.visible = true;
  animate(d, {
    open: open ? 1 : 0, duration: 1300, ease: open ? 'inOutQuad' : 'outBounce',
    onUpdate: applyDoor,
    onComplete: () => { d.roll.visible = d.open > 0.02; },
  });
}
function applyDoor() {
  const d = refs.door;
  const s = 1 - d.open * 0.94;
  d.pivot.scale.y = s;
  const r = 0.012 + d.open * 0.03;
  d.roll.scale.set(r, 1, r);
  d.roll.position.y = 0.72 - d.height * s;
  d.roll.position.z = 0.012 + r;
}
$('doorBtn').addEventListener('click', () => setDoor(!state.doorOpen));

// ───────── light switching ─────────
const todMin = () => ((state.simMin % 1440) + 1440) % 1440;
function lightIsOn() {
  if (link.out) return false;
  const photo = photoperiodFor(state.photo, state.day, state.flip);
  const rel = (todMin() - state.onHour * 60 + 1440) % 1440;
  return rel < photo * 60;
}
let lightAnim = null;
function syncLight(force = false) {
  const on = lightIsOn() ? 1 : 0;
  if (on === light.target && !force) return;
  light.target = on;
  lightAnim?.pause();
  // a varios días por segundo las luces se prenden y apagan sin parpadeo ni clic
  const fast = LINKED && link.s && link.s.running && link.s.speed > 0.2;
  if (fast) force = true;
  else audio.click();
  if (on && !force) {
    // LED drivers strike with a short flicker before settling
    lightAnim = animate(light, {
      level: [{ to: 0.55, duration: 70 }, { to: 0.08, duration: 90 }, { to: 0.8, duration: 80 }, { to: 0.3, duration: 120 }, { to: 1, duration: 1400, ease: 'outQuart' }],
    });
  } else if (!force) {
    lightAnim = animate(light, { level: on, duration: 350, ease: 'outQuad' });
  } else {
    light.level = on;
  }
  $('lightBadge').classList.toggle('on', !!on);
  $('lightBadge').textContent = on ? 'LUZ ON' : 'LUZ OFF';
  if (on) Tmax = climate.T; // the daily max resets when the lights come on
}

function applyLight(t) {
  const L = light.level;
  const ledY = SOIL_Y + state.lightH;
  const k = state.dim * (state.watts / 150);
  const col = SPECTRA[state.spectrum].color;
  spot.color.set(col);
  spot.position.set(0, ledY - 0.02, 0);
  spot.target.position.set(0, 0, 0);
  spot.intensity = L * k * 6.5;
  bounce.color.set(col);
  bounce.position.set(0, ledY * 0.6, 0);
  bounce.intensity = L * k * 0.9;
  refs.led.strip.material.emissive.set(col);
  refs.led.dotMat.emissive.set(col);
  refs.led.strip.material.emissiveIntensity = L * (0.6 + k * 2.2);
  refs.led.dotMat.emissiveIntensity = L * (1.2 + k * 4);
  for (const w of refs.walls) { w.mats[1].emissive.set(col); w.mats[1].emissiveIntensity = L * k * 0.02; }
  const dark = 1 - Math.max(ambient.lamp, ambient.day) * 0.55;
  for (const l of refs.leaks) { l.mesh.material.color.set(col); l.mesh.material.opacity = L * l.k * Math.min(1, k + 0.3) * dark; }
  beam.visible = state.beam && !state.thermal && L > 0.01;
  beam.material.uniforms.uI.value = L * Math.min(1.4, 0.5 + k * 0.7);
  beam.material.uniforms.uColor.value.set(col);
  beam.material.uniforms.uTime.value = t;
  beam.position.set(0, ledY - 0.016, 0);
  beam.scale.y = ledY - 0.03;
}

// ───────── sun, sky and room lamp from the clock ─────────
const skyNight = [new THREE.Color(0x060a1c), new THREE.Color(0x141a36)];
const skyDay = [new THREE.Color(0x4f8fe0), new THREE.Color(0xd6eaff)];
const skyDusk = [new THREE.Color(0x3d4f8f), new THREE.Color(0xffa36b)];
const warmSun = new THREE.Color(0xffa860), whiteSun = new THREE.Color(0xfff2dc);
function updateDaylight(dt) {
  const f = LINKED ? link.fast : 0;
  const h = todMin() / 60 * (1 - f) + 12 * f;
  const elev = Math.sin(((h - 6) / 12) * Math.PI) * (1 - f) + 0.25 * f;
  const dayF = smoothstep(-0.08, 0.3, elev);
  const dusk = Math.exp(-Math.pow(elev / 0.2, 2)) * (h > 4 && h < 21 ? 1 : 0);
  const u = refs.sky.uniforms;
  u.uTop.value.copy(skyNight[0]).lerp(skyDay[0], dayF).lerp(skyDusk[0], dusk * 0.6);
  u.uBottom.value.copy(skyNight[1]).lerp(skyDay[1], dayF).lerp(skyDusk[1], dusk * 0.75);
  u.uSun.value.set(0.1 + clamp01((h - 6) / 12) * 0.8, 0.12 + Math.max(-0.2, elev) * 0.7);
  u.uSunI.value = smoothstep(-0.05, 0.08, elev);
  // aim the sun through the middle of the window so the patch of light walks across the floor
  const W = refs.window;
  const across = 0.5 - clamp01((h - 6) / 12);
  const winC = new THREE.Vector3(W.x, W.y, -0.8);
  const dir = new THREE.Vector3(across * 1.4, -(0.3 + Math.max(0, elev) * 0.95), 1).normalize();
  sun.position.copy(winC).addScaledVector(dir, -6);
  sun.target.position.copy(winC).addScaledVector(dir, 2.5);
  sun.intensity = 3.2 * smoothstep(0.0, 0.25, elev);
  sun.color.copy(warmSun).lerp(whiteSun, smoothstep(0.05, 0.5, elev));
  ambient.day = dayF;

  let lampOn;
  if (state.roomMode === 'on') lampOn = 1;
  else if (state.roomMode === 'off') lampOn = 0;
  else lampOn = dayF < 0.4 && (h >= 17 || h < 0.75) ? 1 : 0; // evenings only; late night stays dark
  if (f > 0.5) lampOn = 0.25;
  ambient.lamp += (lampOn - ambient.lamp) * Math.min(1, dt * 3);
  roomLamp.intensity = ambient.lamp * 16;
  lampFixture.material.emissiveIntensity = ambient.lamp * 2.5;
  hemi.intensity = 0.05 + dayF * 0.45 + ambient.lamp * 0.3;
  scene.environmentIntensity = 0.04 + Math.max(dayF, ambient.lamp) * 0.28;
}

// ───────── exterior: sol según la hora solar, la duración del día y las nubes ─────────
const grey = new THREE.Color(0x8d949c), greyDark = new THREE.Color(0x4a5058), tmpSky = new THREE.Color();
function updateOutdoor(dt) {
  const S = link.s?.sky || { dl: 12, cloud: 1, rain: false, lat: -34 };
  const f = link.fast;
  const h = todMin() / 60;
  const rise = 12 - S.dl / 2;
  const dayT = (h - rise) / S.dl;
  let elev = dayT >= 0 && dayT <= 1 ? Math.sin(Math.PI * dayT) : -0.35 * Math.sin(Math.PI * (((h - rise - S.dl + 24) % 24) / (24 - S.dl)));
  let across = Math.max(-1.2, Math.min(1.2, (h - 12) / (S.dl / 2)));
  elev = elev * (1 - f) + 0.32 * f;
  across *= 1 - f;
  const overcast = 1 - S.cloud; // 0 despejado … 0.68 lluvia
  const dayF = smoothstep(-0.08, 0.3, elev);
  const dusk = Math.exp(-Math.pow(elev / 0.2, 2)) * (dayT > -0.2 && dayT < 1.2 ? 1 : 0);
  const u = outdoor.sky;
  u.uTop.value.copy(skyNight[0]).lerp(skyDay[0], dayF).lerp(skyDusk[0], dusk * 0.6).lerp(tmpSky.copy(greyDark).lerp(grey, dayF), overcast * 1.2);
  u.uBottom.value.copy(skyNight[1]).lerp(skyDay[1], dayF).lerp(skyDusk[1], dusk * 0.75).lerp(tmpSky.copy(greyDark).lerp(grey, dayF), overcast);
  // el sol cruza por el norte en el hemisferio sur
  const north = S.lat < 0 ? -1 : 1;
  const dir = new THREE.Vector3(across * 0.9, Math.max(-0.3, elev) * 1.3 + 0.02, north * -0.55).normalize();
  u.uSunDir.value.copy(dir);
  u.uSunI.value = smoothstep(-0.05, 0.08, elev) * (1 - overcast * 1.3);
  sun.position.copy(dir).multiplyScalar(8);
  sun.target.position.set(0, 0.4, 0);
  sun.intensity = 4.2 * smoothstep(0.0, 0.25, elev) * (1 - overcast);
  sun.color.copy(warmSun).lerp(whiteSun, smoothstep(0.05, 0.5, elev));
  ambient.day = dayF; ambient.lamp = 0;
  roomLamp.intensity = 0;
  lampFixture.material.emissiveIntensity = 0;
  hemi.intensity = 0.06 + dayF * (1.1 + overcast * 0.8);
  scene.environmentIntensity = 0.03 + dayF * 0.5;
}

// ───────── walls x-ray ─────────
function updateWalls(dt) {
  const c = camera.position;
  const camInside = Math.abs(c.x) < TENT.w / 2 && Math.abs(c.z) < TENT.d / 2 && c.y < TENT.h && c.y > 0;
  for (const w of refs.walls) {
    if (w.noXray) continue;
    let outside;
    if (w.name === 'techo') outside = c.y > TENT.h;
    else outside = c.clone().sub(w.center).dot(w.normal) > 0;
    const seeThrough = state.xray && outside && !camInside;
    // the thermal override draws everything opaque, so hide the walls instead of fading them
    w.group.visible = !(state.thermal && seeThrough);
    const target = seeThrough ? 0.1 : 1;
    w.opacity += (target - w.opacity) * Math.min(1, dt * 6);
    if (Math.abs(target - w.opacity) < 0.002) w.opacity = target;
    for (const m of w.mats) {
      m.opacity = w.opacity;
      m.depthWrite = w.opacity > 0.95;
    }
  }
}

// ───────── plants ─────────
function rebuildPlants(force = false) {
  const now = performance.now();
  if (!force && !link.dirty && (Math.abs(renderedDay - state.day) < 0.05 || now - lastPlantBuild < 60)) return;
  link.dirty = false;
  lastPlantBuild = now;
  renderedDay = state.day;
  const maxH = state.lightH - 0.07;
  let top = 0;
  for (const p of refs.plants) {
    p.update(state.day, state.flip, maxH);
    top = Math.max(top, p.height);
  }
  canopyY = SOIL_Y + top;
  recomputeLight();
}

// ───────── watering ─────────
const dropGeo = new THREE.SphereGeometry(0.004, 6, 6);
const dropMat = new THREE.MeshStandardMaterial({ color: 0x9fd4ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 });
let watering = false;
function water(fromSim = false) {
  if (watering) return;
  watering = true;
  if (LINKED && fromSim !== true) window.parent.postMessage({ source: 'indoor3d', type: 'water' }, '*');
  const btn = $('water');
  btn.classList.add('on');
  animate(climate, { soil: 100, duration: 2600, ease: 'outQuad', onComplete: () => { btn.classList.remove('on'); watering = false; } });
  refs.soils.forEach((m) => animate(m.color, { r: 0.55, g: 0.5, b: 0.47, duration: 900, ease: 'outQuad' }));
  refs.drippers.forEach((base, pi) => {
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const d = new THREE.Mesh(dropGeo, dropMat);
      d.position.set(base.x + Math.cos(a) * 0.075, base.y + 0.01, base.z + Math.sin(a) * 0.075);
      d.scale.setScalar(0.01);
      scene.add(d);
      const delay = k * 60 + Math.random() * 400;
      if (k % 3 === 0) audio.drip((delay + 560) / 1000 + pi * 0.03);
      createTimeline({ delay, onComplete: () => scene.remove(d) })
        .add(d.scale, { x: 1, y: 1.4, z: 1, duration: 300, ease: 'outBack' })
        .add(d.position, { y: base.y, duration: 260, ease: 'inQuad' })
        .add(d.scale, { x: 2.4, y: 0.2, z: 2.4, duration: 300, ease: 'outQuad' }, '-=60');
    }
  });
}
$('water').addEventListener('click', () => water());
function soilColorFromMoisture() {
  const v = 1.05 - (climate.soil / 100) * 0.5;
  for (const m of refs.soils) {
    m.color.r += (v - m.color.r) * 0.02;
    m.color.g += (v * 0.93 - m.color.g) * 0.02;
    m.color.b += (v * 0.86 - m.color.b) * 0.02;
  }
}

// ───────── UI bindings ─────────
function paintRange(el) { el.style.setProperty('--p', ((el.value - el.min) / (el.max - el.min)) * 100 + '%'); }
const fmtH = (h) => `${String(h).padStart(2, '0')}:00`;
function bindRange(id, outId, fmt, onInput) {
  const el = $(id);
  const out = $(outId);
  const upd = () => { paintRange(el); out.textContent = fmt(+el.value); onInput(+el.value); };
  el.addEventListener('input', upd);
  paintRange(el);
  out.textContent = fmt(+el.value);
  return el;
}
let dayAnim = null;
const dayEl = bindRange('day', 'dayOut', (v) => Math.floor(v), (v) => { stopTimelapse(); dayAnim?.pause(); state.day = v; });
function showDay() {
  dayEl.value = state.day;
  paintRange(dayEl);
  $('dayOut').textContent = Math.floor(state.day);
}
const flipEl = bindRange('flip', 'flipOut', (v) => v, (v) => setFlip(v));
function setFlip(v) {
  v = Math.round(v);
  state.flip = v;
  flipEl.value = v; paintRange(flipEl); $('flipOut').textContent = v;
  dayEl.max = Math.max(120, v + 70);
  paintRange(dayEl);
  renderedDay = -1;
  layoutCycle();
}
bindRange('onHour', 'onHourOut', fmtH, (v) => { state.onHour = v; });
let heightAnim = null;
bindRange('lightHeight', 'heightOut', (v) => `${v} cm`, (v) => {
  heightAnim?.pause();
  heightAnim = animate(state, { lightH: v / 100, duration: 600, ease: 'outCubic', onUpdate: () => { refs.setLedY(SOIL_Y + state.lightH); renderedDay = -1; } });
});
bindRange('dim', 'dimOut', (v) => `${v}%`, (v) => { state.dim = v / 100; recomputeLight(); });
bindRange('watt', 'wattOut', (v) => `${v} W`, (v) => { state.watts = v; recomputeLight(); });
bindRange('extractor', 'extOut', (v) => `${v}%`, (v) => { state.extractor = v / 100; });
bindRange('roomT', 'roomTOut', (v) => `${v} °C`, (v) => { state.roomT = v; });
$('speed').addEventListener('change', (e) => { state.speed = +e.target.value; });
$('photoperiod').addEventListener('change', (e) => { state.photo = e.target.value; });
$('spectrum').addEventListener('change', (e) => { state.spectrum = e.target.value; });
$('roomLight').addEventListener('change', (e) => { state.roomMode = e.target.value; });
const bindCheck = (id, key, cb) => $(id).addEventListener('change', (e) => { state[key] = e.target.checked; cb?.(e.target.checked); });
bindCheck('autoGrow', 'autoGrow');
bindCheck('clipFan', 'clipFan');
bindCheck('oscillate', 'oscillate');
bindCheck('pcFans', 'pcFans');
bindCheck('beam', 'beam');
bindCheck('humidifier', 'humidifier', (on) => { refs.humidifier.led.visible = on; });
let airAnim = null;
bindCheck('airflow', 'airflow', (on) => {
  airPts.visible = true;
  airAnim?.pause();
  airAnim = animate(airPts.material, { opacity: on ? 0.9 : 0, duration: 500, onComplete: () => { airPts.visible = state.airflow; } });
});
let parAnim = null;
bindCheck('parMap', 'parMap', (on) => {
  parPlane.visible = true;
  $('parLegend').classList.toggle('hidden', !on);
  parAnim?.pause();
  parAnim = animate(parPlane.material, { opacity: on ? 0.85 : 0, duration: 500, onComplete: () => { parPlane.visible = state.parMap; } });
});
bindCheck('xray', 'xray');
bindCheck('labelsToggle', 'labels', (on) => labelsEl.classList.toggle('hidden', !on));
bindCheck('film', 'film', (on) => { film.enabled = on; });
$('panelToggle').addEventListener('click', () => $('panel').classList.toggle('collapsed'));
if (window.innerWidth < 900) $('panel').classList.add('collapsed');

function stopTimelapse() {
  if (!timelapse) return;
  timelapse.pause();
  timelapse = null;
  $('timelapse').textContent = '▶ Timelapse';
  $('timelapse').classList.remove('on');
}
function toggleTimelapse() {
  if (timelapse) return stopTimelapse();
  dayAnim?.pause();
  const end = state.flip + 63;
  if (state.day >= end - 1) state.day = 0;
  $('timelapse').textContent = '■ Detener';
  $('timelapse').classList.add('on');
  timelapse = animate(state, { day: end + 0.5, duration: (end - state.day) * 170, ease: 'linear', onUpdate: showDay, onComplete: stopTimelapse });
}
$('timelapse').addEventListener('click', toggleTimelapse);

// ───────── cycle timeline ─────────
function cycleTotal() { return Math.max(120, state.flip + 70); }
function layoutCycle() {
  const T = cycleTotal();
  const pct = (d) => `${(d / T) * 100}%`;
  $('segPlantula').style.width = pct(14);
  $('segVege').style.width = pct(Math.max(0, state.flip - 14));
  $('segFlora').style.width = pct(49);
  $('segFinal').style.width = pct(14);
  $('segPost').style.width = pct(Math.max(0, T - state.flip - 63));
  $('flipHandle').style.left = pct(state.flip);
  $('harvestMark').style.left = pct(state.flip + 63);
}
function updateCycleCursor() { $('cycleCursor').style.left = `${(state.day / cycleTotal()) * 100}%`; }
const track = $('cycleTrack');
track.addEventListener('click', (e) => {
  if (LINKED || e.target.closest('#flipHandle')) return;
  const r = track.getBoundingClientRect();
  const d = clamp01((e.clientX - r.left) / r.width) * cycleTotal();
  stopTimelapse();
  dayAnim?.pause();
  // the plants grow (or shrink back) to the chosen day
  dayAnim = animate(state, { day: d, duration: 1200, ease: 'inOutCubic', onUpdate: showDay });
});
{
  const h = $('flipHandle');
  let dragging = false;
  h.addEventListener('pointerdown', (e) => { dragging = true; h.setPointerCapture(e.pointerId); e.stopPropagation(); });
  h.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const r = track.getBoundingClientRect();
    setFlip(Math.round(Math.min(80, Math.max(20, ((e.clientX - r.left) / r.width) * cycleTotal()))));
  });
  h.addEventListener('pointerup', () => { dragging = false; });
}
layoutCycle();

// ───────── picking ─────────
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5 || state.cine || macro.active) return;
  const hit = pick(e.clientX, e.clientY);
  if (hit) select(hit); else deselect();
});
let hoverQueued = null;
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons || state.cine || macro.active) return;
  hoverQueued = [e.clientX, e.clientY];
});
function validHit(o) {
  if (o.isPoints || o === parPlane || o === beam || o.type === 'Box3Helper') return false;
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  return !mats.some((m) => m && m.transparent && m.opacity < 0.5);
}
const pickRoots = () => [refs.tent, ...scene.children.filter((c) => c !== refs.tent && c !== refs.room && !c.isLight)];
function pick(x, y) {
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  for (const h of ray.intersectObjects(pickRoots(), true)) {
    if (!validHit(h.object)) continue;
    return h.object.userData.item || null;
  }
  return null;
}

// pins fade when something solid stands between them and the camera
const pinIds = Object.keys(pins);
let pinCursor = 0;
const occV = new THREE.Vector3();
function checkOcclusion() {
  for (let n = 0; n < 2; n++) {
    const id = pinIds[pinCursor++ % pinIds.length];
    const w = anchorWorld(refs.items[id], occV);
    const dir = w.clone().sub(camera.position);
    const dist = dir.length();
    ray.set(camera.position, dir.normalize());
    ray.far = Math.max(0.01, dist - 0.03);
    let occ = false;
    for (const h of ray.intersectObjects(pickRoots(), true)) {
      if (!validHit(h.object) || h.object.userData.item === id) continue;
      occ = true;
      break;
    }
    ray.far = Infinity;
    if (occ !== pins[id].occluded) { pins[id].occluded = occ; pins[id].el.classList.toggle('occluded', occ); }
  }
}

// ───────── HUD + chart ─────────
const hudVals = { T: 0, RH: 0, VPD: 0, PPFD: 0, DLI: 0, Dist: 0, Soil: 0 };
function grade(v, [lo, hi]) {
  const span = hi - lo;
  if (v >= lo && v <= hi) return 'good';
  if (v >= lo - span * 0.5 && v <= hi + span * 0.5) return 'warn';
  return 'bad';
}
const setGrade = (id, cls) => { const el = $(id); if (!el.classList.contains(cls)) { el.classList.remove('good', 'warn', 'bad'); el.classList.add(cls); } };
function updateHud() {
  const stage = stageFor(state.day, state.flip);
  const photo = photoperiodFor(state.photo, state.day, state.flip);
  const dist = (SOIL_Y + state.lightH - canopyY) * 100;
  const dli = ppfd.avg * photo * 0.0036;
  animate(hudVals, {
    T: climate.T, RH: climate.RH, VPD: climate.vpd, PPFD: ppfd.avg * light.level, DLI: dli, Dist: dist, Soil: climate.soil,
    duration: 400, ease: 'outQuad',
    onUpdate: () => {
      $('vT').textContent = hudVals.T.toFixed(1);
      $('vRH').textContent = Math.round(hudVals.RH);
      $('vVPD').textContent = hudVals.VPD.toFixed(2);
      $('vPPFD').textContent = Math.round(hudVals.PPFD);
      $('vDLI').textContent = hudVals.DLI.toFixed(1);
      $('vDist').textContent = Math.round(hudVals.Dist);
      $('vSoil').textContent = Math.round(hudVals.Soil);
      $('soilBar').style.width = `${hudVals.Soil}%`;
    },
  });
  setGrade('stT', grade(climate.T, stage.T));
  setGrade('stRH', grade(climate.RH, stage.RH));
  setGrade('stVPD', grade(climate.vpd, stage.VPD));
  setGrade('stPPFD', light.level > 0.5 ? grade(ppfd.avg, stage.PPFD) : 'warn');
  const dliRange = { Plántula: [10, 20], Vegetativo: [20, 40], Floración: [30, 45], Maduración: [25, 40] }[stage.name];
  setGrade('stDLI', grade(dli, dliRange));
  setGrade('stDist', dist < 15 ? 'bad' : dist < 25 ? 'warn' : 'good');
  setGrade('stSoil', climate.soil < 20 ? 'bad' : climate.soil < 35 ? 'warn' : 'good');

  const alerts = [];
  if (dist < 15) alerts.push(['bad', 'La luz está muy cerca de las copas: riesgo de quemado. Subí la barra.']);
  if (climate.T > stage.T[1] + 2) alerts.push(['bad', `Hace calor (${climate.T.toFixed(1)} °C). Subí el extractor o bajá el dimmer.`]);
  if (climate.T < stage.T[0] - 2) alerts.push(['warn', `Está frío (${climate.T.toFixed(1)} °C).`]);
  if (climate.RH > stage.RH[1] + 8) alerts.push([stage.name === 'Floración' || stage.name === 'Maduración' ? 'bad' : 'warn', `Humedad alta (${Math.round(climate.RH)} %). ${state.humidifier ? 'Apagá el humidificador o ' : ''}subí la extracción.`]);
  if (climate.RH < stage.RH[0] - 8) alerts.push(['warn', `Humedad baja (${Math.round(climate.RH)} %) para ${stage.name.toLowerCase()}.${state.humidifier ? '' : ' Prendé el humidificador.'}`]);
  if (climate.soil < 25) alerts.push(['warn', 'El sustrato está seco: toca regar (tecla R).']);
  if (light.level > 0.5 && ppfd.max > 1300) alerts.push(['warn', `PPFD pico ${Math.round(ppfd.max)} µmol: puede estresar a las plantas.`]);
  if (!state.clipFan && light.level > 0.5) alerts.push(['warn', 'Sin ventilador interno: se forman bolsones de aire caliente.']);
  const html = alerts.slice(0, 3).map(([c, t]) => `<div class="alert ${c === 'bad' ? 'bad' : ''}">${t}</div>`).join('');
  const box = $('alerts');
  if (box.dataset.html !== html) {
    box.dataset.html = html;
    box.innerHTML = html;
    if (html) animate('#alerts .alert', { opacity: [0, 1], translateX: [20, 0], delay: stagger(60), duration: 400, ease: 'outQuad' });
  }
  $('stageLabel').textContent = LINKED && link.s ? link.s.stageName : stage.name;
  $('dayLabel').textContent = Math.floor(LINKED && link.s ? link.s.age : state.day);
  if (state.thermal) {
    const { uLo, uHi } = thermalMat.uniforms;
    document.querySelectorAll('#thermalLegend .ticks i').forEach((el, i) => { el.textContent = Math.round(uLo.value + ((uHi.value - uLo.value) * i) / 4); });
  }
  updateCardLive();
}

const history = [];
let lastSample = -Infinity;
function sampleHistory() {
  if (state.simMin - lastSample < 15) return;
  lastSample = state.simMin;
  history.push({ T: climate.T, RH: climate.RH, L: light.target });
  if (history.length > 96) history.shift();
}
const chart = $('chart');
function drawChart() {
  const g = chart.getContext('2d');
  const W = chart.width, H = chart.height;
  g.clearRect(0, 0, W, H);
  if (history.length < 2) return;
  const n = 96;
  const x = (i) => ((i + n - history.length) / (n - 1)) * W;
  // light-on periods as continuous bands
  g.fillStyle = 'rgba(255,226,120,0.13)';
  let start = -1;
  history.forEach((p, i) => {
    if (p.L && start < 0) start = i;
    if ((!p.L || i === history.length - 1) && start >= 0) { const end = p.L ? i : i - 1; g.fillRect(Math.floor(x(start)), 0, Math.ceil(x(end) - x(start)) + 1, H); start = -1; }
  });
  g.strokeStyle = 'rgba(255,255,255,0.06)';
  g.lineWidth = 1;
  for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(0, (k * H) / 4); g.lineTo(W, (k * H) / 4); g.stroke(); }
  const line = (key, lo, hi, color) => {
    g.beginPath();
    history.forEach((p, i) => { const y = H - ((p[key] - lo) / (hi - lo)) * H; i ? g.lineTo(x(i), y) : g.moveTo(x(i), y); });
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.stroke();
  };
  line('RH', 20, 100, '#5ab4ff');
  line('T', 12, 36, '#ff8a5b');
  const last = history[history.length - 1];
  g.font = 'bold 20px ui-sans-serif, Arial';
  g.textAlign = 'right';
  g.fillStyle = '#ff8a5b';
  g.fillText(`${last.T.toFixed(1)}°`, W - 6, 22);
  g.fillStyle = '#5ab4ff';
  g.fillText(`${Math.round(last.RH)}%`, W - 6, 46);
}

function updateClock() {
  const tod = Math.floor(todMin());
  const hh = String(Math.floor(tod / 60)).padStart(2, '0');
  const mm = String(tod % 60).padStart(2, '0');
  $('clockTime').textContent = `${hh}:${mm}`;
  const photo = photoperiodFor(state.photo, state.day, state.flip);
  refs.timerLcd.update({ time: `${hh}:${mm}`, on: light.target === 1, schedule: `${fmtH(state.onHour)} → ${fmtH((state.onHour + photo) % 24)}` });
  refs.thermoLcd.update({ T: climate.T, RH: climate.RH, Tmax });
}

// ───────── harvest ─────────
let prevDay = state.day;
let lastHarvest = 0;
function celebrate() {
  const now = performance.now();
  if (now - lastHarvest < 6000) return;
  lastHarvest = now;
  bursts.push(createBurst(scene, new THREE.Vector3(0, canopyY, 0)));
  audio.chime();
  const grams = Math.round(state.watts * state.dim * (0.4 + 0.8 * clamp01(ppfd.avg / 700)));
  const t = $('toast');
  t.innerHTML = `<h2>✂ ¡Cosecha!</h2><p>Día ${state.flip + 63} · 9 semanas de floración</p><p>Estimación orientativa: <b>≈ ${grams} g</b> secos entre las 4 plantas</p>`;
  t.classList.remove('hidden');
  createTimeline()
    .add(t, { opacity: [0, 1], scale: [0.6, 1], duration: 900, ease: 'outElastic(1, .6)' })
    .add(t, { opacity: 0, translateY: [0, -20], duration: 600, ease: 'inQuad', onComplete: () => { t.classList.add('hidden'); } }, '+=3600');
}

// ───────── thermal camera ─────────
function setThermal(on) {
  state.thermal = on;
  $('thermalBtn').classList.toggle('on', on);
  document.body.classList.toggle('thermal', on);
  $('thermalLegend').classList.toggle('hidden', !on);
  scene.overrideMaterial = on ? thermalMat : null;
  scene.background = on ? new THREE.Color(0x00000a) : BG.clone();
  bloom.enabled = !on && quality.pr > 0.6;
}
$('thermalBtn').addEventListener('click', () => setThermal(!state.thermal));

// ───────── sound ─────────
function toggleSound() {
  if (audio.on) audio.disable(); else audio.enable();
  $('soundBtn').textContent = audio.on ? '🔊' : '🔇';
  $('soundBtn').classList.toggle('on', audio.on);
}
$('soundBtn').addEventListener('click', toggleSound);

// ───────── cinema mode ─────────
let cineTl = null;
function caption(kicker, text) {
  const c = $('caption');
  c.innerHTML = `<small>${kicker}</small>${text}`;
  animate(c, { opacity: [0, 1], translateY: [12, 0], letterSpacing: ['0.3em', '0.08em'], duration: 1400, ease: 'outExpo' });
}
function startCine() {
  if (state.cine || introRunning) return;
  state.cine = true;
  deselect();
  stopTimelapse();
  document.body.classList.add('cine');
  controls.enabled = false;
  $('cineExit').classList.remove('hidden');
  animate('.letterbox', { height: ['0vh', '11vh'], duration: 1200, ease: 'inOutCubic' });
  const ledY = SOIL_Y + state.lightH;
  const cy = Math.max(canopyY, SOIL_Y + 0.08);
  const stage = stageFor(state.day, state.flip);
  const p3 = new THREE.Vector3(0.19, cy - 0.02, 0.19);
  const hhmm = `${String(Math.floor(todMin() / 60)).padStart(2, '0')}:${String(Math.floor(todMin() % 60)).padStart(2, '0')}`;
  const shots = [
    { from: [2.7, 0.6, 2.3], to: [1.1, 1.9, 2.8], t0: [0, 0.75, 0], t1: [0, 0.9, 0], d: 7500, k: 'Cultivarg 80 × 80 × 160', c: 'Mi indoor' },
    { from: [0.05, 1.05, 2.0], to: [0.02, 0.8, 0.62], t0: [0, 0.7, 0], t1: [0, 0.5, 0], d: 6500, door: true, k: 'Puerta en D', c: 'Adentro, todo es mylar' },
    { from: [0.34, cy + 0.2, 0.32], to: [-0.3, cy + 0.34, -0.22], t0: [0, cy - 0.1, 0], t1: [0, cy - 0.14, 0], d: 7500, k: `Día ${Math.floor(state.day)} · ${stage.name}`, c: 'Cuatro plantas, una copa pareja' },
    { from: [p3.x + 0.2, p3.y + 0.03, p3.z + 0.14], to: [p3.x - 0.04, p3.y + 0.08, p3.z + 0.22], t0: p3.toArray(), t1: [p3.x, p3.y + 0.02, p3.z], d: 6500, k: 'Primer plano', c: state.day > state.flip + 10 ? 'Cogollos formándose' : 'Hojas abiertas a la luz' },
    { from: [0.22, ledY - 0.5, 0.22], to: [-0.22, ledY - 0.42, 0.18], t0: [0, ledY, 0], t1: [0, ledY, -0.04], d: 6500, k: 'Barra LED · Philips', c: `${Math.round(state.watts * state.dim)} W · ${Math.round(ppfd.avg)} µmol/m²/s` },
    { from: [0.06, 0.45, 0.26], to: [-0.06, 0.52, 0.14], t0: [0, 1.6, -0.1], t1: [0.05, 1.6, -0.16], d: 6000, k: 'Techo', c: 'Extractor, sensores y riego' },
    { from: [0.7, 0.22, 1.1], to: [2.5, 1.45, 3.0], t0: [0, 0.55, 0], t1: [0, 0.85, 0], d: 8000, k: hhmm, c: 'Mientras tanto, crece' },
  ];
  flight?.pause();
  const o = { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 0 };
  cineTl = createTimeline({ loop: true });
  for (const s of shots) {
    cineTl.add(o, {
      px: [s.from[0], s.to[0]], py: [s.from[1], s.to[1]], pz: [s.from[2], s.to[2]],
      tx: [s.t0[0], s.t1[0]], ty: [s.t0[1], s.t1[1]], tz: [s.t0[2], s.t1[2]],
      duration: s.d, ease: 'inOutSine',
      onBegin: () => { caption(s.k, s.c); if (s.door && !state.doorOpen) setDoor(true); },
      onUpdate: () => { camera.position.set(o.px, o.py, o.pz); controls.target.set(o.tx, o.ty, o.tz); },
    });
  }
}
function stopCine() {
  if (!state.cine) return;
  state.cine = false;
  cineTl?.pause();
  document.body.classList.remove('cine');
  controls.enabled = true;
  $('cineExit').classList.add('hidden');
  animate('.letterbox', { height: '0vh', duration: 800, ease: 'inOutCubic' });
  animate('#caption', { opacity: 0, duration: 400 });
  goView('exterior');
}
$('cineBtn').addEventListener('click', () => (state.cine ? stopCine() : startCine()));
$('cineExit').addEventListener('click', stopCine);

// ───────── help + keyboard ─────────
const help = $('help');
$('helpBtn').addEventListener('click', () => help.classList.toggle('hidden'));
$('helpClose').addEventListener('click', () => help.classList.add('hidden'));
help.addEventListener('click', (e) => { if (e.target === help) help.classList.add('hidden'); });
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const views = ['exterior', 'frente', 'cenital', 'techo', 'plantas'];
  if (macro.active && k !== 'escape') return;
  if (k === 'z') { openMacro(); return; }
  if (k >= '1' && k <= '5' && !state.cine) goView(views[+k - 1]);
  else if (k === ' ') { e.preventDefault(); setDoor(!state.doorOpen); }
  else if (k === 'c') state.cine ? stopCine() : startCine();
  else if (k === 't') setThermal(!state.thermal);
  else if (k === 'm') toggleSound();
  else if (k === 'r') water();
  else if (k === 'p') toggleTimelapse();
  else if (k === 'h') document.body.classList.toggle('no-ui');
  else if (k === '?') help.classList.toggle('hidden');
  else if (k === 'escape') { if (macro.active) closeMacro(); else if (state.cine) stopCine(); else if (!help.classList.contains('hidden')) help.classList.add('hidden'); else deselect(); }
});

// ───────── per-frame ─────────
const timer = new THREE.Timer();
timer.connect(document);
let hudTimer = 0, lcdTimer = 0, chartTimer = 0, oscT = 0, elapsed = 0;
const tmpProj = new THREE.Vector3();
const clipSpinner = refs.spinners.find((s) => s.key === 'clip');

function stepSim(dtMin) {
  state.simMin += dtMin;
  if (!LINKED) climate.step(dtMin, {
    roomT: state.roomT, roomRH: 55, lightOn: light.level > 0.5, watts: state.watts, dim: state.dim,
    extractor: state.extractor, humidifier: state.humidifier, leafScale: refs.plants[0].leafScale,
    pcFans: state.pcFans, clipFan: state.clipFan,
  });
  Tmax = Math.max(Tmax, climate.T);
  sampleHistory();
}

// adaptive quality: drop the render resolution on slow machines, raise it back when there is headroom
const MAX_PR = Math.min(window.devicePixelRatio, 1.5);
const quality = { pr: MAX_PR, acc: 0, n: 0, good: 0 };
function setPixelRatio(pr) {
  quality.pr = pr;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
  composer.setSize(window.innerWidth, window.innerHeight);
}
function adaptQuality(realDt) {
  quality.acc += realDt;
  quality.n++;
  if (quality.acc < 2) return;
  const avg = quality.acc / quality.n;
  quality.acc = 0;
  quality.n = 0;
  if (avg > 0.03 && quality.pr > 0.6) { setPixelRatio(Math.max(0.6, quality.pr - 0.35)); quality.good = 0; }
  else if (avg > 0.03 && bloom.enabled && !state.thermal) bloom.enabled = false;
  else if (avg < 0.018 && quality.pr < MAX_PR && ++quality.good >= 3) { setPixelRatio(Math.min(MAX_PR, quality.pr + 0.25)); quality.good = 0; }
}

function frame() {
  timer.update();
  const realDt = timer.getDelta();
  if (link.paused) { requestAnimationFrame(frame); return; }
  if (document.visibilityState === 'visible') adaptQuality(realDt);
  const dt = Math.min(0.05, realDt);
  elapsed += dt;
  if (LINKED) applyLink();
  else stepSim((dt * state.speed) / 60);
  if (!LINKED && state.autoGrow && !timelapse) {
    state.day = Math.min(+dayEl.max, state.day + (dt * state.speed) / 60 / 1440);
    showDay();
  }
  if (!LINKED && !introRunning && prevDay < state.flip + 63 && state.day >= state.flip + 63) celebrate();
  prevDay = state.day;

  syncLight();
  if (LINKED && link.fast > 0.01) {
    const avg = link.out ? 0 : photoperiodFor(state.photo, state.day, state.flip) / 24;
    const want = light.target + (avg - light.target) * link.fast;
    light.level += (want - light.level) * Math.min(1, dt * 5);
  }
  applyLight(elapsed);
  if (link.out) updateOutdoor(dt); else updateDaylight(dt);
  rebuildPlants();
  soilColorFromMoisture();

  // fans
  for (const s of refs.spinners) {
    let k = 0;
    if (s.key === 'extractor') k = state.extractor;
    else if (s.key === 'clip') k = state.clipFan ? 1 : 0;
    else if (s.key === 'pc') k = state.pcFans ? 1 : 0;
    else if (s.key === 'led') k = light.level;
    s.vel = (s.vel || 0) + (k * s.speed - (s.vel || 0)) * Math.min(1, dt * 1.5);
    s.obj.rotation.z += s.vel * dt;
  }
  if (state.clipFan && state.oscillate) oscT += dt;
  const yaw = refs.clipFan.base + Math.sin(oscT * 0.7) * 0.6;
  refs.clipFan.neck.rotation.y = yaw;
  let wind = ((clipSpinner.vel || 0) / clipSpinner.speed) * (0.55 + 0.45 * Math.cos(Math.sin(oscT * 0.7) * 1.4)) + state.extractor * 0.15;
  if (link.out && link.s) wind = 0.25 + (link.s.airflow / 100) * 1.1 * (0.6 + 0.4 * Math.sin(elapsed * 0.9) * Math.sin(elapsed * 0.37));
  if (link.out) { applyOutdoorVisibility(true); outdoor.updateRain(dt, !!link.s?.sky?.rain, !!link.s?.sky?.cover, wind); outdoor.cover.visible = !!link.s?.sky?.cover; }
  plantUniforms.uTime.value = elapsed;
  plantUniforms.uWind.value = wind;
  audio.update(state, light.level, oscT * 0.7);

  // airflow
  if (state.thermal) airPts.visible = false;
  else if (state.airflow) airPts.visible = true;
  if (airPts.visible) {
    const sp = 0.05 + state.extractor * 0.35;
    for (let i = 0; i < AIR_N; i++) {
      const p = airP[i];
      const k = inlets[p.path].pc && !state.pcFans ? 0.3 : 1;
      p.t += dt * sp * p.sp * k * 0.4;
      if (p.t > 1) p.t -= 1;
      airPaths[p.path].getPointAt(p.t, tmpV);
      tmpV.addScaledVector(p.off, Math.sin(p.t * Math.PI));
      if (state.clipFan) {
        const push = Math.exp(-Math.pow((tmpV.y - 0.95) / 0.25, 2)) * 0.08;
        tmpV.x += Math.sin(yaw) * push; tmpV.z += Math.cos(yaw) * push;
      }
      airPos[i * 3] = tmpV.x; airPos[i * 3 + 1] = tmpV.y; airPos[i * 3 + 2] = tmpV.z;
      const heat = clamp01((tmpV.y - 0.2) / 1.2) * (0.3 + light.level * 0.7);
      tmpC.copy(cold).lerp(hot, heat).multiplyScalar(Math.sin(p.t * Math.PI) * 0.8 + 0.2);
      airCol[i * 3] = tmpC.r; airCol[i * 3 + 1] = tmpC.g; airCol[i * 3 + 2] = tmpC.b;
    }
    airGeo.attributes.position.needsUpdate = true;
    airGeo.attributes.color.needsUpdate = true;
  }

  // humidifier mist, pushed around by the clip fan
  mist.visible = !state.thermal;
  for (let i = 0; i < MIST_N; i++) {
    const m = mistP[i];
    m.life += dt * 0.45;
    if (m.life >= 1) { if (state.humidifier) resetMist(m); else m.life = 1; }
    m.p.addScaledVector(m.v, dt);
    m.v.multiplyScalar(1 - dt * 0.6);
    m.v.x += ((Math.random() - 0.5) * 0.05 + Math.sin(yaw) * wind * 0.02) * dt;
    m.v.z += ((Math.random() - 0.5) * 0.05 + Math.cos(yaw) * wind * 0.02) * dt;
    mistPos[i * 3] = m.p.x; mistPos[i * 3 + 1] = m.p.y; mistPos[i * 3 + 2] = m.p.z;
    const a = m.life >= 1 ? 0 : Math.sin(m.life * Math.PI) * 0.35;
    mistCol[i * 3] = a * 0.9; mistCol[i * 3 + 1] = a * 0.95; mistCol[i * 3 + 2] = a;
  }
  mistGeo.attributes.position.needsUpdate = true;
  mistGeo.attributes.color.needsUpdate = true;

  dust.visible = state.beam && !state.thermal && light.level > 0.01;
  if (dust.visible) dust.update(dt, elapsed, light.level, SOIL_Y + state.lightH, wind, yaw);
  parPlane.visible = state.parMap && !state.thermal ? true : parPlane.visible && !state.thermal && parPlane.material.opacity > 0.01;

  for (let i = bursts.length - 1; i >= 0; i--) if (!bursts[i].update(dt)) { scene.remove(bursts[i]); bursts.splice(i, 1); }

  if (state.thermal) {
    const u = thermalMat.uniforms;
    u.uRoom.value = state.roomT;
    u.uTent.value = climate.T;
    u.uLed.value.set(0, SOIL_Y + state.lightH + 0.03, 0);
    u.uLedHeat.value = light.level * state.dim * (state.watts / 150);
    // auto range like a handheld thermal camera: room is the cold end
    u.uLo.value = state.roomT - 1.5;
    u.uHi.value = Math.max(climate.T + 7, state.roomT + 10);
  }
  film.uniforms.uTime.value = elapsed % 10;

  updateWalls(dt);
  if (hoverQueued) {
    canvas.style.cursor = pick(...hoverQueued) ? 'pointer' : 'grab';
    hoverQueued = null;
  }
  controls.update();

  // pins
  if (state.labels && !state.cine) {
    checkOcclusion();
    for (const [id, p] of Object.entries(pins)) {
      anchorWorld(refs.items[id], tmpProj);
      const camD = camera.position.distanceTo(tmpProj);
      tmpProj.project(camera);
      const hide = tmpProj.z > 1 || camD < 0.12 || Math.abs(tmpProj.x) > 1.1 || Math.abs(tmpProj.y) > 1.1;
      p.el.style.display = hide ? 'none' : '';
      if (!hide) p.el.style.transform = `translate(${(tmpProj.x * 0.5 + 0.5) * window.innerWidth}px, ${(-tmpProj.y * 0.5 + 0.5) * window.innerHeight}px) translate(-6px, -50%)`;
    }
  }

  hudTimer += dt; lcdTimer += dt; chartTimer += dt;
  if (hudTimer > 0.4) { hudTimer = 0; updateHud(); updateCycleCursor(); }
  if (lcdTimer > 0.25) { lcdTimer = 0; updateClock(); }
  if (chartTimer > 1) { chartTimer = 0; drawChart(); }

  // only re-render shadow maps for lights that are actually on
  roomLamp.shadow.needsUpdate = ambient.lamp > 0.01 || !roomLamp.shadow.map;
  sun.shadow.needsUpdate = sun.intensity > 0.01 || !sun.shadow.map;
  spot.shadow.needsUpdate = light.level > 0.01 || !spot.shadow.map;
  if (macro.active) macro.render(dt);
  else composer.render();
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => {
  macro.resize(window.innerWidth, window.innerHeight, quality.pr);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// ───────── intro: title card + the tent assembles itself ─────────
function titleCard() {
  const el = $('title');
  $('titleText').innerHTML = [...'MI INDOOR'].map((ch) => `<span>${ch === ' ' ? '&nbsp;' : ch}</span>`).join('');
  el.classList.remove('hidden');
  el.style.opacity = 1;
  createTimeline()
    .add('#titleText span', { opacity: [0, 1], translateY: [80, 0], rotateX: [-80, 0], filter: ['blur(14px)', 'blur(0px)'], delay: stagger(70), duration: 1100, ease: 'outExpo' })
    .add('.title-kicker, .title-sub', { opacity: [0, 1], translateY: [10, 0], duration: 700, ease: 'outQuad' }, 300)
    .add(el, { opacity: [1, 0], scale: [1, 1.08], duration: 900, ease: 'inQuad', onComplete: () => el.classList.add('hidden') }, 2700);
}

function intro() {
  if (introRunning || state.cine) return;
  introRunning = true;
  stopTimelapse();
  dayAnim?.pause();
  flight?.pause();
  titleCard();
  const tl = createTimeline({ defaults: { ease: 'outExpo' }, onComplete: () => { introRunning = false; prevDay = state.day; } });
  const poles = refs.poles;
  poles.forEach((p) => { p.userData.s ??= p.scale.clone(); p.scale.set(0.001, 0.001, 0.001); });
  for (const w of refs.walls) w.pivot.scale.y = 0.001;
  const equip = [refs.led.group, refs.extractor, refs.clipFan.group, refs.humidifier.group, ...refs.pcFans, refs.roofStuff, refs.dripGroup];
  // take the current resting heights, so a moved LED stays where the user put it
  equip.forEach((o) => { o.userData.y = o.position.y; o.position.y += 1.2; o.visible = false; });
  refs.potGroup.children.forEach((p) => p.scale.set(0.001, 0.001, 0.001));
  const dayTarget = state.day;
  state.day = 0;
  rebuildPlants(true);
  labelsEl.style.opacity = 0;
  syncCamAnim();

  tl.add(camAnim, { px: [4.2, 1.95], py: [3.2, 1.55], pz: [4.6, 2.35], tx: [0, 0], ty: [0.8, 0.78], tz: [0, 0], duration: 3800, ease: 'inOutCubic', onUpdate: applyCam }, 0)
    .add(poles.map((p) => p.scale), {
      x: (_, i) => poles[i].userData.s.x, y: (_, i) => poles[i].userData.s.y, z: (_, i) => poles[i].userData.s.z,
      duration: 700, delay: stagger(28),
    }, 200)
    .add(refs.walls.map((w) => w.pivot.scale), { y: 1, duration: 900, delay: stagger(110), ease: 'outBack(1.2)' }, 900)
    .add(refs.potGroup.children.map((p) => p.scale), { x: 1, y: 1, z: 1, duration: 700, delay: stagger(90), ease: 'outBack(1.6)' }, 1500);
  equip.forEach((o, i) => {
    tl.add(o.position, { y: o.userData.y, duration: 900, ease: 'outBounce', onBegin: () => { o.visible = true; } }, 1700 + i * 120);
  });
  tl.add(state, { day: dayTarget, duration: 1600, ease: 'outCubic', onUpdate: showDay }, 2600)
    .add('.stat', { opacity: [0, 1], translateY: [16, 0], delay: stagger(60), duration: 600 }, 2800)
    .add('.sec', { opacity: [0, 1], translateX: [-20, 0], delay: stagger(80), duration: 600 }, 3000)
    .add('#cycle, #chartBox', { opacity: [0, 1], duration: 700 }, 3200)
    .add(labelsEl, { opacity: [0, 1], duration: 800 }, 3800);
}
$('intro').addEventListener('click', intro);

// ───────── modo vinculado con el simulador ─────────
// Entra: hora, día, etapa, fotoperíodo, PPFD y clima del simulador.
// Sale: lo que la persona toca acá (dimmer, potencia, altura, extractor,
// fotoperíodo, riego) se convierte en variables del simulador.
const send = (msg) => window.parent.postMessage(Object.assign({ source: 'indoor3d' }, msg), '*');
function setRange(id, v) { const e = $(id); e.value = v; paintRange(e); e.dispatchEvent(new Event('sync')); }
const outFmt = { dim: (v) => `${v}%`, watt: (v) => `${v} W`, extractor: (v) => `${v}%` };
const outId = { dim: 'dimOut', watt: 'wattOut', extractor: 'extOut' };
function showRange(id, v) { setRange(id, v); $(outId[id]).textContent = outFmt[id](v); }
// PPFD que da el LED con dimmer 100 % a la altura actual de la copa
const ppfdPerDim = () => (state.dim > 0 ? ppfd.avg / state.dim : 0);
function pushLight() { link.touched = performance.now(); send({ type: 'set', ppfd: Math.round(ppfd.avg / 10) * 10 }); }
function applyLink() {
  const L = link.s;
  if (!L) return;
  setOutdoor(!!L.out);
  // en interior el simulador prende la luz a la hora 0: acá se ve a las 06:00; afuera vale la hora solar
  state.simMin = L.hour * 60 + (L.out ? 0 : 360);
  // a varios días por segundo el día y la noche se promedian (como un timelapse) en vez de parpadear
  const f = L.running ? smoothstep(0.3, 3, L.speed) : 0;
  link.fast += (f - link.fast) * 0.1;
  if (!introRunning) { state.day = L.day; if (state.flip !== L.flip) setFlip(L.flip); }
  state.photo = String(L.photo);
  climate.T = L.tAir; climate.RH = L.rh; climate.soil = L.soil;
  for (const p of refs.plants) p.link = introRunning ? null : L.plant;
  if (L.lampCm && Math.abs(L.lampCm - link.lampCm) >= 1) {
    // el LED cuelga donde lo pone el simulador (15 cm bajo el techo, sobre la maceta)
    link.lampCm = L.lampCm;
    heightAnim?.pause();
    heightAnim = animate(state, { lightH: Math.min(1.15, Math.max(0.35, L.lampCm / 100)), duration: 900, ease: 'outCubic', onUpdate: () => { refs.setLedY(SOIL_Y + state.lightH); renderedDay = -1; } });
  }
  sampleHistory();
}
function syncFromSim(L) {
  const idle = performance.now() - link.touched > 2000;
  if (idle && L.ppfd != null) {
    // el dimmer (y si no alcanza, la potencia) siguen al PPFD del simulador
    const per = ppfdPerDim();
    if (per > 1) {
      let watts = state.watts, dim = L.ppfd / per;
      if (dim > 1) { watts = Math.min(300, Math.ceil((state.watts * dim) / 10) * 10); dim = Math.min(1, L.ppfd / ((per * watts) / state.watts)); }
      dim = Math.max(0.1, dim);
      if (watts !== state.watts) { state.watts = watts; showRange('watt', watts); }
      if (Math.abs(dim - state.dim) > 0.01) { state.dim = dim; showRange('dim', Math.round(dim * 100)); recomputeLight(); }
    }
    const ext = Math.round(L.airflow);
    if (!L.out && Math.abs(ext - state.extractor * 100) >= 1) { state.extractor = ext / 100; showRange('extractor', ext); }
    const sel = $('photoperiod');
    const want = L.photoAuto ? 'auto' : String(L.photo);
    if (![...sel.options].some((o) => o.value === want)) sel.append(new Option(`${L.photo}/${24 - L.photo}`, want));
    sel.value = want;
    $('photoperiod').options[0].textContent = `Simulador (${L.photo}/${24 - L.photo})`;
  }
  $('linkNote').innerHTML = L.out
    ? 'El simulador está en <b>exterior</b>: el indoor muestra la planta con el clima de afuera.'
    : L.dead ? '☠ La planta murió en el simulador.' : L.done ? '✂ Cosechada en el simulador.' : '';
}
if (LINKED) {
  // el tiempo lo maneja el simulador
  for (const id of ['speed', 'autoGrow', 'day', 'flip', 'roomT', 'onHour']) $(id).closest('.row').classList.add('linked-hide');
  $('timelapse').classList.add('linked-hide');
  $('flipHandle').classList.add('linked-hide');
  const note = document.createElement('p');
  note.className = 'link-note';
  note.innerHTML = '<span id="linkNote"></span><small>Vinculado al simulador: el tiempo, la etapa y el clima vienen de ahí. Dimmer, potencia, altura del LED, extractor, fotoperíodo y riego cambian la planta simulada.</small>';
  $('timelapse').closest('.sec').querySelector('h3').after(note);
  $('photoperiod').options[0].textContent = 'Simulador';
  if (EMBED) {
    // en la escena del simulador las etiquetas de equipos quedan apagadas: se tocan los equipos directamente
    const lt = $('labelsToggle');
    if (lt.checked) { lt.checked = false; lt.dispatchEvent(new Event('change')); }
    // sin panel: los dos visualizadores más útiles pasan a la barra de vistas
    const quick = document.querySelector('.views.quick');
    for (const [id, icon, title] of [['parMap', '🟩', 'Mapa de PPFD en la copa'], ['airflow', '💨', 'Ver flujo de aire']]) {
      const b = document.createElement('button');
      b.textContent = icon; b.title = title;
      b.addEventListener('click', () => { const c = $(id); c.checked = !c.checked; c.dispatchEvent(new Event('change')); b.classList.toggle('on', c.checked); });
      quick.prepend(b);
    }
    // brillo de la imagen (solo visual: la luz que recibe la planta se cambia con el PPFD de Ajustes)
    const expo = document.createElement('label');
    expo.className = 'expo';
    expo.title = 'Brillo de la imagen (no cambia la luz de la planta)';
    expo.innerHTML = '🔆<input type="range" min="30" max="130" step="1">';
    const inp = expo.querySelector('input');
    const saved = +localStorage.getItem('indoor3d:exposure') || 100;
    inp.value = saved;
    renderer.toneMappingExposure = saved / 100;
    paintRange(inp);
    inp.addEventListener('input', () => { renderer.toneMappingExposure = inp.value / 100; paintRange(inp); localStorage.setItem('indoor3d:exposure', inp.value); });
    quick.append(expo);
  }
  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.source !== 'ciclo') return;
    if (m.type === 'enter') enterScene(m.first);
    else if (m.type === 'leave') leaveScene();
    else if (m.type === 'pause') { link.paused = true; audio.update({ ...state, clipFan: false, pcFans: false, extractor: 0 }, 0, 0); }
    else if (m.type === 'event') simEvent(m);
    else if (m.type === 'state') {
      const prev = link.s?.plant;
      link.s = m.state;
      if (!prev || Math.abs(prev.height - m.state.plant.height) > 0.004 || Math.abs(prev.sick - m.state.plant.sick) > 0.03) link.dirty = true;
      else link.s.plant = prev;
      syncFromSim(m.state);
      if (m.state.macro) macro.setData(m.state.macro);
    }
  });
  for (const id of ['dim', 'watt']) $(id).addEventListener('input', pushLight);
  $('lightHeight').addEventListener('input', () => { link.touched = performance.now(); setTimeout(pushLight, 650); });
  $('extractor').addEventListener('input', (e) => { link.touched = performance.now(); send({ type: 'set', airflow: +e.target.value }); });
  $('photoperiod').addEventListener('change', (e) => { link.touched = performance.now(); send({ type: 'set', photo: e.target.value === 'auto' ? 'auto' : +e.target.value }); });
  send({ type: 'ready' });
}

// La coreografía entre el dibujo 2D y la carpa: el dibujo es una vista de
// frente, así que la cámara 3D arranca de frente y gira hasta tres cuartos;
// al volver hace el recorrido inverso antes del fundido.
const FRONT = { pos: new THREE.Vector3(0, 0.78, 2.15), target: new THREE.Vector3(0, 0.66, 0) };
function enterScene() {
  link.paused = false;
  timer.update();
  if (!link.entered) {
    link.entered = true;
    $('loader').classList.add('gone');
    intro();
    return;
  }
  flight?.pause();
  camera.position.copy(FRONT.pos);
  controls.target.copy(FRONT.target);
  if (!state.doorOpen) setDoor(true);
  setTimeout(() => goView('exterior'), 120);
}
function leaveScene() {
  closeMacro();
  if (state.cine) stopCine();
  flyTo(FRONT.pos, FRONT.target, 650);
}
function flashCaption(kicker, title, ms = 2600) {
  const c = $('caption');
  c.innerHTML = `<small>${kicker}</small>${title}`;
  createTimeline()
    .add(c, { opacity: [0, 1], filter: ['blur(10px)', 'blur(0px)'], duration: 700, ease: 'outExpo' })
    .add(c, { opacity: 0, filter: 'blur(8px)', duration: 600, ease: 'inQuad' }, `+=${ms}`);
}
function simEvent(m) {
  if (link.paused) return;
  if (m.kind === 'water') water(true);
  else if (m.kind === 'stage') { flashCaption('Nueva etapa', m.name); goView('plantas'); }
  else if (m.kind === 'lights') caption(m.on ? 'Encendido' : 'Apagado', m.on ? '☀ Luces' : '🌙 Noche', 1200);
  else if (m.kind === 'harvest') {
    lastHarvest = 0;
    bursts.push(createBurst(scene, new THREE.Vector3(0, canopyY, 0)));
    audio.chime();
    const t = $('toast');
    t.innerHTML = `<h2>✂ ¡Cosecha!</h2><p>Día ${m.day} · ${Math.round(m.fd)} días de floración</p><p><b>${m.dry} g</b> secos estimados</p>`;
    t.classList.remove('hidden');
    createTimeline()
      .add(t, { opacity: [0, 1], scale: [0.6, 1], duration: 900, ease: 'outElastic(1, .6)' })
      .add(t, { opacity: 0, translateY: [0, -20], duration: 600, ease: 'inQuad', onComplete: () => t.classList.add('hidden') }, '+=3200');
  } else if (m.kind === 'dead') flashCaption('La planta', '☠ murió', 3000);
  else if (m.kind === 'replant') { flashCaption('Planta nueva', '🌱 a sembrar'); goView('plantas'); }
}

// ───────── microscopio: del cogollo al átomo ─────────
function macroDataLocal() {
  // sin simulador: misma cuenta de madurez que el simulador, con 63 días de flora
  const r = Math.max(0, state.day - state.flip) / 63;
  const cl = (x) => Math.min(1, Math.max(0, x));
  const clear = cl((0.98 - r) / 0.4);
  const amber = Math.min(1 - clear, Math.pow(cl((r - 0.93) / 0.4), 1.3) * 0.95);
  return { tri: { clear, cloudy: cl(1 - clear - amber), amber, density: cl((r - 0.12) / 0.6) }, pist: cl((r - 0.55) / 0.45) * 0.95, chemo: 'thc', purple: 0, flower: state.day > state.flip + 5, male: false };
}
function openMacro() {
  if (macro.active || introRunning || state.cine) return;
  deselect();
  if (!LINKED) macro.setData(macroDataLocal());
  // la cámara vuela hasta la punta de la planta y ahí entra el microscopio
  const top = new THREE.Vector3(0.19, Math.max(canopyY - 0.03, SOIL_Y + 0.05), 0.19);
  if (!state.doorOpen) setDoor(true);
  flyTo(top.clone().add(new THREE.Vector3(0.05, 0.03, 0.16)), top, 900);
  controls.enabled = false;
  setTimeout(() => {
    document.documentElement.classList.add('in-macro');
    macro.enter();
  }, 820);
}
function closeMacro() {
  if (!macro.active) return;
  macro.exit();
  document.documentElement.classList.remove('in-macro');
  controls.enabled = true;
  goView('plantas');
}
{
  const b = document.createElement('button');
  b.id = 'macroBtn';
  b.textContent = '🔬';
  b.title = 'Z · Microscopio: del cogollo al átomo';
  b.addEventListener('click', openMacro);
  document.querySelector('.views.quick').prepend(b);
}

// ───────── boot ─────────
// ?t=HH:MM starts the clock at a given time; ?debug exposes the state in the console
{
  const q = new URLSearchParams(location.search);
  const t = q.get('t');
  if (t && /^\d{1,2}:\d{2}$/.test(t)) { const [hh, mm] = t.split(':').map(Number); state.simMin = hh * 60 + mm; }
  if (q.has('debug')) window.__indoor = { state, climate, refs, light, renderer, quality, bloom, scene, macro, openMacro };
}
refs.setLedY(SOIL_Y + state.lightH);
applyDoor();
rebuildPlants(true);
// warm up: simulate the last 24 h so the climate and the chart start with history
{
  const now = state.simMin;
  state.simMin = now - 1440;
  for (let m = 0; m < 1440; m += 5) {
    light.level = light.target = lightIsOn() ? 1 : 0;
    stepSim(5);
  }
  state.simMin = now;
}
syncLight(true);
updateClock();
updateHud();
drawChart();
updateCycleCursor();
requestAnimationFrame(frame);
if (!EMBED) setTimeout(() => {
  $('loader').classList.add('gone');
  intro();
}, 350);
