import * as THREE from 'three';
import { TENT } from './sim.js';

/**
 * Volumetric-looking light beam under the LED bar: an open truncated pyramid
 * drawn additively, faded by height and by the view angle so its edges stay soft.
 * Geometry spans y ∈ [0, -1]; scale.y sets the throw down to the floor.
 */
export function createBeam() {
  const top = [0.29, 0.035];
  const bot = [TENT.w / 2 - 0.02, TENT.d / 2 - 0.02];
  const corners = (hw, hd, y) => [[-hw, y, -hd], [hw, y, -hd], [hw, y, hd], [-hw, y, hd]];
  const T = corners(top[0], top[1], 0);
  const B = corners(bot[0], bot[1], -1);
  const pos = [], fade = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    pos.push(...T[i], ...B[i], ...B[j], ...T[i], ...B[j], ...T[j]);
    fade.push(0, 1, 1, 0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('fade', new THREE.Float32BufferAttribute(fade, 1));
  g.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uColor: { value: new THREE.Color(0xfff1dc) }, uTime: { value: 0 } },
    vertexShader: `attribute float fade; varying float vF; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ vF = fade; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uI; uniform vec3 uColor; uniform float uTime; varying float vF; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main(){ float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float streak = 0.75 + 0.25 * sin(vW.x * 60.0 + vW.z * 40.0 + uTime * 0.4);
        float a = uI * (1.0 - vF * 0.75) * facing * streak * 0.11;
        gl_FragColor = vec4(uColor * a, a); }`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 5;
  mesh.frustumCulled = false;
  return mesh;
}

function spriteTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
export const SPRITE = spriteTexture();

