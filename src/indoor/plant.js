import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _c = new THREE.Color();

const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Serrated, lanceolate cannabis leaflet: base at origin, tip at +Z, lying flat. */
function leafletGeometry() {
  const s = new THREE.Shape();
  const N = 11;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const w = Math.sin(Math.pow(t, 0.75) * Math.PI) * 0.11 * (1 - t * 0.25);
    const serr = i > 0 && i < N ? (i % 2 ? 0.018 : -0.004) : 0;
    pts.push([w + serr * (1 - t), t]);
  }
  s.moveTo(0, 0);
  for (const [x, y] of pts) s.lineTo(x, y);
  for (let i = pts.length - 2; i >= 0; i--) s.lineTo(-pts[i][0], pts[i][1]);
  const g = new THREE.ShapeGeometry(s);
  // give it a soft crease along the midrib and a gentle droop towards the tip
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    pos.setZ(i, -Math.abs(x) * 0.3 + y * y * 0.12);
  }
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function stemGeometry() {
  const g = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

function cotyledonGeometry() {
  const g = new THREE.CircleGeometry(0.5, 10);
  g.scale(0.7, 1, 1);
  g.translate(0, 0.5, 0);
  g.rotateX(Math.PI / 2);
  return g;
}

export const plantUniforms = {
  uTime: { value: 0 },
  uWind: { value: 0 },
  uWindDir: { value: new THREE.Vector2(1, 0) },
  uFrost: { value: 0 },
};

/** Frosty calyx texture: green base speckled with trichome heads. */
function budTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = seeded(5);
  g.fillStyle = '#c9dfa6';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${90 + r() * 60},${140 + r() * 50},${60 + r() * 40},0.5)`;
    g.beginPath(); g.arc(r() * 256, r() * 256, 4 + r() * 10, 0, Math.PI * 2); g.fill();
  }
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(255,255,250,${0.35 + r() * 0.6})`;
    g.beginPath(); g.arc(r() * 256, r() * 256, 0.6 + r() * 1.4, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

const shared = {
  leaflet: null,
  stem: null,
  bud: null,
  coty: null,
  leafMat: null,
  stemMat: null,
  budMat: null,
};

function ensureShared() {
  if (shared.leaflet) return;
  shared.leaflet = leafletGeometry();
  shared.stem = stemGeometry();
  shared.bud = (() => {
    // a teardrop calyx: pointed on top, with a few bumps
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const f = 1 + 0.08 * Math.sin(x * 13 + y * 7) * Math.cos(z * 11 - y * 9);
      const taper = y > 0 ? 1 - y * 0.45 : 1;
      pos.setXYZ(i, x * f * taper, y * f * (y > 0 ? 1.5 : 0.9), z * f * taper);
    }
    g.computeVertexNormals();
    return g;
  })();
  shared.pistil = (() => {
    // pelito que se enrula hacia la punta
    const pts = [];
    for (let i = 0; i <= 10; i++) { const t = i / 10, a = t * 5.5; pts.push(new THREE.Vector3(Math.sin(a) * 0.12 * t, t, (Math.cos(a) - 1) * 0.12 * t)); }
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.035, 4);
  })();
  shared.pistilMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  shared.coty = cotyledonGeometry();
  shared.leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, side: THREE.DoubleSide });
  // leaves flutter in the clip fan's breeze; the tip (local +Z) moves the most
  shared.leafMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = plantUniforms.uTime;
    sh.uniforms.uWind = plantUniforms.uWind;
    sh.uniforms.uWindDir = plantUniforms.uWindDir;
    sh.vertexShader = 'uniform float uTime;\nuniform float uWind;\nuniform vec2 uWindDir;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
      #else
        vec3 ip = vec3(0.0);
      #endif
      float ph = dot(ip, vec3(91.7, 57.3, 73.1));
      float tip = clamp(position.z, 0.0, 1.0);
      float gust = 0.6 + 0.4 * sin(uTime * 0.9 + ip.y * 4.0);
      transformed.y += (sin(uTime * 9.0 + ph) * 0.16 + sin(uTime * 3.1 + ph * 0.7) * 0.1) * uWind * gust * tip;
      transformed.x += sin(uTime * 6.3 + ph * 1.3) * 0.07 * uWind * gust * tip;`);
  };
  shared.stemMat = new THREE.MeshStandardMaterial({ color: 0x6f9a45, roughness: 0.7 });
  // escarcha: brillo aterciopelado en el borde y destellos de tricomas que titilan al mover la cámara
  shared.budMat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: budTexture(), roughness: 0.42, metalness: 0.0, emissive: 0x040703,
    sheen: 1, sheenColor: new THREE.Color(0xeef6e2), sheenRoughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.2 });
  shared.budMat.onBeforeCompile = (sh) => {
    sh.uniforms.uFrost = plantUniforms.uFrost;
    sh.fragmentShader = 'uniform float uFrost;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 cell = floor(vViewPosition * 2600.0);
        float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
        float facing = clamp(dot(normalize(vNormal), normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += vec3(1.0, 0.98, 0.92) * pow(h, 70.0) * 2.4 * uFrost * (0.4 + 0.6 * facing);
      }`);
  };
}

