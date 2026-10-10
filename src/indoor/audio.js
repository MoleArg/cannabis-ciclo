// Synthesised soundscape: no audio files, everything is generated with WebAudio.

export class Soundscape {
  constructor() {
    this.ctx = null;
    this.on = false;
  }

  _noise(seconds = 3, brown = true) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  _layer(brown, type, freq, q = 0.8) {
    const src = this._noise(4, brown);
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { f, g };
  }

  enable() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      this.fan = this._layer(true, 'lowpass', 500);
      this.clip = this._layer(false, 'bandpass', 900, 0.6);
      this.mist = this._layer(false, 'bandpass', 4200, 1.2);
      this.hum = this.ctx.createOscillator();
      this.hum.frequency.value = 100; // 50 Hz mains → 100 Hz driver hum
      this.humGain = this.ctx.createGain();
      this.humGain.gain.value = 0;
      this.hum.connect(this.humGain).connect(this.master);
      this.hum.start();
    }
    this.ctx.resume();
    this.on = true;
    this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.4);
  }

  disable() {
    if (!this.ctx) return;
    this.on = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  update(s, light, oscPhase) {
    if (!this.on) return;
    const t = this.ctx.currentTime;
    this.fan.g.gain.setTargetAtTime(0.03 + s.extractor * 0.16, t, 0.3);
    this.fan.f.frequency.setTargetAtTime(260 + s.extractor * 700, t, 0.3);
    // the clip fan gets louder as it sweeps towards the camera
    const clip = s.clipFan ? 0.02 + 0.012 * Math.max(0, Math.sin(oscPhase)) : 0;
    this.clip.g.gain.setTargetAtTime(clip + (s.pcFans ? 0.008 : 0), t, 0.2);
    this.mist.g.gain.setTargetAtTime(s.humidifier ? 0.006 : 0, t, 0.3);
    this.humGain.gain.setTargetAtTime(light * 0.006, t, 0.2);
  }

  /** Relay click of the timer. */
  click() {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this._noise(0.08, false);
    src.loop = false;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
  }

  drip(delay = 0) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f0 = 900 + Math.random() * 900;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.35, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.1);
  }

  chime() {
    if (!this.on) return;
    const ctx = this.ctx;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const t = ctx.currentTime + i * 0.11;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 1);
    });
  }
}
