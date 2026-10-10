import * as THREE from 'three';

// Escenario de exterior: cuando el simulador está en modo exterior las macetas
// salen de la carpa a un patio con cielo, sol, nubes y lluvia.

function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#4a6a2c';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const l = 30 + Math.random() * 30, h = 70 + Math.random() * 40;
    g.fillStyle = `hsl(${h} 45% ${l}%)`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 1.5, 2 + Math.random() * 4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(36, 36);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildOutdoor(scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  // cielo: degradé con disco de sol
  const sky = {
    uTop: { value: new THREE.Color(0x4f8fe0) },
    uBottom: { value: new THREE.Color(0xd6eaff) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunI: { value: 1 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(32, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: sky,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop, uBottom, uSunDir; uniform float uSunI; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          float t = clamp(d.y * 1.7 + 0.12, 0.0, 1.0);
          vec3 c = mix(uBottom, uTop, t);
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          c += vec3(1.0, 0.92, 0.75) * (pow(s, 700.0) * 4.0 + pow(s, 10.0) * 0.22) * uSunI;
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -1;
  group.add(dome);

  // pasto, un deck de madera bajo las macetas y lomas lejanas
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 48), new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  ground.receiveShadow = true;
  group.add(ground);
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.85 });
  for (let i = 0; i < 9; i++) {
    const plank = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.03, 0.155), wood);
    plank.position.set(0, 0.012, -0.68 + i * 0.17);
    plank.receiveShadow = plank.castShadow = true;
    group.add(plank);
  }
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x3d5a32, roughness: 1, flatShading: true });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3, r = 22 + (i % 3) * 3;
    const hill = new THREE.Mesh(new THREE.SphereGeometry(5 + (i % 4) * 2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), hillMat);
    hill.scale.y = 0.35 + (i % 3) * 0.12;
    hill.position.set(Math.cos(a) * r, -0.2, Math.sin(a) * r);
    group.add(hill);
  }

  // cerco de madera
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.07, 0.9, 0.07), wood, 40);
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.05, 1), wood, 80);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const R = 3.6;
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    posts.setMatrixAt(i, m.makeTranslation(Math.cos(a) * R, 0.45, Math.sin(a) * R));
    const a2 = a + Math.PI / 40;
    q.setFromAxisAngle(up, -a2);
    for (let k = 0; k < 2; k++) {
      m.compose(new THREE.Vector3(Math.cos(a2) * R, 0.35 + k * 0.35, Math.sin(a2) * R), q, new THREE.Vector3(1, 1, 2 * R * Math.sin(Math.PI / 40) + 0.02));
      rails.setMatrixAt(i * 2 + k, m);
    }
  }
  posts.castShadow = rails.castShadow = true;
  group.add(posts, rails);

  // un par de árboles
  const trunk = new THREE.MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3f6b30, roughness: 0.9, flatShading: true });
  for (const [x, z, s] of [[-2.6, -2.2, 1.1], [2.9, -1.6, 0.9], [-1.4, 3.0, 0.8]]) {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * s, 0.09 * s, 1.4 * s, 8), trunk);
    t.position.set(x, 0.7 * s, z);
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75 * s, 1), leaf);
    c.position.set(x, 1.75 * s, z);
    t.castShadow = c.castShadow = true;
    group.add(t, c);
  }

  // techo contra la lluvia (policarbonato sobre cuatro postes)
  const cover = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.01, 1.6), new THREE.MeshStandardMaterial({ color: 0xdfeef5, transparent: true, opacity: 0.35, roughness: 0.2 }));
  roof.position.y = 2.05;
  cover.add(roof);
  for (const [x, z] of [[-0.78, -0.78], [0.78, -0.78], [-0.78, 0.78], [0.78, 0.78]]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.05, 8), new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.7, roughness: 0.35 }));
    p.position.set(x, 1.025, z);
    p.castShadow = true;
    cover.add(p);
  }
  group.add(cover);

  // lluvia: segmentos que caen alrededor de las macetas
  const N = 900;
  const pos = new Float32Array(N * 6);
  const drops = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 4, y: Math.random() * 3.2, v: 3.5 + Math.random() * 1.5 }));
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xbfd6ea, transparent: true, opacity: 0.45 }));
  rain.frustumCulled = false;
  rain.visible = false;
  group.add(rain);

  function updateRain(dt, on, covered, wind) {
    rain.visible = on;
    if (!on) return;
    for (let i = 0; i < N; i++) {
      const d = drops[i];
      d.y -= d.v * dt;
      d.x += wind * 0.6 * dt;
      const under = covered && Math.abs(d.x) < 0.8 && Math.abs(d.z) < 0.8;
      if (d.y < 0 || (under && d.y < 2.05)) { d.y = 3.2; d.x = (Math.random() - 0.5) * 4; d.z = (Math.random() - 0.5) * 4; }
      const o = i * 6;
      pos[o] = d.x; pos[o + 1] = d.y; pos[o + 2] = d.z;
      pos[o + 3] = d.x - wind * 0.02; pos[o + 4] = d.y + 0.07; pos[o + 5] = d.z;
    }
    rainGeo.attributes.position.needsUpdate = true;
  }

  return { group, sky, cover, updateRain };
}