/**
 * Procedural photoperiod plant. update(day, flipDay, maxHeight) rebuilds the
 * instance matrices; geometry is shared between plants.
 */
export class Plant {
  constructor(seed = 1) {
    ensureShared();
    this.seed = seed;
    this.group = new THREE.Group();
    this.leaves = new THREE.InstancedMesh(shared.leaflet, shared.leafMat, 1500);
    this.stems = new THREE.InstancedMesh(shared.stem, shared.stemMat, 400);
    this.buds = new THREE.InstancedMesh(shared.bud, shared.budMat, 3000);
    this.cotys = new THREE.InstancedMesh(shared.coty, shared.leafMat, 2);
    this.pistils = new THREE.InstancedMesh(shared.pistil, shared.pistilMat, 4000);
    for (const m of [this.leaves, this.stems, this.buds, this.cotys, this.pistils]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.leaves.setColorAt(0, _c.set(0x3f8f2f));
    this.buds.setColorAt(0, _c.set(0x9ec46a));
    this.cotys.setColorAt(0, _c.set(0x6db14a));
    this.pistils.setColorAt(0, _c.set(0xffffff));
    this.pistils.castShadow = false;
    this.height = 0;
    this.leafScale = 0;
  }

  _stem(a, b, r) {
    const i = this.stems.count++;
    const dir = _p.subVectors(b, a);
    const len = dir.length();
    _q.setFromUnitVectors(UP, dir.normalize());
    _m.compose(a, _q, _s.set(r, len, r));
    this.stems.setMatrixAt(i, _m);
  }

  _leaf(origin, yaw, pitch, size, leaflets, color) {
    // petiole
    const pl = size * 0.55;
    const tip = new THREE.Vector3(
      origin.x + Math.sin(yaw) * pl * Math.cos(pitch * 0.6),
      origin.y + pl * 0.35,
      origin.z + Math.cos(yaw) * pl * Math.cos(pitch * 0.6),
    );
    this._stem(origin, tip, Math.max(0.0012, size * 0.018));
    const spread = leaflets === 1 ? 0 : Math.PI * (leaflets >= 7 ? 0.85 : 0.62);
    for (let j = 0; j < leaflets; j++) {
      const t = leaflets === 1 ? 0 : j / (leaflets - 1) - 0.5;
      const len = size * (1 - Math.abs(t) * 1.25);
      _e.set(pitch + Math.abs(t) * 0.5 + 0.12, yaw + t * spread, t * 0.3);
      _q.setFromEuler(_e);
      _m.compose(tip, _q, _s.set(len * 0.95, len, len));
      const i = this.leaves.count++;
      this.leaves.setMatrixAt(i, _m);
      this.leaves.setColorAt(i, color);
    }
  }

  /** One bud site: a cluster of calyxes, a couple of pistils and a sugar leaf. */
  _bud(pos, r, color, rnd, pistilColor, leafColor) {
    const calyx = (p, s) => {
      if (this.buds.count >= 3000) return;
      const i = this.buds.count++;
      _e.set((rnd() - 0.5) * 0.7, rnd() * 6.28, (rnd() - 0.5) * 0.7);
      _q.setFromEuler(_e);
      _m.compose(p, _q, _s.set(s, s, s));
      this.buds.setMatrixAt(i, _m);
      this.buds.setColorAt(i, _c.copy(color).offsetHSL((rnd() - 0.5) * 0.02, 0, (rnd() - 0.5) * 0.06));
    };
    calyx(pos, r * 0.75);
    const n = 4;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rnd();
      const p = new THREE.Vector3(pos.x + Math.cos(a) * r * 0.6, pos.y + (rnd() - 0.3) * r * 0.7, pos.z + Math.sin(a) * r * 0.6);
      calyx(p, r * (0.42 + rnd() * 0.15));
      // pistils: hairs curling out of the calyx tips
      if (this.pistils.count < 4000) {
        _e.set(0.5 + rnd() * 1.0, a + Math.PI / 2 + (rnd() - 0.5), 0);
        _q.setFromEuler(_e);
        const len = r * (0.7 + rnd() * 0.5);
        _p.set(p.x, p.y + r * 0.3, p.z);
        _m.compose(_p, _q, _s.set(len * 0.45, len, len * 0.45));
        const j = this.pistils.count++;
        this.pistils.setMatrixAt(j, _m);
        this.pistils.setColorAt(j, pistilColor);
      }
    }
    // sugar leaf poking out of the cluster
    if (leafColor && rnd() < 0.45 && this.leaves.count < 1500) {
      _e.set(-0.5 - rnd() * 0.4, rnd() * 6.28, 0);
      _q.setFromEuler(_e);
      const s = r * (1.8 + rnd() * 0.8);
      _m.compose(pos, _q, _s.set(s * 0.8, s, s));
      const i = this.leaves.count++;
      this.leaves.setMatrixAt(i, _m);
      this.leaves.setColorAt(i, leafColor);
    }
  }

