const SOUND_KEY = "emberwood.sound.v1";

function noiseBuffer(ctx, seconds) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambientGain = null;
    this.enabled = true;
    this.noise = null;
    this.birdTimer = null;
    try {
      this.enabled = localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
      this.enabled = true;
    }
  }

  get ready() {
    return !!this.ctx;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.noise = noiseBuffer(ctx, 2.5);
    return ctx;
  }

  async unlock() {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      // Never block game entry on the resume promise: some browsers keep it
      // pending until a user gesture, which would stall auto-entry.
      const resumed = ctx.resume();
      if (resumed && typeof resumed.catch === "function") resumed.catch(() => {});
      try {
        await Promise.race([
          resumed || Promise.resolve(),
          new Promise((resolve) => setTimeout(resolve, 250)),
        ]);
      } catch {
        /* browser refused audio */
      }
    }
    if (this.enabled) this.startAmbient();
    this.updateMaster(0.55);
  }

  updateMaster(target, duration = 0.8) {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(this.enabled ? target : 0, now, duration / 3);
  }

  startAmbient() {
    if (!this.ctx || !this.enabled || this.ambientGain) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 380;
    filter.Q.value = 0.6;
    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.055;
    lfoGain.gain.value = 150;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
    this.ambientGain = gain;
    this.scheduleBird();
  }

  scheduleBird() {
    if (!this.ctx || !this.enabled) return;
    clearTimeout(this.birdTimer);
    const delay = 4200 + Math.random() * 8500;
    this.birdTimer = setTimeout(() => {
      if (this.ctx && this.enabled && this.ctx.state === "running") this.bird();
      this.scheduleBird();
    }, delay);
  }

  bird() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const base = 1850 + Math.random() * 900;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const t = now + i * (0.085 + Math.random() * 0.035);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(base + Math.random() * 380, t);
      osc.frequency.exponentialRampToValueAtTime(base * (1.16 + Math.random() * 0.15), t + 0.075);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.018, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.14);
    }
  }

  footstep(running = false) {
    if (!this.ctx || !this.enabled || this.ctx.state !== "running") return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = running ? 340 : 430;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    const vol = running ? 0.025 : 0.018;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
    src.stop(now + 0.1);
  }

  chime(index = 0) {
    if (!this.ctx || !this.enabled || this.ctx.state !== "running") return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const scale = [523.25, 587.33, 659.25, 783.99, 880.0];
    const root = scale[index % scale.length];
    [1, 1.5, 2].forEach((ratio, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = root * ratio;
      const t = now + i * 0.045;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.05 / (i + 1), t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.75 - i * 0.1);
      osc.connect(gain).connect(this.master);
      osc.start(t);
      osc.stop(t + 0.8);
    });
    // A tiny high sparkle.
    const spark = ctx.createOscillator();
    const sg = ctx.createGain();
    spark.type = "triangle";
    spark.frequency.setValueAtTime(root * 3, now + 0.1);
    spark.frequency.exponentialRampToValueAtTime(root * 4.5, now + 0.6);
    sg.gain.setValueAtTime(0.015, now + 0.1);
    sg.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    spark.connect(sg).connect(this.master);
    spark.start(now + 0.1);
    spark.stop(now + 0.75);
  }

  beacon() {
    if (!this.ctx || !this.enabled || this.ctx.state !== "running") return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const notes = [110, 164.81, 220, 293.66];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i < 2 ? "sine" : "triangle";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.035 / (i + 1), now + 0.5 + i * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.2);
      osc.connect(gain).connect(this.master);
      osc.start(now);
      osc.stop(now + 4.4);
    });
    this.chime(4);
    setTimeout(() => this.chime(1), 240);
  }

  crackle() {
    if (!this.ctx || !this.enabled || this.ctx.state !== "running") return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.006 + Math.random() * 0.007, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035 + Math.random() * 0.03);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now, Math.random() * 1.5, 0.08);
  }

  ui() {
    if (!this.ctx || !this.enabled || this.ctx.state !== "running") return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(760, now);
    osc.frequency.exponentialRampToValueAtTime(540, now + 0.06);
    gain.gain.setValueAtTime(0.018, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    try {
      localStorage.setItem(SOUND_KEY, enabled ? "on" : "off");
    } catch {
      /* ignore */
    }
    if (enabled) {
      this.unlock();
    } else {
      this.updateMaster(0, 0.35);
    }
    return this.enabled;
  }

  toggle() {
    return this.setEnabled(!this.enabled);
  }
}
