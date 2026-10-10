import * as THREE from 'three';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function toTex(c, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Wrinkled-fabric bump map, shared by the outer canvas and the mylar lining. */
export function wrinkleTexture(seed = 3, size = 512) {
  const [c, g] = canvas(size, size);
  const r = rand(seed);
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 90; i++) {
    const x = r() * size, y = r() * size;
    const len = 60 + r() * 260, a = (r() - 0.5) * 1.4 + (r() > 0.5 ? Math.PI / 2 : 0);
    const grad = g.createLinearGradient(0, -6, 0, 6);
    const v = r() > 0.5 ? 255 : 0;
    grad.addColorStop(0, 'rgba(128,128,128,0)');
    grad.addColorStop(0.5, `rgba(${v},${v},${v},${0.12 + r() * 0.18})`);
    grad.addColorStop(1, 'rgba(128,128,128,0)');
    g.save();
    g.translate(x, y); g.rotate(a);
    g.fillStyle = grad;
    g.beginPath();
    g.ellipse(0, 0, len / 2, 3 + r() * 6, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  return toTex(c, { srgb: false });
}

/** Black oxford fabric with a faint weave. */
export function fabricTexture(size = 256) {
  const [c, g] = canvas(size, size);
  const r = rand(11);
  g.fillStyle = '#1a1b1d';
  g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 2) {
    g.fillStyle = `rgba(255,255,255,${0.015 + r() * 0.02})`;
    g.fillRect(0, y, size, 1);
  }
  for (let x = 0; x < size; x += 2) {
    g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.05})`;
    g.fillRect(x, 0, 1, size);
  }
  return toTex(c, { repeat: [6, 12] });
}

function zipper(g, path, w = 5) {
  g.save();
  g.strokeStyle = '#0a0a0b';
  g.lineWidth = w + 3;
  g.stroke(path);
  g.strokeStyle = '#2a2b2e';
  g.setLineDash([2, 2]);
  g.lineWidth = w;
  g.stroke(path);
  g.restore();
}

function baseFabric(g, w, h, seed) {
  const r = rand(seed);
  g.fillStyle = '#1b1c1f';
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.025})`;
    g.fillRect(r() * w, r() * h, 1 + r() * 2, 1);
  }
  // seam / piping on edges
  g.strokeStyle = '#0c0c0d';
  g.lineWidth = 10;
  g.strokeRect(0, 0, w, h);
}

/** Draws the curved door zipper seen on the front and side panels. */
function dZip(g, x0, y0, x1, y1, rad, side = 'right') {
  const p = new Path2D();
  if (side === 'right') {
    p.moveTo(x0, y0);
    p.lineTo(x1 - rad, y0);
    p.quadraticCurveTo(x1, y0, x1, y0 + rad);
    p.lineTo(x1, y1 - rad);
    p.quadraticCurveTo(x1, y1, x1 - rad, y1);
    p.lineTo(x0, y1);
  } else {
    p.moveTo(x1, y0);
    p.lineTo(x0 + rad, y0);
    p.quadraticCurveTo(x0, y0, x0, y0 + rad);
    p.lineTo(x0, y1 - rad);
    p.quadraticCurveTo(x0, y1, x0 + rad, y1);
    p.lineTo(x1, y1);
  }
  zipper(g, p);
  // zipper pulls
  const px = side === 'right' ? x0 + 14 : x1 - 26;
  g.fillStyle = '#c9c9c9';
  g.fillRect(px, y0 + 4, 5, 26);
  g.fillRect(px + 8, y0 + 4, 5, 26);
}

export function logoCanvas(size = 256) {
  const [c, g] = canvas(size, size);
  g.fillStyle = '#121214';
  g.fillRect(0, 0, size, size);
  g.strokeStyle = '#d8d8d8';
  g.fillStyle = '#d8d8d8';
  g.lineWidth = size * 0.022;
  const cx = size / 2, cy = size * 0.4;
  g.beginPath();
  g.moveTo(cx, cy - size * 0.27);
  g.bezierCurveTo(cx + size * 0.2, cy - size * 0.05, cx + size * 0.2, cy + size * 0.16, cx, cy + size * 0.18);
  g.bezierCurveTo(cx - size * 0.2, cy + size * 0.16, cx - size * 0.2, cy - size * 0.05, cx, cy - size * 0.27);
  g.stroke();
  g.beginPath();
  g.ellipse(cx - size * 0.05, cy + size * 0.02, size * 0.035, size * 0.09, -0.6, 0, Math.PI * 2);
  g.ellipse(cx + size * 0.05, cy + size * 0.02, size * 0.035, size * 0.09, 0.6, 0, Math.PI * 2);
  g.fill();
  g.font = `600 ${size * 0.15}px ui-sans-serif, Helvetica, Arial`;
  g.textAlign = 'center';
  g.fillText('cultivarg', cx, size * 0.86);
  return c;
}

