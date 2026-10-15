// Compositor de la escena 2D. Toda la luz y la atmósfera se calculan acá; la
// planta llega como textura (uPlant) pintada por el pintor 2D. Coordenadas en
// píxeles con y hacia abajo, igual que el canvas.

export const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uPlant;
uniform vec2 uRes;
uniform float uTime, uDpr;
uniform float uOut, uLight, uPPFD, uNight, uRH, uHeat, uRain, uCloud, uDay, uUV, uLeak, uIntro;
uniform vec3 uLampCol;
uniform vec4 uLamp;      // x0, x1, y, visible
uniform float uFloorY;
uniform vec3 uSun;       // x, y, sobre el horizonte (0..1)
uniform vec4 uHover;     // x, y, radio, intensidad
uniform vec3 uPulse;     // x, y, fase 0..1
uniform float uProx;     // lámpara muy cerca de la copa
uniform vec3 uTent;      // pared del fondo de la carpa: x izquierda, x derecha, y del techo (px, a escala real)
in vec2 vUv;
out vec4 o;

float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n2(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }

vec4 plantAt(vec2 p){ return texture(uPlant, p / uRes); }
float alphaAt(vec2 p){ return texture(uPlant, p / uRes).a; }

vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

// distancia de p al segmento de la barra LED
float barDist(vec2 p){ vec2 a = vec2(uLamp.x, uLamp.z), b = vec2(uLamp.y, uLamp.z); vec2 pa = p - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * t); }

// cuánto tapa la planta el camino entre p y la lámpara (rayos entre las hojas)
float occlusion(vec2 p, vec2 L){
  float occ = 0.0;
  // sobre una versión difusa de la planta: sombras suaves, sin copias de las hojas
  for (int i = 1; i <= 12; i++){ float t = float(i) / 13.0; occ += textureLod(uPlant, mix(p, L, t) / uRes, 2.5).a; }
  return exp(-occ * 0.5);
}

// distancia de p al segmento ab
float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * t); }
// un parante de la carpa: tubo gris con brillo en el centro
vec3 pole(vec3 c, float d, float w, float lit){
  float k = smoothstep(w, w * 0.45, d);
  vec3 col = vec3(0.16, 0.17, 0.18) + vec3(0.22) * smoothstep(w * 0.5, 0.0, d) * (0.25 + lit * 1.5);
  return mix(c, col, k);
}
// mylar arrugado: u corre a lo largo de los pliegues
vec3 mylar(vec2 q, float u, float lit){
  float warp = fbm(q * vec2(1.6, 3.0)) * 1.6;
  float folds = sin(u + warp) * 0.5 + 0.5;
  float crinkle = fbm(q * vec2(30.0, 14.0) + 3.1);
  vec3 base = vec3(0.075, 0.08, 0.088) + vec3(0.01) * folds;
  return base + uLampCol * lit * (0.12 + 0.24 * pow(folds, 4.0) + 0.18 * pow(crinkle, 3.0));
}

