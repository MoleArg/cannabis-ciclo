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

vec3 indoorBg(vec2 p, out float lit){
  float U = uRes.y;
  vec2 q = p / U;
  vec2 lc = vec2((uLamp.x + uLamp.y) * 0.5, uLamp.z);
  // mylar: pliegues verticales y arrugas que agarran la luz
  float warp = fbm(q * vec2(1.6, 3.0)) * 1.6;
  float folds = sin(q.x * 52.0 + warp) * 0.5 + 0.5;
  float crinkle = fbm(q * vec2(30.0, 14.0) + 3.1);
  float d = length((p - lc) / U * vec2(0.85, 1.0));
  lit = uLight * (0.2 + 0.8 * uPPFD) * exp(-d * 2.1);
  vec3 base = vec3(0.07, 0.078, 0.086) + vec3(0.008) * folds;
  vec3 c = base + uLampCol * lit * (0.1 + 0.2 * pow(folds, 4.0) + 0.16 * pow(crinkle, 3.0));
  c *= 1.0 - 0.35 * smoothstep(0.25, 0.75, abs(p.x / uRes.x - 0.5));
  // piso con reflejo de la luz
  if (p.y > uFloorY){
    float k = (p.y - uFloorY) / U;
    c = vec3(0.05, 0.055, 0.06) * (1.0 - k * 0.6) + uLampCol * lit * 0.12 * exp(-k * 6.0);
    c += vec3(0.02) * n2(p * 0.05);
  }
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