/** Dust motes drifting inside the tent; they only show up in the LED light. */
export function createDust(n = 360) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const seeds = [];
  for (let i = 0; i < n; i++) {
    seeds.push({
      x: (Math.random() - 0.5) * 0.74, y: 0.3 + Math.random() * 1.1, z: (Math.random() - 0.5) * 0.74,
      vx: (Math.random() - 0.5) * 0.01, vy: (Math.random() - 0.5) * 0.006, vz: (Math.random() - 0.5) * 0.01,
      tw: Math.random() * 6.28,
    });
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.007, map: SPRITE, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.update = (dt, t, light, ledY, wind, windYaw) => {
    for (let i = 0; i < n; i++) {
      const s = seeds[i];
      s.x += (s.vx + Math.sin(windYaw) * wind * 0.05 * Math.sin(t + s.tw)) * dt;
      s.z += (s.vz + Math.cos(windYaw) * wind * 0.05 * Math.sin(t * 1.3 + s.tw)) * dt;
      s.y += (s.vy + Math.sin(t * 0.7 + s.tw) * 0.004) * dt;
      if (s.x > 0.37) s.x = -0.37; if (s.x < -0.37) s.x = 0.37;
      if (s.z > 0.37) s.z = -0.37; if (s.z < -0.37) s.z = 0.37;
      if (s.y > ledY - 0.03) s.y = 0.28; if (s.y < 0.28) s.y = ledY - 0.03;
      pos[i * 3] = s.x; pos[i * 3 + 1] = s.y; pos[i * 3 + 2] = s.z;
      // brighter right under the bar
      const beam = Math.exp(-(s.z * s.z) / 0.03) * Math.exp(-(Math.max(0, Math.abs(s.x) - 0.28) ** 2) / 0.01);
      const tw = 0.55 + 0.45 * Math.sin(t * 3 + s.tw * 5);
      const a = light * (0.25 + beam * 0.9) * tw;
      col[i * 3] = a; col[i * 3 + 1] = a * 0.95; col[i * 3 + 2] = a * 0.85;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  };
  return pts;
}

/** Leaf/confetti burst for the harvest celebration. */
export function createBurst(scene, origin, count = 260) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const vel = [];
  const palette = [0x7ee36b, 0xffd23f, 0xff7a2a, 0xb6ff9e, 0xffffff].map((c) => new THREE.Color(c));
  for (let i = 0; i < count; i++) {
    pos.set([origin.x, origin.y, origin.z], i * 3);
    const a = Math.random() * Math.PI * 2, u = Math.random();
    vel.push(new THREE.Vector3(Math.cos(a) * u * 0.9, 1.1 + Math.random() * 1.4, Math.sin(a) * u * 0.9));
    const c = palette[i % palette.length];
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.03, map: SPRITE, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pts.frustumCulled = false;
  scene.add(pts);
  let life = 0;
  pts.update = (dt) => {
    life += dt;
    for (let i = 0; i < count; i++) {
      const v = vel[i];
      v.y -= 1.6 * dt;
      v.multiplyScalar(1 - dt * 0.8);
      pos[i * 3] += v.x * dt; pos[i * 3 + 1] = Math.max(0.01, pos[i * 3 + 1] + v.y * dt); pos[i * 3 + 2] += v.z * dt;
    }
    pts.material.opacity = Math.max(0, 1 - life / 4);
    geo.attributes.position.needsUpdate = true;
    return life < 4;
  };
  return pts;
}

/** Thermal-camera override material: false colour from a simple heat field. */
export function createThermalMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uRoom: { value: 20 }, uTent: { value: 24 }, uLed: { value: new THREE.Vector3(0, 1.1, 0) }, uLedHeat: { value: 0 },
      uTime: { value: 0 }, uLo: { value: 18 }, uHi: { value: 32 },
    },
    vertexShader: `varying vec3 vW; varying vec3 vN;
      void main(){ vec4 p = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          p = instanceMatrix * p;
        #endif
        vec4 w = modelMatrix * p; vW = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uRoom; uniform float uTent; uniform vec3 uLed; uniform float uLedHeat; uniform float uTime; uniform float uLo; uniform float uHi;
      varying vec3 vW; varying vec3 vN;
      // high-contrast rainbow palette (cold blue → hot white)
      vec3 iron(float t){
        t = clamp(t, 0.0, 1.0);
        vec3 c0 = vec3(0.0, 0.0, 0.06), c1 = vec3(0.12, 0.12, 0.9), c2 = vec3(0.0, 0.78, 0.8),
             c3 = vec3(0.15, 0.88, 0.15), c4 = vec3(0.95, 0.95, 0.0), c5 = vec3(1.0, 0.32, 0.0), c6 = vec3(1.0, 1.0, 1.0);
        if (t < 0.15) return mix(c0, c1, t / 0.15);
        if (t < 0.35) return mix(c1, c2, (t - 0.15) / 0.2);
        if (t < 0.5) return mix(c2, c3, (t - 0.35) / 0.15);
        if (t < 0.65) return mix(c3, c4, (t - 0.5) / 0.15);
        if (t < 0.82) return mix(c4, c5, (t - 0.65) / 0.17);
        return mix(c5, c6, (t - 0.82) / 0.18);
      }
      void main(){
        float inside = step(abs(vW.x), 0.405) * step(abs(vW.z), 0.405) * step(vW.y, 1.605);
        // warm air stratifies: colder near the floor, hotter under the roof
        float strat = mix(0.35, 1.6, smoothstep(0.0, 1.6, vW.y));
        float T = uRoom + (uTent - uRoom) * strat * inside;
        // fabric walls conduct a bit of heat to the outside
        float shell = (1.0 - inside) * step(abs(vW.x), 0.43) * step(abs(vW.z), 0.43) * step(vW.y, 1.63);
        T += shell * (uTent - uRoom) * 0.45 * smoothstep(0.0, 1.6, vW.y);
        vec3 d = vW - uLed; d.x = max(abs(d.x) - 0.3, 0.0);
        T += uLedHeat * exp(-dot(d, d) / 0.006) * 22.0;
        T += uLedHeat * exp(-dot(d, d) / 0.08) * 3.0 * inside;
        float t = (T - uLo) / (uHi - uLo);
        vec3 c = iron(t);
        // silhouettes read better with a rim term, like a real thermal image
        vec3 V = normalize(cameraPosition - vW);
        float rim = abs(dot(normalize(vN), V));
        float shade = (0.6 + 0.4 * rim) * (0.85 + 0.15 * abs(dot(normalize(vN), normalize(vec3(0.3, 1.0, 0.5)))));
        float iso = smoothstep(0.04, 0.0, abs(fract(T) - 0.5) - 0.46) * 0.12;
        gl_FragColor = vec4(c * shade + iso, 1.0);
      }`,
  });
}

/** Film look: vignette, a touch of grain and chromatic fringe at the edges. */
export const FilmShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.9 }, uGrain: { value: 0.035 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uVignette; uniform float uGrain; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float r = dot(d, d);
      vec2 off = d * r * 0.012;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      c *= mix(1.0, smoothstep(0.85, 0.15, r * 1.6), uVignette * 0.55);
      c += (rnd(vUv * 900.0) - 0.5) * uGrain;
      gl_FragColor = vec4(c, 1.0);
    }`,
};