// interior: una carpa vista desde la puerta abierta. Pared del fondo, paredes
// laterales y techo de mylar en perspectiva, parantes, piso, ventilador de
// pinza en el parante izquierdo y filtro de carbón colgado del techo.
vec3 indoorBg(vec2 p, out float lit){
  float U = uRes.y, W = uRes.x, H = uRes.y;
  vec2 q = p / U;
  vec2 lc = vec2((uLamp.x + uLamp.y) * 0.5, uLamp.z);
  float d = length((p - lc) / U * vec2(0.85, 1.0));
  lit = uLight * (0.2 + 0.8 * uPPFD) * exp(-d * 2.1);
  float bx0 = uTent.x, bx1 = uTent.y, bt = max(uTent.z, 2.0), fy = uFloorY;
  float ww = bx1 - bx0;   // ancho de la pared del fondo: mide los accesorios
  vec3 c;
  float tl = (bx0 - p.x) / max(bx0, 1.0), tr = (p.x - bx1) / max(W - bx1, 1.0);
  float tc = (bt - p.y) / bt, tf = (p.y - fy) / max(1.0, H - fy);
  bool left = tl > 0.0 && p.y > bt * (1.0 - tl) && p.y < fy + (H - fy) * tl;
  bool right = tr > 0.0 && p.y > bt * (1.0 - tr) && p.y < fy + (H - fy) * tr;
  if (left || right){
    float t = left ? tl : tr;
    // la pared lateral recibe la luz de costado: más oscura y con pliegues verticales
    float lw = lit * (0.55 + 0.3 * (1.0 - t));
    c = mylar(q * vec2(0.6, 1.0) + (left ? 0.0 : 7.0), t * 26.0, lw) * (0.78 - 0.18 * t);
  } else if (p.y < bt){
    // techo
    c = mylar(q * vec2(1.0, 0.4) + 3.0, q.x * 40.0, lit * 0.5) * (0.6 - 0.15 * tc);
  } else if (p.y > fy){
    // piso de la carpa: lona oscura con costuras que fugan al fondo
    float k = tf;
    vec2 fq = vec2((p.x - W * 0.5) / mix(bx1 - bx0, W * 1.6, k), k);
    c = vec3(0.05, 0.055, 0.06) * (1.0 - k * 0.5) + uLampCol * lit * 0.14 * exp(-k * 5.0);
    c += vec3(0.015) * smoothstep(0.012, 0.0, abs(fract(fq.x * 4.0) - 0.5) - 0.48);
    c += vec3(0.02) * n2(p * 0.05);
  } else {
    // pared del fondo
    c = mylar(q, q.x * 52.0, lit);
    // cierre (zipper) de la ventana de ventilación arriba a la derecha
    vec2 vc = vec2(bx1 - ww * 0.14, bt + ww * 0.13);
    float vr = length(p - vc) / ww;
    c = mix(c, vec3(0.03), smoothstep(0.075, 0.07, vr) * 0.85);
    c += vec3(0.1) * smoothstep(0.006, 0.0, abs(vr - 0.077));
  }
  // parantes: el marco del fondo y las aristas hacia adelante
  float pw = max(ww * 0.009, 1.5 * uDpr);   // parante de ~1,6 cm
  float eb = min(min(segD(p, vec2(bx0, bt), vec2(bx1, bt)), segD(p, vec2(bx0, fy), vec2(bx1, fy))),
                 min(segD(p, vec2(bx0, bt), vec2(bx0, fy)), segD(p, vec2(bx1, bt), vec2(bx1, fy))));
  c = pole(c, eb, pw, lit);
  float tt = clamp(min(tl, tr) < 0.0 ? max(tl, tr) : 0.0, 0.0, 1.0);
  float ed = min(min(segD(p, vec2(bx0, bt), vec2(0.0, 0.0)), segD(p, vec2(bx1, bt), vec2(W, 0.0))),
                 min(segD(p, vec2(bx0, fy), vec2(0.0, H)), segD(p, vec2(bx1, fy), vec2(W, H))));
  c = pole(c, ed, pw * (1.0 + 2.2 * tt), lit);
  // esquineros
  for (int i = 0; i < 4; i++){
    vec2 k = vec2(i < 2 ? bx0 : bx1, (i == 0 || i == 2) ? bt : fy);
    vec2 dd = abs(p - k);
    c = mix(c, vec3(0.06), smoothstep(pw * 2.4, pw * 2.0, max(dd.x, dd.y)));
  }
  // barra del techo (la lámpara cuelga de acá)
  float by = bt * 0.55;
  c = pole(c, segD(p, vec2(bx0 * 0.45, by), vec2(W - bx0 * 0.45, by)), pw * 1.2, lit);
  // filtro de carbón colgado del techo, con la manguera hacia la ventana
  vec2 fc = vec2(bx1 - ww * 0.14, bt + ww * 0.13);
  vec2 fsz = vec2(ww * 0.15, ww * 0.055);
  vec2 fd = p - (fc + vec2(-ww * 0.2, 0.0));
  vec2 fb = abs(fd) - fsz;
  float fbox = length(max(fb, 0.0)) + min(max(fb.x, fb.y), 0.0) - ww * 0.015;
  if (fbox < 0.0){
    vec2 hg = fract(p / (5.0 * uDpr)) - 0.5;
    float holes = 1.0 - 0.55 * smoothstep(0.28, 0.16, length(hg));   // chapa perforada
    float shade = 0.7 + 0.3 * cos(fd.y / fsz.y * 1.5);
    c = vec3(0.13, 0.14, 0.15) * holes * shade + uLampCol * lit * 0.08;
    if (abs(fd.x) > fsz.x - ww * 0.01) c = vec3(0.05) * shade; // tapas
  }
  float hose = segD(p, fc + vec2(-ww * 0.05, 0.0), fc);
  c = mix(c, vec3(0.1, 0.105, 0.11) * (0.8 + 0.4 * sin(p.x * 0.8 / uDpr)), smoothstep(ww * 0.04, ww * 0.034, hose));
  // ventilador de pinza en el parante izquierdo: las aspas giran
  vec2 fanC = vec2(bx0 + ww * 0.03, fy - (fy - bt) * 0.62);
  vec2 fv = (p - fanC) / ww * 0.62;   // mismas proporciones que antes, con el ancho de la carpa
  float fr = length(fv);
  if (fr < 0.068){
    float ang = atan(fv.y, fv.x) + uTime * 9.0;
    float blades = smoothstep(0.25, 0.6, sin(ang * 3.0) * 0.5 + 0.5) * smoothstep(0.012, 0.018, fr);
    vec3 fcol = vec3(0.07, 0.075, 0.08) + vec3(0.05) * blades * 0.6;   // aspas borrosas
    float grill = smoothstep(0.004, 0.0, abs(fract(fr * 90.0) - 0.5) * 0.02);
    fcol += vec3(0.1) * grill * 0.35 + uLampCol * lit * 0.06;
    fcol = mix(fcol, vec3(0.18), smoothstep(0.0035, 0.0, abs(fr - 0.064)));  // aro
    fcol = mix(fcol, vec3(0.2), smoothstep(0.014, 0.011, fr));            // centro
    c = fcol;
  }
  c = pole(c, segD(p, fanC, vec2(bx0, fanC.y + ww * 0.11)), pw * 1.4, lit);   // pinza
  c *= 1.0 - 0.25 * smoothstep(0.3, 0.75, abs(p.x / W - 0.5));
  return c;
}

