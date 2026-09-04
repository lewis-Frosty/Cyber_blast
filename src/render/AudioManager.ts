import { renderSettings } from './settings';

/**
 * Procedural WebAudio synth — zero audio files. The rising-pitch cascade
 * arpeggio is the primary feel element (§4.4): gen 0 = root, gen 1 = third,
 * gen 2 = fifth, gen 3 = octave, gen 4+ keeps climbing.
 */
const ARPEGGIO_HZ = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093.0];

type Ctx = AudioContext;

export class AudioManager {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;

  /** Must be called from a user gesture (pointerdown) to satisfy autoplay policy. */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private ready(): { ctx: Ctx; master: GainNode } | null {
    if (!renderSettings.soundOn || !this.ctx || !this.master || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, master: this.master };
  }

  private tone(opts: {
    type: OscillatorType;
    from: number;
    to?: number;
    duration: number;
    gain?: number;
    attack?: number;
    filterHz?: number;
    delay?: number;
  }): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, master } = r;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.from, t0);
    if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + opts.duration);

    const env = ctx.createGain();
    const peak = opts.gain ?? 0.5;
    const attack = opts.attack ?? 0.005;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.duration);

    let node: AudioNode = osc;
    if (opts.filterHz) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = opts.filterHz;
      filter.Q.value = 1.2;
      osc.connect(filter);
      node = filter;
    }
    node.connect(env);
    env.connect(master);
    osc.start(t0);
    osc.stop(t0 + opts.duration + 0.05);
  }

  /** Cascade generation note. Brightness and length grow with depth. */
  cascadeNote(generation: number): void {
    const idx = Math.min(generation, ARPEGGIO_HZ.length - 1);
    const hz = ARPEGGIO_HZ[idx] ?? ARPEGGIO_HZ[0]!;
    const brightness = 1800 + generation * 900;
    this.tone({ type: 'square', from: hz, duration: 0.28 + generation * 0.04, gain: 0.22, filterHz: brightness });
    this.tone({ type: 'sawtooth', from: hz / 2, duration: 0.22 + generation * 0.04, gain: 0.1, filterHz: brightness * 0.7 });
    if (generation >= 2) {
      // Shimmer layer for deeper chains.
      this.tone({ type: 'sine', from: hz * 2, duration: 0.35, gain: 0.08, attack: 0.02 });
    }
  }

  placeClick(): void {
    this.tone({ type: 'sine', from: 880, to: 440, duration: 0.06, gain: 0.25 });
    this.tone({ type: 'triangle', from: 220, duration: 0.04, gain: 0.15 });
  }

  invalidThunk(): void {
    this.tone({ type: 'triangle', from: 140, to: 70, duration: 0.14, gain: 0.35, filterHz: 600 });
  }

  pickUp(): void {
    this.tone({ type: 'sine', from: 660, to: 880, duration: 0.05, gain: 0.12 });
  }

  gameOver(): void {
    this.tone({ type: 'sawtooth', from: 440, to: 110, duration: 0.9, gain: 0.3, attack: 0.02, filterHz: 1400 });
    this.tone({ type: 'square', from: 330, to: 82, duration: 1.0, gain: 0.12, attack: 0.02, filterHz: 900, delay: 0.08 });
  }
}

/** Shared instance — survives scene restarts so the AudioContext is created once. */
export const audio = new AudioManager();