/** Front panel: door zipper + logo patch. */
export function frontTexture() {
  const W = 512, H = 1024;
  const [c, g] = canvas(W, H);
  baseFabric(g, W, H, 5);
  dZip(g, 26, 40, W - 70, H - 26, 150, 'right');
  const logo = logoCanvas(128);
  g.drawImage(logo, W - 128 - 16, 30, 110, 110);
  return toTex(c);
}

export function sideTexture(seed, mirror = false) {
  const W = 512, H = 1024;
  const [c, g] = canvas(W, H);
  baseFabric(g, W, H, seed);
  if (mirror) dZip(g, 120, 360, W - 26, H - 300, 160, 'left');
  else dZip(g, 26, 360, W - 140, H - 300, 160, 'right');
  return toTex(c);
}

export function plainFabricTexture(seed) {
  const [c, g] = canvas(512, 512);
  baseFabric(g, 512, 512, seed);
  return toTex(c);
}

/** Dark marble floor tiles similar to the room in the photos. */
export function tileTexture() {
  const S = 512;
  const [c, g] = canvas(S, S);
  const r = rand(77);
  const n = 2;
  const ts = S / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const base = 40 + r() * 20;
    g.fillStyle = `rgb(${base},${base + 6},${base + 14})`;
    g.fillRect(i * ts, j * ts, ts, ts);
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = `rgba(${200 + r() * 55},${210 + r() * 45},${230},${0.08 + r() * 0.22})`;
      g.lineWidth = 0.5 + r() * 2.5;
      g.beginPath();
      let x = i * ts + r() * ts, y = j * ts + r() * ts;
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (r() - 0.3) * 50; y += (r() - 0.5) * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    g.strokeStyle = '#1a1c20';
    g.lineWidth = 3;
    g.strokeRect(i * ts, j * ts, ts, ts);
  }
  return toTex(c, { repeat: [6, 6] });
}

export function rugTexture() {
  const [c, g] = canvas(512, 512);
  const r = rand(9);
  g.fillStyle = '#5a3b26';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? 255 : 0},${r() > 0.5 ? 220 : 0},${r() > 0.5 ? 180 : 0},${r() * 0.05})`;
    g.fillRect(r() * 512, r() * 512, 2, 2);
  }
  g.strokeStyle = '#a4714a';
  g.lineWidth = 18;
  g.strokeRect(14, 14, 484, 484);
  return toTex(c);
}

export function wallTexture() {
  const [c, g] = canvas(256, 256);
  const r = rand(21);
  g.fillStyle = '#cfc6b3';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = `rgba(${r() > 0.5 ? 255 : 90},${r() > 0.5 ? 250 : 80},${r() > 0.5 ? 240 : 70},${r() * 0.06})`;
    g.fillRect(r() * 256, r() * 256, 2, 2);
  }
  return toTex(c, { repeat: [4, 2] });
}

export function soilTexture() {
  const S = 256;
  const [c, g] = canvas(S, S);
  const r = rand(4);
  g.fillStyle = '#5b3a22';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const t = r();
    g.fillStyle = t > 0.9 ? `rgba(240,236,228,${0.6 + r() * 0.4})` : `rgba(${60 + r() * 80},${35 + r() * 45},${15 + r() * 25},0.9)`;
    const s = t > 0.9 ? 2 + r() * 3 : 1 + r() * 4;
    g.beginPath();
    g.arc(r() * S, r() * S, s / 2, 0, Math.PI * 2);
    g.fill();
  }
  return toTex(c);
}

export function feltTexture() {
  const [c, g] = canvas(256, 256);
  const r = rand(15);
  g.fillStyle = '#8a8a86';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const v = 90 + r() * 90;
    g.fillStyle = `rgba(${v},${v},${v - 4},0.35)`;
    g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1);
  }
  return toTex(c, { repeat: [3, 1] });
}

export function meshTexture() {
  const [c, g] = canvas(128, 128);
  g.clearRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(30,30,30,0.85)';
  g.lineWidth = 1;
  for (let i = 0; i < 128; i += 4) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
  }
  return toTex(c, { repeat: [3, 2] });
}

/** Lambertian falloff map for the light-leak glow and the LED strip. */
export function glowTexture() {
  const [c, g] = canvas(128, 128);
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Small LCD displays (thermo-hygrometer and timer); redrawn every update. */
export class LcdScreen {
  constructor(w = 256, h = 160, draw) {
    [this.canvas, this.g] = canvas(w, h);
    this.draw = draw;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
  }
  update(data) {
    this.draw(this.g, this.canvas.width, this.canvas.height, data);
    this.texture.needsUpdate = true;
  }
}