vec3 outdoorBg(vec2 p, out float lit){
  float U = uRes.y;
  float y = p.y / uRes.y;
  float day = uDay;
  vec3 top = mix(vec3(0.015, 0.025, 0.07), vec3(0.12, 0.33, 0.76), day);
  vec3 hor = mix(vec3(0.06, 0.07, 0.14), vec3(0.55, 0.72, 0.9), day);
  float low = clamp(1.0 - abs(uSun.z - 0.12) * 5.0, 0.0, 1.0) * step(0.0, uSun.z + 0.1);
  hor = mix(hor, vec3(1.0, 0.55, 0.28), low * 0.65);
  vec3 c = mix(top, hor, smoothstep(0.0, 1.0, y));
  float grey = 1.0 - uCloud;
  c = mix(c, mix(vec3(0.08, 0.09, 0.1), vec3(0.55, 0.58, 0.62), day), grey * 0.9);
  // sol
  float sd = length(p - uSun.xy) / U;
  float sunVis = smoothstep(-0.05, 0.05, uSun.z) * uCloud;
  c += vec3(1.0, 0.86, 0.6) * (smoothstep(0.034, 0.028, sd) * 2.5 + exp(-sd * 7.0) * 0.45) * sunVis;
  // estrellas
  float st = step(0.9965, h21(floor(p / (2.0 * uDpr)))) * (1.0 - day) * (0.5 + 0.5 * sin(uTime * 3.0 + p.x));
  c += vec3(st) * (1.0 - grey);
  // nubes que pasan
  vec2 cq = vec2(p.x / U * 1.6 + uTime * 0.012, y * 4.0);
  float f = fbm(cq) * 0.7 + fbm(cq * 2.3 - uTime * 0.01) * 0.3;
  float cover = mix(0.15, 0.95, grey);
  float cl = smoothstep(1.0 - cover, 1.0 - cover + 0.22, f) * smoothstep(0.85, 0.2, y);
  vec3 cloudCol = mix(vec3(0.12, 0.13, 0.17), vec3(0.95, 0.96, 0.98), day) * mix(1.0, 0.72, grey);
  cloudCol += vec3(1.0, 0.7, 0.45) * low * 0.4;
  c = mix(c, cloudCol, cl * 0.9);
  // lomas lejanas y pasto
  float x = p.x / U;
  float h1 = uFloorY - (0.16 + 0.07 * fbm(vec2(x * 1.3, 2.0))) * U;
  float h2 = uFloorY - (0.08 + 0.05 * fbm(vec2(x * 2.6, 7.0))) * U;
  vec3 hill1 = mix(vec3(0.03, 0.05, 0.06), vec3(0.32, 0.45, 0.42), day) * mix(1.0, 0.8, grey);
  vec3 hill2 = mix(vec3(0.025, 0.04, 0.03), vec3(0.24, 0.38, 0.2), day);
  if (p.y > h1) c = mix(c, hill1, 0.85);
  if (p.y > h2) c = hill2 * (0.9 + 0.2 * n2(p * 0.02));
  if (p.y > uFloorY){
    float k = (p.y - uFloorY) / U;
    vec3 g = mix(vec3(0.03, 0.05, 0.02), vec3(0.3, 0.42, 0.16), day) * (0.75 + 0.5 * n2(p * vec2(0.4, 0.08)));
    c = g * (1.0 - k * 0.5);
  }
  lit = day * uCloud;
  return c;
}

