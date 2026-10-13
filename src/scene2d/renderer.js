import { animate, createTimeline, stagger } from 'animejs';
import { VERT, FRAG_LIGHT, FRAG_FINAL } from './shader.js';

// Escena 2D nueva: un pintor 2D dibuja la planta (con la misma lógica de
// síntomas, plagas, raíces y zonas para los tooltips del renderer anterior)
// sobre un lienzo fuera de pantalla, y un compositor WebGL2 le pone la luz,
// la atmósfera y el fondo. Las transiciones van con anime.js.

const PERF = /[?&]perf/.test(location.search);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export function makeScene2D(Base, D) {
  const { clamp, lerp, mixc, rgba, hash, C, LAMPS, LAMP_DIST } = D;

  return class Scene2D extends Base {
    constructor(visible) {
      const off = document.createElement('canvas');
      super(off);
      this.vis = visible;
      // sin GPU real (WebGL por software) esto sería lentísimo: mejor el dibujo anterior
      this.gl = visible.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true, powerPreference: 'high-performance' });
      if (!this.gl) throw new Error('WebGL2 con aceleración no disponible');
      const dbg = this.gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = dbg ? String(this.gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu)) throw new Error('WebGL por software: ' + gpu);
      // en pantallas de alta densidad la escena se dibuja a 1,5× como máximo y la calidad se adapta a los fps
      this.baseDpr = Math.min(1.5, window.devicePixelRatio || 1);
      this.dpr = this.baseDpr;
      this.q = { scale: 1, light: 0.5, frame: 16, slow: 0, fast: 0 };
      // capa de arriba para la regla y la lupa: no pasan por la luz
      this.ov = document.createElement('canvas');
      Object.assign(this.ov.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
      visible.after(this.ov);
      this.octx = this.ov.getContext('2d');
      this.fx = { light: 0, flick: 1, hover: 0, pulse: 1, intro: 1, fast: 0 };
      this.hoverAt = { x: 0, y: 0, r: 0 };
      this.drops = [];
      this.grad = new Map();
      this.lastPhase = null;
      this.lastOn = null;
      this.lampGeo = { x0: 0, x1: 0, y: 0, vis: 0, col: [1, 1, 1] };
      this.sunGeo = { x: 0, y: 0, up: 0 };
      this.P.lat = (() => { const p = new Path2D(); for (let t = 0.12; t < 0.9; t += 0.075) { const w = 0.38 * Math.sin(Math.PI * t); p.moveTo(t, 0); p.quadraticCurveTo(t + 0.05, w * 0.5, t + 0.13, w); p.moveTo(t, 0); p.quadraticCurveTo(t + 0.05, -w * 0.5, t + 0.13, -w); } return p; })();
      this.initGL();
      visible.addEventListener('pointerleave', () => this.setHover(null));
    }

    /* ---------------- WebGL ---------------- */
    initGL() {
      const gl = this.gl;
      const program = (frag, names) => {
        const pr = gl.createProgram();
        gl.attachShader(pr, compile(gl, gl.VERTEX_SHADER, VERT));
        gl.attachShader(pr, compile(gl, gl.FRAGMENT_SHADER, frag));
        gl.bindAttribLocation(pr, 0, 'aPos');
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
        const u = {};
        for (const n of names) u[n] = gl.getUniformLocation(pr, n);
        return { pr, u };
      };
      const names = ['uPlant', 'uLightTex', 'uRes', 'uTime', 'uDpr', 'uOut', 'uLight', 'uPPFD', 'uNight', 'uRH', 'uHeat', 'uRain', 'uCloud', 'uDay', 'uUV', 'uLeak', 'uIntro', 'uLampCol', 'uLamp', 'uFloorY', 'uSun', 'uHover', 'uPulse', 'uProx'];
      this.pLight = program(FRAG_LIGHT, names);
      this.pFinal = program(FRAG_FINAL, names);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const tex = (mip) => {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
      };
      this.tex = tex(true);
      this.lightTex = tex(false);
      this.fbo = gl.createFramebuffer();
      this.lightSize = [0, 0];
      // si la GPU se reinicia, se reconstruye todo
      this.vis.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
      this.vis.addEventListener('webglcontextrestored', () => { this.lost = false; this.initGL(); });
    }
    sizeLight(w, h) {
      const gl = this.gl;
      const lw = Math.max(64, Math.round(w * this.q.light)), lh = Math.max(64, Math.round(h * this.q.light));
      if (lw === this.lightSize[0] && lh === this.lightSize[1]) return;
      this.lightSize = [lw, lh];
      gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, lw, lh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.lightTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    /* calidad según el tiempo real entre cuadros (incluye la GPU, no solo el dibujo) */
    adapt() {
      const now = performance.now();
      if (this._lastFrame) {
        const ms = now - this._lastFrame;
        if (ms > 150) { this._lastFrame = now; return; } // pestaña oculta o vista 3D: no cuenta
        const q = this.q;
        q.frame = q.frame * 0.92 + ms * 0.08;
        if (q.frame > 24) { q.slow++; q.fast = 0; } else if (q.frame < 15) { q.fast++; q.slow = 0; } else { q.slow = 0; q.fast = 0; }
        if (q.slow > 20 && (q.scale > 0.5 || q.light > 0.3)) {
          if (q.light > 0.3) q.light = Math.max(0.3, q.light - 0.1);
          else q.scale = Math.max(0.5, q.scale - 0.15);
          q.slow = 0; q.frame = 18; this.applyScale();
        } else if (q.fast > 90 && (q.scale < 1 || q.light < 0.5)) {
          if (q.scale < 1) q.scale = Math.min(1, q.scale + 0.15); else q.light = Math.min(0.5, q.light + 0.1);
          q.fast = 0; this.applyScale();
        }
      }
      this._lastFrame = now;
    }
    applyScale() {
      const want = Math.max(0.75, this.baseDpr * this.q.scale);
      if (Math.abs(want - this.dpr) > 0.01) { this.dpr = want; this.resize(); this.view.init = false; }
      this.lightSize = [0, 0];
    }

    resize() {
      const r = this.vis.getBoundingClientRect();
      this.W = Math.max(200, r.width); this.H = Math.max(200, r.height);
      const w = Math.round(this.W * this.dpr), h = Math.round(this.H * this.dpr);
      for (const c of [this.cv, this.vis, this.ov]) { c.width = w; c.height = h; }
    }

    setSim(sim) {
      super.setSim(sim);
      this.lastPhase = null;
      // planta nueva: la escena se revela desde el centro
      if (!REDUCED) { this.fx.intro = 0; animate(this.fx, { intro: 1, duration: 1400, ease: 'outCubic' }); }
    }

    /* anillo que sigue a lo que está bajo el puntero */
    setHover(h) {
      const on = h ? 1 : 0;
      if (h) Object.assign(this.hoverAt, { x: h.x, y: h.y, r: Math.max(10 * this.dpr, Math.min(h.r, 90 * this.dpr)) });
      if (this._hoverOn === on && (!h || h === this._hoverHit)) return;
      this._hoverOn = on; this._hoverHit = h;
      this._hoverAnim?.pause();
      this._hoverAnim = animate(this.fx, { hover: on, duration: on ? 260 : 420, ease: on ? 'outBack(2)' : 'outQuad' });
    }
    hitTest(px, py) {
      const h = super.hitTest(px, py);
      this.setHover(h);
      return h;
    }

    /* ---------------- luz: encendido con parpadeo y modo timelapse ---------------- */
    updateLight(sim, E, dt) {
      const out = sim.o.mode === 'exterior';
      const speed = D.speed(), fast = D.running() ? smoothstep(0.3, 3, speed) : 0;
      this.fx.fast += (fast - this.fx.fast) * Math.min(1, dt * 3);
      let on, avg;
      if (out) {
        const w = sim.wx, hod = (sim.hour % 24) + 0.5;
        const ha = ((hod - 12) * 15 * Math.PI) / 180, phi = (w.lat * Math.PI) / 180;
        const sinE = Math.sin(phi) * Math.sin(w.dec) + Math.cos(phi) * Math.cos(w.dec) * Math.cos(ha);
        on = clamp(sinE * 4 + 0.3);
        avg = clamp(w.dl / 24 + 0.15);
        const f = this.fx.fast;
        const ha2 = ha * (1 - f), up = lerp(clamp(sinE * 1.6 + 0.1, -0.2, 1), 0.55, f);
        this.sunGeo = { x: this.cv.width * (0.5 - Math.sin(ha2) * 0.42), y: this.cv.height * (0.58 - clamp(up, -0.2, 1) * 0.5), up };
      } else {
        on = E.light ? 1 : 0;
        avg = sim.env.photo / 24;
        if (this.lastOn !== null && on && !this.lastOn && this.fx.fast < 0.3 && !REDUCED && sim.env.lamp === 'led') {
          // los drivers del LED arrancan con un parpadeo corto
          this._flick?.pause();
          this.fx.flick = 0;
          this._flick = animate(this.fx, { flick: [{ to: 0.6, duration: 70 }, { to: 0.1, duration: 90 }, { to: 0.85, duration: 80 }, { to: 0.35, duration: 110 }, { to: 1, duration: 900, ease: 'outQuart' }] });
        }
      }
      this.lastOn = on;
      const target = lerp(on, avg, this.fx.fast);
      this.fx.light += (target - this.fx.light) * Math.min(1, dt * (out ? 1.2 : 2.6));
      this.light = this.fx.light * (out ? 1 : this.fx.flick);
    }

    /* ---------------- cuadro ---------------- */
    drawFrame(sim, t, dt) {
      this._t0 = performance.now();
      const ctx = this.ctx, cw = this.cv.width, ch = this.cv.height;
      if (this.simRef !== sim) this.setSim(sim);
      if (!this.roots) this.roots = this.genRoots(sim.o.seed);
      this.updateView(sim, dt);
      const E = sim.lastE || sim.envNow(), out = sim.o.mode === 'exterior';
      this.updateLight(sim, E, dt);
      this.events(sim);
      this.hits = [];
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      this.drawPot(sim, t);
      if (!out) this.drawLampBody(sim, E); else this.lampGeo.vis = 0;
      if (sim.train.scrog) this.drawNet(sim);
      if (sim.stage !== 'germinacion' && !(sim.stage === 'muerta' && sim.main.nodes.length === 0)) this.drawPlant(sim, t);
      else this.drawSeed(sim);
      this.drawDrops();
      this.drawAir(sim, E, t);
      // regla y lupa arriba de todo, sin luz ni sombras
      const o = this.octx;
      o.setTransform(1, 0, 0, 1, 0, 0);
      o.clearRect(0, 0, cw, ch);
      const keep = this.ctx;
      this.ctx = o;
      this.drawRuler(sim);
      if (this.loupe && sim.stage === 'flor') this.drawLoupe(sim, t);
      this.ctx = keep;
      const t1 = performance.now();
      this.composite(sim, E, t);
      if (PERF) { this.gl.finish(); const t2 = performance.now(); const P = (window.__scene2d ||= { paint: 0, gpu: 0, n: 0 }); P.paint += t1 - this._t0; P.gpu += t2 - t1; P.n++; }
    }

    /* lo que pasó en el simulador desde el último cuadro */
    events(sim) {
      const ph = sim.phase();
      if (this.lastPhase && ph !== this.lastPhase && !REDUCED) {
        const H = Math.max(3, sim.height);
        this.pulseAt = [this.X(0), this.Y(H * 0.5)];
        this._pulse?.pause();
        this.fx.pulse = 0;
        this._pulse = animate(this.fx, { pulse: 1, duration: 1700, ease: 'outCubic' });
      }
      this.lastPhase = ph;
      if (sim.lastWater && sim.lastWater.hour !== this.lastWaterHour) {
        const first = this.lastWaterHour === -1;
        this.lastWaterHour = sim.lastWater.hour;
        if (!first && D.speed() <= 1 && !REDUCED) this.splash(sim);
      }
    }

    /* riego: gotas que caen escalonadas y salpican la tierra */
    splash(sim) {
      const wt = sim.potH();
      const n = 16;
      const fresh = [];
      for (let i = 0; i < n; i++) {
        const d = { x: (hash(i + sim.hour) - 0.5) * wt * 0.7, y: wt * 1.1 + 6 + hash(i * 3) * 6, a: 1, s: 0 };
        fresh.push(d);
      }
      this.drops.push(...fresh);
      createTimeline({ onComplete: () => { this.drops = this.drops.filter((d) => !fresh.includes(d)); } })
        .add(fresh, { y: 0.4, duration: 520, delay: stagger(45), ease: 'inQuad' })
        .add(fresh, { s: 1, a: 0, duration: 420, delay: stagger(45), ease: 'outQuad' }, '-=380');
    }
    drawDrops() {
      if (!this.drops.length) return;
      const ctx = this.ctx, dpr = this.dpr;
      for (const d of this.drops) {
        const x = this.X(d.x), y = this.Y(d.y);
        if (d.s > 0) {
          ctx.strokeStyle = `rgba(150,205,255,${0.8 * d.a})`; ctx.lineWidth = 1.2 * dpr;
          ctx.beginPath(); ctx.ellipse(x, y, (2 + d.s * 9) * dpr, (0.7 + d.s * 2.5) * dpr, 0, 0, Math.PI * 2); ctx.stroke();
        } else {
          const g = ctx.createLinearGradient(x, y - 7 * dpr, x, y);
          g.addColorStop(0, 'rgba(160,210,255,0)'); g.addColorStop(1, 'rgba(190,228,255,0.95)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y - 3 * dpr, 1.6 * dpr, 4 * dpr, 0, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    /* viento: unas líneas finas, y CO₂ enriquecido */
    drawAir(sim, E, t) {
      const ctx = this.ctx, cw = this.cv.width, ch = this.cv.height, dpr = this.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const air = E.airflow;
      if (air > 3) {
        ctx.lineWidth = dpr;
        const n = Math.round(3 + air / 14);
        for (let i = 0; i < n; i++) {
          const y = (hash(i) * 0.7 + 0.08) * ch, len = (40 + air * 1.2) * dpr;
          const x = ((t * (50 + air * 3) * dpr + hash(i + 9) * cw) % (cw + len)) - len;
          const g = ctx.createLinearGradient(x, 0, x + len, 0);
          g.addColorStop(0, 'rgba(220,235,255,0)'); g.addColorStop(0.5, `rgba(220,235,255,${0.04 + air / 1100})`); g.addColorStop(1, 'rgba(220,235,255,0)');
          ctx.strokeStyle = g;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + len / 2, y + Math.sin(t * 1.3 + i) * 6 * dpr, x + len, y); ctx.stroke();
        }
      }
      if (sim.o.mode !== 'exterior' && sim.env.co2 > 800) {
        ctx.fillStyle = 'rgba(200,230,255,0.3)'; ctx.font = `${9 * dpr}px system-ui`;
        for (let i = 0; i < 5; i++) { const ph = (t * 0.08 + hash(i)) % 1; ctx.fillText('CO₂', hash(i + 3) * cw * 0.9, ch * (1 - ph) * 0.8); }
      }
    }

    /* ---------------- lámpara ---------------- */
    drawLampBody(sim, E) {
      const ctx = this.ctx, e = sim.env, L = LAMPS[e.lamp], dpr = this.dpr;
      const ly = this.lampY(sim);
      const y = this.Y(ly), x0 = this.X(-Math.max(25, sim.width * 0.6)), x1 = this.X(Math.max(25, sim.width * 0.6));
      const col = mixc(L.color, [255, 140, 200], e.lamp === 'led' ? clamp((e.blue - 18) / 40) * 0.5 : 0);
      this.lampGeo = { x0, x1, y, vis: y > -20 ? 1 : 0, col: col.map((v) => v / 255) };
      if (y < -20) {
        ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = `${11 * dpr}px system-ui`; ctx.textAlign = 'center';
        ctx.fillText(`lámpara ${Math.round(ly - sim.height)} cm arriba ↑`, this.cv.width / 2, 14 * dpr);
        this.lampGeo = { x0: this.cv.width * 0.3, x1: this.cv.width * 0.7, y: -10 * dpr, vis: 1, col: col.map((v) => v / 255) };
        return;
      }
      // cables y driver
      const mx = (x0 + x1) / 2;
      ctx.strokeStyle = 'rgba(140,145,150,0.7)'; ctx.lineWidth = dpr;
      ctx.beginPath(); ctx.moveTo(mx - 40 * dpr, y - 8 * dpr); ctx.lineTo(mx - 70 * dpr, 0); ctx.moveTo(mx + 40 * dpr, y - 8 * dpr); ctx.lineTo(mx + 70 * dpr, 0); ctx.stroke();
      ctx.fillStyle = '#202327'; ctx.fillRect(mx - 16 * dpr, y - 20 * dpr, 32 * dpr, 10 * dpr);
      // cuerpo de aluminio
      const g = ctx.createLinearGradient(0, y - 9 * dpr, 0, y);
      g.addColorStop(0, '#4a4f56'); g.addColorStop(0.5, '#2a2e33'); g.addColorStop(1, '#16181b');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(x0, y - 9 * dpr, x1 - x0, 9 * dpr, 3 * dpr); ctx.fill();
      const on = this.light;
      if (e.lamp === 'led') {
        const n = Math.max(10, Math.round((x1 - x0) / (14 * dpr)));
        for (let i = 0; i < n; i++) {
          const x = x0 + ((i + 0.5) / n) * (x1 - x0);
          ctx.fillStyle = on > 0.3 ? (i % 4 === 0 ? `rgba(255,190,225,${0.4 + on * 0.6})` : `rgba(255,250,236,${0.4 + on * 0.6})`) : '#3a3d42';
          ctx.beginPath(); ctx.arc(x, y - 1.5 * dpr, 1.8 * dpr, 0, Math.PI * 2); ctx.fill();
        }
      } else {
        ctx.fillStyle = on > 0.3 ? rgba(L.color, 0.5 + on * 0.5) : '#555';
        ctx.beginPath(); ctx.ellipse(mx, y, (x1 - x0) * 0.18, 4 * dpr, 0, 0, Math.PI * 2); ctx.fill();
      }
    }

    /* ---------------- maceta ---------------- */
    drawPot(sim, t) {
      const ctx = this.ctx, h = this.potVis(sim), hydro = sim.S.hydro, dpr = this.dpr;
      const wt = sim.potH(), wb = wt * 0.78;
      const x0 = this.X(-wt / 2), x1 = this.X(wt / 2), xb0 = this.X(-wb / 2), xb1 = this.X(wb / 2), yt = this.Y(0), yb = this.Y(-h);
      this.floorY = yb;
      // sombra en el piso
      const sg = ctx.createRadialGradient((x0 + x1) / 2, yb, 0, (x0 + x1) / 2, yb, (x1 - x0) * 0.75);
      sg.addColorStop(0, 'rgba(0,0,0,0.55)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg; ctx.beginPath(); ctx.ellipse((x0 + x1) / 2, yb, (x1 - x0) * 0.75, 8 * dpr, 0, 0, Math.PI * 2); ctx.fill();
      const body = new Path2D();
      body.moveTo(x0, yt); body.lineTo(x1, yt); body.lineTo(xb1, yb); body.quadraticCurveTo((xb0 + xb1) / 2, yb + 5 * dpr, xb0, yb); body.closePath();
      const moist = clamp(sim.theta);
      let fill;
      if (hydro) fill = [70, 130, 170];
      else {
        const base = sim.S.coco ? [150, 104, 64] : sim.o.substrate === 'viva' ? [84, 62, 40] : [104, 78, 52];
        fill = mixc(base, [40, 30, 22], moist * 0.75);
      }
      ctx.fillStyle = rgba(fill, hydro ? 0.55 : 1); ctx.fill(body);
      ctx.save(); ctx.clip(body);
      // grano del sustrato
      if (!hydro) {
        for (let i = 0; i < 90; i++) {
          const u = hash(i * 1.7), v = hash(i * 3.1);
          ctx.fillStyle = i % 3 ? 'rgba(0,0,0,0.18)' : 'rgba(255,240,210,0.12)';
          ctx.fillRect(lerp(x0, x1, u), lerp(yt, yb, v), 1.6 * dpr, 1.6 * dpr);
        }
      }
      if (this.showRoots) this.drawRoots(sim, wt, wb, h, t);
      if (hydro && sim.env.aeration) {
        ctx.fillStyle = 'rgba(220,240,255,0.6)';
        for (let i = 0; i < 18; i++) { const ph = (t * 0.5 + hash(i)) % 1; ctx.beginPath(); ctx.arc(this.X((hash(i + 5) - 0.5) * wb * 0.5), this.Y(-h + ph * h), 1.5 * dpr, 0, Math.PI * 2); ctx.fill(); }
      }
      // tela de la maceta: volumen cilíndrico, más transparente si se ven las raíces
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      const a = this.showRoots ? 0.32 : 0.95;
      g.addColorStop(0, `rgba(14,15,17,${a})`); g.addColorStop(0.3, `rgba(48,51,56,${a})`); g.addColorStop(0.55, `rgba(38,41,45,${a})`); g.addColorStop(1, `rgba(10,11,12,${a})`);
      ctx.fillStyle = g; ctx.fill(body);
      if (!this.showRoots) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = dpr;
        for (let i = 1; i < 6; i++) { const y = lerp(yt, yb, i / 6); ctx.beginPath(); ctx.moveTo(lerp(x0, xb0, i / 6), y); ctx.lineTo(lerp(x1, xb1, i / 6), y); ctx.stroke(); }
      }
      ctx.restore();
      // borde y superficie del sustrato
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1.5 * dpr; ctx.stroke(body);
      const sf = ctx.createLinearGradient(0, yt - 4 * dpr, 0, yt + 4 * dpr);
      sf.addColorStop(0, rgba(mixc(fill, [255, 255, 255], 0.12))); sf.addColorStop(1, rgba(fill.map((v) => v * 0.6)));
      ctx.fillStyle = sf; ctx.beginPath(); ctx.ellipse((x0 + x1) / 2, yt, (x1 - x0) / 2, 4 * dpr, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#1d1f22'; ctx.beginPath(); ctx.roundRect(x0 - 3 * dpr, yt - 2 * dpr, x1 - x0 + 6 * dpr, 4 * dpr, 2 * dpr); ctx.fill();
      // indicador de humedad
      if (!hydro) {
        const bx = x1 + 7 * dpr, bh = (yb - yt) * moist;
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.roundRect(bx, yt, 4 * dpr, yb - yt, 2 * dpr); ctx.fill();
        const wg = ctx.createLinearGradient(0, yb - bh, 0, yb);
        wg.addColorStop(0, 'rgba(140,200,255,0.95)'); wg.addColorStop(1, 'rgba(60,130,230,0.95)');
        ctx.fillStyle = wg; ctx.beginPath(); ctx.roundRect(bx, yb - bh, 4 * dpr, bh, 2 * dpr); ctx.fill();
      }
      this.hits.push({ kind: 'pot', x: (x0 + x1) / 2, y: (yt + yb) / 2, r: (x1 - x0) / 2 });
    }

    /* ---------------- tallos ---------------- */
    drawStems(sim, segs, sy, z) {
      const ctx = this.ctx, s = this.view.s;
      const base = mixc(mixc(C.stem, C.purple, sy.coldStem * 0.6), C.wood, 0.15);
      const shade = z < 0 ? 0.72 : z > 0 ? 1.08 : 0.92;
      ctx.lineCap = 'round';
      for (const g of segs) {
        const w = Math.max(0.8, g.w * s);
        const c = mixc(base, C.wood, clamp(g.w / 2.2)).map((v) => v * shade);
        ctx.strokeStyle = rgba(c.map((v) => v * 0.62)); ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(this.X(g.x1), this.Y(g.y1)); ctx.lineTo(this.X(g.x2), this.Y(g.y2)); ctx.stroke();
        if (w > 2) {
          // brillo a lo largo del tallo
          const dx = g.y2 - g.y1, dy = g.x2 - g.x1, L = Math.hypot(dx, dy) || 1, off = w * 0.18;
          ctx.strokeStyle = rgba(mixc(c, [220, 240, 190], 0.25)); ctx.lineWidth = w * 0.35;
          ctx.beginPath(); ctx.moveTo(this.X(g.x1) - (dx / L) * off, this.Y(g.y1) - (dy / L) * off); ctx.lineTo(this.X(g.x2) - (dx / L) * off, this.Y(g.y2) - (dy / L) * off); ctx.stroke();
        }
        if (g.knuckle) { ctx.fillStyle = rgba(C.wood); ctx.beginPath(); ctx.arc(this.X(g.x2), this.Y(g.y2), w * 0.9, 0, Math.PI * 2); ctx.fill(); }
      }
    }

    /* degradé del folíolo en espacio unitario, cacheado por color */
    leafGrad(col) {
      const key = col.map((v) => (v / 6) | 0).join(',');
      let g = this.grad.get(key);
      if (!g) {
        const ctx = this.ctx;
        g = ctx.createLinearGradient(0, 0, 1, 0);
        g.addColorStop(0, rgba(col.map((v) => v * 0.7)));
        g.addColorStop(0.42, rgba(col));
        g.addColorStop(1, rgba(mixc(col, [235, 255, 200], 0.16)));
        if (this.grad.size > 600) this.grad.clear();
        this.grad.set(key, g);
      }
      return g;
    }
    sheen() {
      if (!this._sheen) {
        const g = this.ctx.createLinearGradient(0, -0.5, 0, 0.5);
        g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.3, 'rgba(255,255,255,0.13)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.12)');
        this._sheen = g;
      }
      return this._sheen;
    }

    /* ---------------- hojas ---------------- */
    drawLeaves(sim, leaves, sy, H, z, t) {
      const ctx = this.ctx, s = this.view.s, P = this.P;
      const shade = z < 0 ? 0.68 : z > 0 ? 1.06 : 0.9;
      const droop = Math.max(sy.droop, sy.wilt);
      const flowering = sim.stage === 'flor';
      const vs = sim.visScale || 1, lod = this.lod;
      for (const L of leaves) {
        const l = L.l;
        const size = l.size * (l.kind === 'cot' ? 0.9 : vs);
        if (size < 0.15) continue;
        const pos = clamp(L.y / H);
        const { c, fx } = this.leafColor(sy, pos, L);
        const col = c.map((v) => v * shade);
        const side = l.side;
        const depthLeaf = L.plane === 1 && L.z !== 0 ? true : L.z !== 0 && L.order === 0;
        let a = L.stemA - side * (depthLeaf ? 0.35 : 1.15);
        const age = (sim.hour - l.born) / 24;
        const sag = clamp(age / 40) * 0.25 + droop * (sy.wilt > sy.droop ? 0.9 : 0.55);
        a += side > 0 ? -sag : sag;
        if (depthLeaf) a = L.stemA + (side > 0 ? -0.25 : 0.25) - sag * 0.4 * side;
        const petLen = (l.kind === 'cot' ? 0.15 : 0.45) * size * (depthLeaf ? 0.45 : 1);
        const px = this.X(L.x), py = this.Y(L.y);
        const ex = px + Math.cos(a) * petLen * s, ey = py - Math.sin(a) * petLen * s;
        if (l.kind !== 'cot') {
          ctx.strokeStyle = rgba(mixc(col.map((v) => v * 0.85), C.purple, sy.coldStem * 0.7)); ctx.lineWidth = Math.max(0.6, size * 0.035 * s);
          ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo((px + ex) / 2, (py + ey) / 2 - size * s * 0.03, ex, ey); ctx.stroke();
        }
        const n = l.kind === 'cot' ? 2 : Math.max(1, l.n);
        const spread = l.kind === 'cot' ? 0.9 : Math.min(0.42, 2.7 / n) * (1 - 0.35 * droop);
        const axis = l.kind === 'cot' ? L.stemA - side * 1.35 : a;
        const lw = l.kind === 'cot' ? 0.55 : l.kind === 'reveg' ? 0.42 : sy.lw * (1 - 0.5 * sy.taco * clamp(pos * 1.4));
        const pathF = l.kind === 'cot' || l.kind === 'reveg' ? P.oval : size * s > 22 * lod ? P.ser : P.smooth;
        const big = size * s > 46 * lod;
        const detail = size * s > 12 * lod;
        const fill = detail ? this.leafGrad(col) : rgba(col);
        for (let i = 0; i < n; i++) {
          let k = i - (n - 1) / 2;
          if (l.kind === 'cot') k = i ? 0.5 : -0.5;
          let ang = axis + k * spread * (depthLeaf ? 1.1 : 1);
          ang -= (Math.cos(ang) >= 0 ? 1 : -1) * droop * 0.5 * Math.abs(Math.cos(ang));
          if (sy.claw > 0.3) ang -= (Math.cos(ang) >= 0 ? 1 : -1) * 0.25 * sy.claw;
          const len = size * (l.kind === 'cot' ? 0.5 : 1 - 0.12 * Math.pow(Math.abs(k), 1.15)) * s;
          if (len < 1) continue;
          const W = len * lw;
          const ca = Math.cos(ang), sa = Math.sin(ang);
          ctx.setTransform(len * ca, -len * sa, -W * sa, -W * ca, ex, ey);
          ctx.fillStyle = fill;
          ctx.fill(pathF);
          if (fx.inter > 0.05) {
            ctx.fillStyle = rgba(mixc(col, fx.interCol, fx.inter * 0.85)); ctx.fill(pathF);
            ctx.strokeStyle = rgba(col); ctx.lineWidth = 0.09; ctx.stroke(P.vein);
          } else if (detail) {
            // nervadura central clara y laterales finas
            ctx.strokeStyle = rgba(mixc(col, [230, 250, 200], 0.35), 0.85); ctx.lineWidth = 0.028; ctx.beginPath(); ctx.moveTo(0.02, 0); ctx.lineTo(0.96, 0); ctx.stroke();
            if (big) { ctx.strokeStyle = rgba(col.map((v) => v * 0.78), 0.7); ctx.lineWidth = 0.014; ctx.stroke(P.lat); }
          }
          if (big) { ctx.fillStyle = this.sheen(); ctx.fill(pathF); ctx.strokeStyle = rgba(col.map((v) => v * 0.55), 0.6); ctx.lineWidth = 0.018; ctx.stroke(pathF); }
          if (fx.edge > 0.05) { ctx.strokeStyle = rgba(mixc(C.yellow, C.brown, fx.edge), Math.min(1, fx.edge * 1.2)); ctx.lineWidth = 0.18 * fx.edge; ctx.stroke(pathF); }
          if (fx.tip > 0.08) { ctx.fillStyle = rgba(C.brown, Math.min(1, fx.tip * 1.4)); ctx.save(); ctx.translate(1 - 0.25 * fx.tip, 0); ctx.scale(fx.tip, 1); ctx.translate(-1, 0); ctx.fill(P.tip); ctx.restore(); }
          if (fx.spots > 0.05 && detail) {
            ctx.fillStyle = rgba(fx.spotCol || C.brown, 0.9);
            const ns = Math.ceil(fx.spots * 5);
            for (let j = 0; j < ns; j++) { const u = 0.2 + hash(l.id * 7 + i * 13 + j) * 0.6, v = (hash(l.id + i + j * 5) - 0.5) * 0.5; ctx.beginPath(); ctx.ellipse(u, v, 0.035, 0.09, 0, 0, Math.PI * 2); ctx.fill(); }
          }
          if (fx.pm > 0.02 && detail) {
            ctx.fillStyle = `rgba(245,245,240,${Math.min(0.85, 0.35 + fx.pm)})`;
            const np = Math.ceil(fx.pm * 7);
            for (let j = 0; j < np; j++) { const u = 0.15 + hash(l.id * 3 + i + j * 7) * 0.7, v = (hash(l.id + j * 11 + i) - 0.5) * 0.5; ctx.beginPath(); ctx.ellipse(u, v, 0.06 + fx.pm * 0.05, 0.16, 0, 0, Math.PI * 2); ctx.fill(); }
          }
          if (sy.mites > 0.03 && detail) {
            ctx.fillStyle = 'rgba(250,245,190,0.85)';
            const nm = Math.ceil(sy.mites * 14);
            for (let j = 0; j < nm; j++) ctx.fillRect(0.12 + hash(l.id + j * 3 + i) * 0.8, (hash(l.id * 5 + j + i) - 0.5) * 0.6, 0.02, 0.05);
          }
          if (sy.thrips > 0.03 && detail && hash(l.id + 41) < sy.thrips * 2) {
            ctx.fillStyle = 'rgba(225,230,235,0.75)';
            ctx.fillRect(0.3, -0.12, 0.35 * Math.min(1, sy.thrips * 2), 0.07); ctx.fillRect(0.45, 0.04, 0.25 * Math.min(1, sy.thrips * 2), 0.06);
          }
        }
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (size * s > 6) this.hits.push({ kind: 'leaf', x: ex, y: ey, r: size * s * 0.7, L, pos, fx, flowering });
      }
    }

    /* cáliz con volumen (degradé radial cacheado por color) */
    calyxGrad(col) {
      const key = 'c' + col.map((v) => (v / 6) | 0).join(',');
      let g = this.grad.get(key);
      if (!g) {
        g = this.ctx.createRadialGradient(-0.35, -0.4, 0.05, 0, 0, 1);
        g.addColorStop(0, rgba(mixc(col, [245, 255, 225], 0.45)));
        g.addColorStop(0.55, rgba(col));
        g.addColorStop(1, rgba(col.map((v) => v * 0.55)));
        this.grad.set(key, g);
      }
      return g;
    }

    /* ---------------- cogollos ---------------- */
    drawBuds(sim, buds, sy, H, z, t) {
      if (!buds.length) return;
      if (sim.sex === 'macho') return super.drawBuds(sim, buds, sy, H, z, t);
      const ctx = this.ctx, s = this.view.s, dpr = this.dpr;
      const tri = sim.trichomes(), pist = sim.pistils();
      const shade = z < 0 ? 0.72 : z > 0 ? 1.05 : 0.92;
      const purple = sim.Q.purple, bot = sim.dis.botrytis, fox = sim.Q.fox > 4;
      for (const b of buds) {
        if (b.mass < 0.002) continue;
        const m = b.mass;
        let L = 4.4 * Math.pow(m, 0.4) * (b.tip ? 1.4 : 0.85), Wd = L * (b.tip ? 0.48 : 0.62);
        if (sim.pgr) { L *= 0.9; Wd *= 1.08; }
        const Ls = L * s, Ws = Wd * s;
        if (Ls < 1.2) continue;
        const cx = this.X(b.x), cy = this.Y(b.y);
        const ang = b.tip ? b.a : b.a + (hash(b.x * 13 + b.y) - 0.5) * 0.6;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const seed = Math.round(b.x * 101 + b.y * 37);
        const isBot = bot > 0.02 && hash(seed) < bot * 1.4;
        let calyx = mixc(C.calyx, sy.tone, 0.15);
        calyx = mixc(calyx, [214, 228, 196], tri.density * 0.3);
        calyx = mixc(calyx, [168, 104, 190], purple * 0.6);
        if (sim.pgr) calyx = mixc(calyx, [70, 96, 50], 0.4);
        if (isBot) calyx = mixc(calyx, [120, 100, 80], 0.75);
        calyx = calyx.map((q) => q * shade);
        const n = Math.max(4, Math.min(30, Math.round(Ls / 2.3)));
        // silueta con sombra interna
        ctx.setTransform(Ls * ca, -Ls * sa, -Ws * sa, -Ws * ca, cx, cy);
        ctx.fillStyle = rgba(calyx.map((q) => q * 0.55));
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(0.05, 0.62, 0.7, 0.62, 1, 0); ctx.bezierCurveTo(0.7, -0.62, 0.05, -0.62, 0, 0); ctx.fill();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const cr = Math.max(1.1, Ws * 0.3);
        const order = [...Array(n).keys()].sort((i, j) => hash(seed + j * 7) - hash(seed + i * 7));
        for (const i of order) {
          const u = (i + 0.5) / n;
          let v = (hash(seed + i * 7) - 0.5) * 1.0 * Math.sin(Math.PI * Math.min(1, u * 1.05 + 0.08));
          if (fox && b.tip && u > 0.7) v *= 0.4;
          const px = cx + ca * u * Ls - sa * v * Ws, py = cy - (sa * u * Ls + ca * v * Ws);
          const rr = cr * (0.75 + 0.5 * hash(seed + i)) * (fox && b.tip && u > 0.75 ? 0.7 : 1);
          const cc = mixc(calyx, [200, 230, 150], 0.18 * hash(seed + i * 5));
          if (rr > 1.4) {
            ctx.setTransform(1, 0, 0, 1, px, py); ctx.rotate(-ang); ctx.scale(rr * 0.8, rr);
            ctx.fillStyle = this.calyxGrad(cc); ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
          } else { ctx.fillStyle = rgba(cc); ctx.beginPath(); ctx.ellipse(px, py, rr * 0.8, rr, -ang, 0, Math.PI * 2); ctx.fill(); }
          if (!isBot && rr > 1.6) {
            const pc = hash(seed + i * 11) < pist ? mixc(C.pistilO, [150, 80, 40], clamp((pist - 0.6) * 2) * hash(seed + i)) : C.pistilW;
            ctx.strokeStyle = rgba(pc); ctx.lineWidth = Math.max(0.6, rr * 0.13);
            const dir = ang + (hash(seed + i * 3) - 0.5) * 2.2;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.bezierCurveTo(px + Math.cos(dir) * rr * 1.1, py - Math.sin(dir) * rr * 1.1 - rr * 0.6, px + Math.cos(dir + 0.9) * rr * 1.8, py - Math.sin(dir + 0.9) * rr * 1.6, px + Math.cos(dir + 0.4) * rr * 2.3, py - Math.sin(dir + 0.4) * rr * 2.3); ctx.stroke();
          }
        }
        // escarcha: tricomas que destellan con la luz
        if (tri.density > 0.05 && !isBot) {
          const nt = Math.round(tri.density * n * 1.5);
          const rr = Math.max(0.6 * dpr, s * 0.065);
          for (let i = 0; i < nt; i++) {
            const u = hash(seed * 3 + i), v = (hash(seed + i * 17) - 0.5) * 0.95;
            const px = cx + ca * u * Ls - sa * v * Ws, py = cy - (sa * u * Ls + ca * v * Ws);
            const r = hash(seed + i * 29);
            const tw = (0.45 + 0.4 * Math.sin(t * (2 + hash(i) * 3) + i) * this.light) * 0.8;
            ctx.fillStyle = r < tri.amber ? `rgba(240,175,80,${0.95 * tw})` : r < tri.amber + tri.cloudy ? `rgba(255,255,252,${0.95 * tw})` : `rgba(235,248,255,${0.6 * tw})`;
            ctx.beginPath(); ctx.arc(px, py, rr, 0, Math.PI * 2); ctx.fill();
          }
        }
        if (isBot) {
          ctx.fillStyle = 'rgba(160,160,160,0.75)';
          for (let i = 0; i < 12; i++) { ctx.beginPath(); ctx.arc(cx + ca * hash(seed + i) * Ls + (hash(i + seed) - 0.5) * Ws, cy - sa * hash(seed + i) * Ls, Math.max(1, Ws * 0.12), 0, Math.PI * 2); ctx.fill(); }
        }
        if (sim.pollinated && sim.B.seed > 0.5) {
          ctx.fillStyle = 'rgba(92,70,44,0.95)';
          const ns = Math.min(6, Math.ceil((sim.B.seed / Math.max(1, sim.B.flower)) * 18));
          for (let i = 0; i < ns; i++) { const u = hash(seed + i * 41), v = (hash(seed * 7 + i) - 0.5) * 0.6; ctx.beginPath(); ctx.ellipse(cx + ca * u * Ls - sa * v * Ws, cy - (sa * u * Ls + ca * v * Ws), Math.max(1, s * 0.18), Math.max(1, s * 0.12), -ang, 0, Math.PI * 2); ctx.fill(); }
        }
        if (sim.herm > 0.05 && hash(seed + 5) < sim.herm) {
          ctx.fillStyle = 'rgba(232,212,90,0.95)';
          for (let i = 0; i < 3; i++) { const u = 0.3 + hash(seed + i * 9) * 0.6; ctx.beginPath(); ctx.ellipse(cx + ca * u * Ls + Ws * 0.5, cy - sa * u * Ls, Math.max(1.2, Ws * 0.12), Math.max(2, Ws * 0.32), -ang + 0.5, 0, Math.PI * 2); ctx.fill(); }
        }
        if (sim.pests.caterpillars > 0.05 && hash(seed + 77) < sim.pests.caterpillars) {
          ctx.strokeStyle = '#7da23c'; ctx.lineWidth = Math.max(1.5, s * 0.3); ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(cx + Ws * 0.3, cy); ctx.quadraticCurveTo(cx + Ws * 0.8, cy - Ls * 0.2, cx + Ws * 0.2, cy - Ls * 0.4); ctx.stroke();
        }
        this.hits.push({ kind: 'bud', x: cx + ca * Ls * 0.5, y: cy - sa * Ls * 0.5, r: Math.max(6, Ls * 0.6), m, b, bot: isBot });
      }
    }

    /* ---------------- composición en la GPU ---------------- */
    composite(sim, E, t) {
      const gl = this.gl, w = this.vis.width, h = this.vis.height;
      if (this.lost || gl.isContextLost()) return;
      this.sizeLight(w, h); // antes de enganchar texturas: re-crea la de luz en la unidad activa
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.cv);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindVertexArray(this.vao);
      // pasada 1: luz a media resolución (sin la textura de luz enganchada: se escribe en ella)
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, this.lightSize[0], this.lightSize[1]);
      gl.useProgram(this.pLight.pr);
      this.uniforms(this.pLight.u, sim, E, t, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // pasada 2: la planta y el acabado
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.pFinal.pr);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.lightTex);
      gl.activeTexture(gl.TEXTURE0);
      this.uniforms(this.pFinal.u, sim, E, t, w, h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    uniforms(u, sim, E, t, w, h) {
      const gl = this.gl, out = sim.o.mode === 'exterior', lg = this.lampGeo, e = sim.env;
      gl.uniform1i(u.uPlant, 0);
      gl.uniform1i(u.uLightTex, 1);
      gl.uniform2f(u.uRes, w, h);
      gl.uniform1f(u.uTime, t);
      gl.uniform1f(u.uDpr, this.dpr);
      gl.uniform1f(u.uOut, out ? 1 : 0);
      gl.uniform1f(u.uLight, out ? 0 : clamp(this.light));
      gl.uniform1f(u.uPPFD, out ? 0 : clamp(Math.min(e.ppfd, LAMPS[e.lamp].maxPPFD) / 1200));
      gl.uniform1f(u.uNight, out ? clamp(1 - this.light) * 0.85 : clamp(1 - this.light) * 0.7);
      gl.uniform1f(u.uRH, clamp((E.rh - 62) / 30));
      gl.uniform1f(u.uHeat, clamp(sim.stress.heat * 1.3));
      gl.uniform1f(u.uRain, E.rain ? 1 : 0);
      gl.uniform1f(u.uCloud, out && sim.wx ? sim.wx.cloud : 1);
      gl.uniform1f(u.uDay, out ? clamp(this.light) : 0);
      gl.uniform1f(u.uUV, !out && e.uv ? 1 : 0);
      gl.uniform1f(u.uLeak, !out && e.lightLeak && !E.light && E.leak ? 1 : 0);
      gl.uniform1f(u.uIntro, this.fx.intro);
      gl.uniform3f(u.uLampCol, lg.col[0], lg.col[1], lg.col[2]);
      gl.uniform4f(u.uLamp, lg.x0, lg.x1, lg.y, lg.vis);
      gl.uniform1f(u.uFloorY, this.floorY || h * 0.9);
      gl.uniform3f(u.uSun, this.sunGeo.x, this.sunGeo.y, out ? this.sunGeo.up : 0);
      gl.uniform4f(u.uHover, this.hoverAt.x, this.hoverAt.y, this.hoverAt.r, this.fx.hover);
      const pc = this.pulseAt || [w / 2, h / 2];
      gl.uniform3f(u.uPulse, pc[0], pc[1], this.fx.pulse);
      gl.uniform1f(u.uProx, E.prox || 0);
    }
  };
}
