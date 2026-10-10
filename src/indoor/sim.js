// Climate and light model for a small grow tent. Deliberately simple, but each
// term has a physical basis so the numbers react plausibly to the controls.

export const TENT = { w: 0.8, d: 0.8, h: 1.6 };

const svp = (t) => 0.6108 * Math.exp((17.27 * t) / (t + 237.3)); // kPa
const absHum = (t, rh) => (6.112 * Math.exp((17.67 * t) / (t + 243.5)) * rh * 2.1674) / (273.15 + t); // g/m³

export const STAGES = {
  plantula: { name: 'Plántula', T: [22, 26], RH: [65, 75], VPD: [0.4, 0.8], PPFD: [150, 300] },
  vege: { name: 'Vegetativo', T: [22, 28], RH: [55, 70], VPD: [0.8, 1.2], PPFD: [300, 600] },
  flora: { name: 'Floración', T: [20, 26], RH: [40, 55], VPD: [1.0, 1.5], PPFD: [600, 900] },
  final: { name: 'Maduración', T: [18, 24], RH: [35, 45], VPD: [1.2, 1.6], PPFD: [500, 800] },
};

export function stageFor(day, flip) {
  if (day < 14) return STAGES.plantula;
  if (day < flip) return STAGES.vege;
  if (day < flip + 49) return STAGES.flora;
  return STAGES.final;
}

export function photoperiodFor(mode, day, flip) {
  if (mode === 'auto') return day < flip ? 18 : 12;
  return Number(mode);
}

/**
 * PPFD grid on the canopy plane. The LED bar is a row of Lambertian emitters
 * (E = Φ·h²/(π·d⁴) per emitter); the mylar walls are modelled with first-order
 * mirror images at 90 % reflectivity.
 */
export function ppfdGrid({ ppf, lightY, canopyY, barLen = 0.6, res = 48 }) {
  const h = Math.max(0.05, lightY - canopyY);
  const W = TENT.w, D = TENT.d;
  const emitters = 12;
  const src = [];
  for (let i = 0; i < emitters; i++) {
    const x = -barLen / 2 + (barLen * (i + 0.5)) / emitters;
    for (let ix = -1; ix <= 1; ix++) for (let iz = -1; iz <= 1; iz++) {
      // mirror x across walls at ±W/2: x' = ±W - x
      const sx = ix === 0 ? x : ix * W - x;
      const sz = iz === 0 ? 0 : iz * D - 0;
      const refl = Math.pow(0.9, Math.abs(ix) + Math.abs(iz));
      src.push([sx, sz, (refl * ppf) / emitters / Math.PI]);
    }
  }
  const grid = new Float32Array(res * res);
  let sum = 0, max = 0, min = Infinity;
  const h2 = h * h;
  for (let j = 0; j < res; j++) {
    const z = -D / 2 + (D * (j + 0.5)) / res;
    for (let i = 0; i < res; i++) {
      const x = -W / 2 + (W * (i + 0.5)) / res;
      let e = 0;
      for (const [sx, sz, k] of src) {
        const dx = x - sx, dz = z - sz;
        const d2 = dx * dx + dz * dz + h2;
        e += (k * h2) / (d2 * d2);
      }
      grid[j * res + i] = e;
      sum += e;
      if (e > max) max = e;
      if (e < min) min = e;
    }
  }
  return { grid, res, avg: sum / (res * res), max, min };
}

export class Climate {
  constructor() {
    this.T = 22;
    this.RH = 60;
    this.soil = 72;
  }

  /**
   * @param {number} dtMin simulated minutes elapsed
   * @param {object} s inputs: roomT, roomRH, lightOn, watts, dim, extractor (0..1),
   *   humidifier, leafScale, pcFans, clipFan
   */
  step(dtMin, s) {
    const heatW = s.lightOn ? s.watts * s.dim : 4; // drivers idle + humidifier
    const flow = 0.004 + s.extractor * 0.04 + (s.pcFans ? 0.004 : 0); // m³/s
    const conductance = 6; // W/K through the fabric
    const targetT = s.roomT + heatW / (flow * 1206 + conductance);

    const transp = 0.05 * Math.pow(s.leafScale, 1.4) * (s.lightOn ? 1 : 0.3); // g/s, 4 plants
    const hum = s.humidifier ? 0.07 : 0; // g/s (~250 ml/h)
    const evap = 0.004 * (this.soil / 100);
    const ahRoom = absHum(s.roomT, s.roomRH);
    const ahIn = ahRoom + (transp + hum + evap) / (flow + 0.0015);
    const ahSat = absHum(this.T, 100);
    const targetRH = Math.min(99, (ahIn / ahSat) * 100);

    const k = 1 - Math.exp(-dtMin / 8);
    this.T += (targetT - this.T) * k;
    this.RH += (targetRH - this.RH) * (1 - Math.exp(-dtMin / 10));

    const use = (0.15 + 1.6 * Math.pow(s.leafScale, 1.3)) * (s.lightOn ? 1 : 0.35) * (1 + Math.max(0, this.T - 24) * 0.05);
    this.soil = Math.max(0, this.soil - (use / 60) * dtMin);
  }

  get vpd() {
    const leafT = this.T - 1.5;
    return Math.max(0, svp(leafT) - svp(this.T) * (this.RH / 100));
  }
}