void main(){
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uRes;
  float U = uRes.y;
  vec2 px = vec2(1.0) * uDpr;

  // pulso de cambio de etapa: la planta "respira" desde su centro
  float pulse = uPulse.z;
  float bump = sin(pulse * 3.14159) * (1.0 - pulse);
  vec2 pp = uPulse.xy + (p - uPulse.xy) / (1.0 + 0.025 * bump);
  // calor: el aire ondula
  pp.x += sin(p.y * 0.05 / uDpr + uTime * 6.0) * uHeat * 1.6 * uDpr * smoothstep(0.7, 0.1, p.y / U);

  float lit;
  vec3 bg = uOut > 0.5 ? outdoorBg(p, lit) : indoorBg(p, lit);

  // sombra de la planta proyectada en la pared, lejos de la lámpara
  vec2 lc = uOut > 0.5 ? uSun.xy : vec2((uLamp.x + uLamp.y) * 0.5, uLamp.z);
  vec2 away = normalize(p - lc + 0.0001) * U * 0.03;
  float sh = textureLod(uPlant, (p - away) / uRes, 3.5).a;
  bg *= 1.0 - sh * 0.32 * clamp(lit * 2.5, 0.0, 1.0);

  vec4 pl = plantAt(pp);
  vec3 col = bg;

  // luz volumétrica de la lámpara, cortada por las hojas
  float shadow = 1.0;
  if (uOut < 0.5 && uLamp.w > 0.5 && p.y > uLamp.z){
    float t = (p.y - uLamp.z) / max(1.0, uFloorY - uLamp.z);
    float hw0 = (uLamp.y - uLamp.x) * 0.5;
    float hw = mix(hw0, hw0 * 1.7 + uRes.x * 0.1, t);
    float cx = (uLamp.x + uLamp.y) * 0.5;
    float cone = (1.0 - smoothstep(hw * 0.55, hw * 1.08, abs(p.x - cx))) * (1.0 - 0.55 * clamp(t, 0.0, 1.0));
    if (cone > 0.001){
      vec2 L = vec2(clamp(p.x, uLamp.x, uLamp.y), uLamp.z);
      shadow = occlusion(p, L);
      float vol = cone * shadow * uLight * (0.06 + 0.2 * uPPFD);
      // polvo en suspensión que brilla en el haz
      vec2 g = p / (10.0 * uDpr) + vec2(sin(uTime * 0.2) * 0.5, uTime * 0.35);
      vec2 id = floor(g), f = fract(g) - 0.5;
      float hh = h21(id);
      vec2 off = (vec2(h21(id + 3.1), h21(id + 7.7)) - 0.5) * 0.6;
      float mote = step(0.94, hh) * smoothstep(0.14, 0.0, length(f - off)) * (0.5 + 0.5 * sin(uTime * 2.0 + hh * 40.0));
      col += uLampCol * vol * (1.0 + mote * 6.0 * (1.0 - pl.a));
      if (uUV > 0.5) col += vec3(0.35, 0.12, 0.75) * vol * 0.4;
    }
  }
  // rayos de sol entre las hojas
  if (uOut > 0.5 && uSun.z > 0.0){
    float acc = 0.0;
    for (int i = 0; i < 18; i++){ float t = float(i) / 18.0; vec2 s = mix(p, uSun.xy, t * 0.6); acc += (1.0 - alphaAt(s)) * exp(-length(s - uSun.xy) / U * 2.4); }
    col += vec3(1.0, 0.85, 0.6) * acc / 18.0 * 0.35 * uSun.z * uCloud;
  }

  // la planta: iluminada por la lámpara, con borde brillante y translucidez
  if (pl.a > 0.001){
    float ex = alphaAt(pp + vec2(px.x * 2.0, 0.0)) - alphaAt(pp - vec2(px.x * 2.0, 0.0));
    float ey = alphaAt(pp + vec2(0.0, px.y * 2.0)) - alphaAt(pp - vec2(0.0, px.y * 2.0));
    float edge = clamp(length(vec2(ex, ey)), 0.0, 1.0);
    vec2 toL = normalize(lc - p);
    float facing = clamp(dot(vec2(-ex, -ey), toL) * 2.0, 0.0, 1.0);
    float light;
    if (uOut > 0.5) light = lit;
    else {
      vec2 L = vec2(clamp(p.x, uLamp.x, uLamp.y), uLamp.z);
      float dd = length(p - L) / U;
      light = uLight * uLamp.w * (0.35 + 0.65 * uPPFD) * exp(-dd * 1.1) * (p.y > uLamp.z ? occlusion(p, L) * 0.6 + 0.4 : 0.3);
    }
    float amb = uOut > 0.5 ? 0.38 + 0.12 * lit : 0.42;
    vec3 lc3 = uOut > 0.5 ? vec3(1.0, 0.95, 0.85) : uLampCol;
    vec3 c = pl.rgb * (amb + (uOut > 0.5 ? 0.45 : 0.9) * light * lc3);
    float green = clamp((pl.g - max(pl.r, pl.b)) * 3.5, 0.0, 1.0);
    c += pl.rgb * green * lc3 * light * 0.35;           // la luz atraviesa la hoja
    c += lc3 * edge * facing * light * 0.55;             // borde iluminado
    col = mix(col, c, pl.a);
  }

  // bloom: lo brillante de la planta (escarcha, pistilos) y la barra LED
  vec3 bl = textureLod(uPlant, pp / uRes, 4.0).rgb * textureLod(uPlant, pp / uRes, 4.0).a;
  float lum = dot(bl, vec3(0.3, 0.59, 0.11));
  col += bl * max(0.0, lum - 0.74) * 1.2 * (0.4 + uLight);
  if (uOut < 0.5 && uLamp.w > 0.5){
    float bd = barDist(p) / U;
    col += uLampCol * uLight * (exp(-bd * 55.0) * 0.9 + exp(-bd * 9.0) * 0.18) * (0.5 + uPPFD);
    if (uProx > 0.0) col += vec3(1.0, 0.35, 0.1) * uProx * uLight * 0.25 * exp(-bd * 6.0);
  }

  // humedad: neblina suave que se mueve
  float fog = fbm(p / U * vec2(2.5, 1.5) + vec2(uTime * 0.03, 0.0));
  col = mix(col, vec3(0.62, 0.68, 0.74) * (0.35 + 0.65 * max(lit, 0.25)), uRH * (uOut > 0.5 ? 0.12 : 0.28) * fog);
  // calor desde arriba
  col += vec3(0.32, 0.08, 0.0) * uHeat * smoothstep(0.65, 0.0, p.y / U) * 0.5;
  // lluvia
  if (uRain > 0.5){
    vec2 rp = vec2(p.x + p.y * 0.18, p.y) / uDpr;
    float r = step(0.985, h21(vec2(floor(rp.x / 3.0), floor((rp.y + uTime * 900.0 + h21(vec2(floor(rp.x / 3.0))) * 300.0) / 34.0))));
    col += vec3(0.6, 0.7, 0.8) * r * 0.22;
    col *= 0.92;
  }
  // fuga de luz nocturna
  if (uLeak > 0.0){ float ld = length(p - vec2(uRes.x - 30.0 * uDpr, 60.0 * uDpr)) / U; col += vec3(1.0, 0.92, 0.65) * exp(-ld * 4.0) * 0.5 * uLeak; }
  // noche: frío y oscuro
  col *= mix(vec3(1.0), vec3(0.42, 0.48, 0.72), uNight * 0.75);

  // anillo al pasar el puntero
  if (uHover.w > 0.001){
    float d = length(p - uHover.xy);
    float ring = exp(-pow((d - uHover.z) / (2.2 * uDpr), 2.0));
    col += vec3(0.55, 0.95, 0.62) * (ring * 0.7 + exp(-d / max(1.0, uHover.z)) * 0.08) * uHover.w;
  }
  // onda del cambio de etapa
  if (pulse > 0.0 && pulse < 1.0){
    float d = length(p - uPulse.xy) / U;
    float r = pulse * 1.3;
    col += vec3(0.6, 1.0, 0.65) * exp(-pow((d - r) * 28.0, 2.0)) * (1.0 - pulse) * 0.45;
  }

  // revelado de una planta nueva
  col *= mix(0.0, 1.0, smoothstep(0.0, 1.0, uIntro * 1.4 - length(p / U - vec2(0.5 * uRes.x / U, 0.6)) * 0.6 + 0.3));

  // tono, viñeta, grano y aberración cromática leve
  col = aces(col * 1.08);
  vec2 v = vUv - 0.5;
  col *= 1.0 - dot(v, v) * 0.55;
  col += (h21(p + fract(uTime) * 100.0) - 0.5) * 0.022;
  o = vec4(pow(col, vec3(1.0 / 1.04)), 1.0);
}`;