  update(day, flip, maxHeight) {
    const rnd = seeded(this.seed);
    const vigor = 0.88 + rnd() * 0.24;
    const d = Math.max(0, day);
    this.leaves.count = 0;
    this.stems.count = 0;
    this.buds.count = 0;
    this.cotys.count = 0;
    this.pistils.count = 0;

    if (d < 1.5) {
      // just a sprout poking out
      const h = 0.004 + d * 0.006;
      this._stem(new THREE.Vector3(), new THREE.Vector3(0, h, 0), 0.0015);
      this.height = h;
      this.leafScale = 0;
      this._commit();
      return;
    }

    const vegDays = Math.min(d, flip);
    let h = 0.03 + 0.5 * vigor * (1 - Math.exp(-Math.max(0, vegDays - 5) / 32));
    const flowerDays = Math.max(0, d - flip);
    const stretch = 0.85 * (1 - Math.exp(-flowerDays / 11));
    h *= 1 + stretch;
    // vinculada al simulador: la altura sigue a la planta simulada (cada maceta con su vigor)
    if (this.link) h = Math.max(0.03, this.link.height * (0.9 + (vigor - 0.88) * 0.8));
    h = Math.min(h, maxHeight);
    this.height = h;

    const nodeDays = Math.min(d, flip + 22);
    const n = Math.max(1, Math.min(16, Math.floor((nodeDays - 3) / 3.6) + 1));
    const flowerT = smooth((d - flip - 8) / 52);
    const late = smooth((d - flip - 40) / 25);
    plantUniforms.uFrost.value = smooth((d - flip - 14) / 30);
    this.leafScale = Math.min(1, n / 14);

    const green = new THREE.Color(0x3f8f2f);
    const yellow = new THREE.Color(0xc9b13a);
    const stemColorTop = new THREE.Color(0x76a648);

    // cotyledons
    if (d < 28) {
      const cs = 0.012 * smooth(d / 3);
      for (let k = 0; k < 2; k++) {
        _e.set(0.15, k * Math.PI, 0);
        _q.setFromEuler(_e);
        _m.compose(_p.set(0, Math.min(0.012, h * 0.3), 0), _q, _s.set(cs, cs, cs));
        this.cotys.setMatrixAt(this.cotys.count, _m);
        this.cotys.setColorAt(this.cotys.count++, _c.set(0x6db14a).lerp(yellow, smooth((d - 18) / 10)));
      }
    }

    const nodeY = (i) => h * Math.pow((i + 1) / (n + 0.6), 0.92);
    const sway = (y) => new THREE.Vector3(Math.sin(y * 9 + this.seed) * 0.006 * y, y, Math.cos(y * 7 + this.seed) * 0.006 * y);
    const stemR = (y) => (0.0018 + 0.006 * smooth(d / 50)) * (1 - (y / Math.max(h, 0.01)) * 0.55);

    let prev = new THREE.Vector3();
    const tipPts = [];
    for (let i = 0; i < n; i++) {
      const y = nodeY(i);
      const p = sway(y);
      this._stem(prev, p, stemR(prev.y));
      prev = p;

      const birth = 3 + i * 3.6;
      const age = d - birth;
      const phi = i * Math.PI / 2 + (rnd() - 0.5) * 0.3;
      const isTop = i >= n - 2;
      let maxLeaf = (0.04 + Math.min(i, 6) * 0.017) * vigor;
      if (flowerDays > 0 && i > n - 5) maxLeaf *= 0.65;
      const size = maxLeaf * smooth(age / 11 + 0.15);
      const leaflets = i === 0 ? 1 : i === 1 ? 3 : i === 2 ? 5 : (flowerDays > 25 && i > n - 3 ? 3 : 7);
      const sick = this.link ? this.link.sick * (0.55 + 0.45 * Math.max(0, 1 - i / n)) : 0;
      const yellowing = Math.min(1, late * Math.max(0, 1 - i / (n * 0.6)) + sick);
      const col = green.clone().offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.06).lerp(yellow, yellowing);

      if (size > 0.004) {
        for (let k = 0; k < 2; k++) {
          const yaw = phi + k * Math.PI;
          const pitch = 0.15 + (isTop ? -0.3 : 0.1) + rnd() * 0.15;
          this._leaf(p, yaw, pitch, size, leaflets, col);
        }
      }

      // side branches from node 2 up, longer at the bottom (christmas-tree shape)
      if (i >= 2 && age > 7) {
        const rel = 1 - i / (n + 2);
        const bl = Math.min(0.32 * vigor, (age - 7) * 0.0075) * rel * (0.75 + rnd() * 0.5);
        if (bl > 0.012) {
          for (let k = 0; k < 2; k++) {
            const yaw = phi + k * Math.PI + Math.PI / 4;
            const elev = 0.75 + (1 - rel) * 0.4;
            const mid = p.clone().add(new THREE.Vector3(Math.sin(yaw) * bl * 0.45, bl * 0.35, Math.cos(yaw) * bl * 0.45));
            const end = mid.clone().add(new THREE.Vector3(Math.sin(yaw) * bl * 0.3 * Math.cos(elev), bl * 0.6, Math.cos(yaw) * bl * 0.3 * Math.cos(elev)));
            end.y = Math.min(end.y, h * 0.98);
            const br = stemR(p.y) * 0.55;
            this._stem(p, mid, br);
            this._stem(mid, end, br * 0.8);
            const ls = Math.min(0.09, bl * 0.45) * vigor;
            const bc = col.clone().offsetHSL(0, 0, 0.03);
            this._leaf(mid, yaw + Math.PI / 2, 0.2, ls * 0.9, 5, bc);
            this._leaf(mid, yaw - Math.PI / 2, 0.2, ls * 0.9, 5, bc);
            this._leaf(end, yaw + 1.2, -0.1, ls * 0.7, flowerDays > 25 ? 3 : 5, bc);
            this._leaf(end, yaw - 1.2, -0.1, ls * 0.7, flowerDays > 25 ? 3 : 5, bc);
            tipPts.push({ p: end, w: bl / 0.3 });
          }
        }
      }
    }
    // apex
    const apex = sway(h);
    this._stem(prev, apex, stemR(prev.y) * 0.8);
    if (d - (3 + n * 3.6) > -2) {
      const s = 0.028 * vigor * smooth((d - 3) / 10);
      if (s > 0.004) {
        const col = green.clone().offsetHSL(0, 0.05, 0.06);
        this._leaf(apex, n * Math.PI / 2, -0.4, s, n > 3 ? 5 : 3, col);
        this._leaf(apex, n * Math.PI / 2 + Math.PI, -0.4, s, n > 3 ? 5 : 3, col);
      }
    }

    // flowers
    if (flowerT > 0) {
      const budGreen = new THREE.Color(0x9cc56c);
      const frost = new THREE.Color(0xe7f0dc);
      const amber = new THREE.Color(0xd9893a);
      const pistilCol = () => new THREE.Color(0xf4f1e6).lerp(new THREE.Color(0xc8571f), Math.min(1, late * 1.2 + rnd() * 0.25));
      const budCol = () => budGreen.clone().lerp(frost, flowerT * 0.25 + rnd() * 0.08).lerp(amber, late * (0.2 + rnd() * 0.25));
      const sugar = new THREE.Color(0x5c9a3a).lerp(frost, flowerT * 0.35);
      // main cola along the top 35% of the stem
      const colaLen = h * (0.18 + 0.2 * flowerT);
      const count = Math.floor(10 + 30 * flowerT);
      for (let k = 0; k < count; k++) {
        const t = k / count;
        const y = h - colaLen * t;
        const a = k * 2.4;
        const rr = (0.006 + 0.016 * flowerT) * (1 - t * 0.4);
        const pp = sway(y).add(new THREE.Vector3(Math.cos(a) * rr * 0.9, 0, Math.sin(a) * rr * 0.9));
        this._bud(pp, rr * (0.9 + rnd() * 0.4), budCol(), rnd, pistilCol(), sugar);
      }
      this._bud(apex.clone().add(new THREE.Vector3(0, 0.012 * flowerT, 0)), 0.01 + 0.014 * flowerT, budCol(), rnd, pistilCol(), sugar);
      for (const tp of tipPts) {
        const c = Math.floor(3 + 7 * flowerT * Math.min(1, tp.w + 0.3));
        for (let k = 0; k < c; k++) {
          const a = k * 2.4;
          const rr = (0.004 + 0.011 * flowerT) * Math.min(1, tp.w + 0.4);
          const pp = tp.p.clone().add(new THREE.Vector3(Math.cos(a) * rr * 0.8, -k * rr * 0.9, Math.sin(a) * rr * 0.8));
          this._bud(pp, rr * (0.85 + rnd() * 0.4), budCol(), rnd, pistilCol(), sugar);
        }
      }
    }
    shared.stemMat.color.copy(stemColorTop).lerp(new THREE.Color(0x8f7a4a), late * 0.6);
    this._commit();
  }

  _commit() {
    for (const m of [this.leaves, this.stems, this.buds, this.cotys, this.pistils]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}
