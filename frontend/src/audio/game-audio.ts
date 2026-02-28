import * as Tone from "tone";

type AudioCtor = typeof AudioContext;

interface BrowserWindowWithWebkit extends Window {
  webkitAudioContext?: AudioCtor;
}

const STORAGE_KEY = "gdy_audio_enabled";
const MIN_GAIN = 0.0001;

const midiToFrequency = (midi: number): number => {
  return 440 * 2 ** ((midi - 69) / 12);
};

class GameAudioEngine {
  private ctx: AudioContext | null = null;

  private compressor: DynamicsCompressorNode | null = null;

  private masterGain: GainNode | null = null;

  private noiseBuffer: AudioBuffer | null = null;

  private enabled = true;

  private bgmTimer: number | null = null;

  private bgmStep = 0;

  private readonly bgmStepMs = 300;

  private toneModule: any | null = null;

  private toneReady = false;

  private toneFxBus: any | null = null;

  private toneCardNoise: any | null = null;

  private toneCardBody: any | null = null;

  private toneCardSnap: any | null = null;

  private toneDrawSweep: any | null = null;

  private toneDrawPing: any | null = null;

  private getAudioCtor(): AudioCtor | null {
    if (typeof window === "undefined") {
      return null;
    }
    const browserWindow = window as BrowserWindowWithWebkit;
    return window.AudioContext ?? browserWindow.webkitAudioContext ?? null;
  }

  private getContext(): AudioContext | null {
    if (this.ctx) {
      return this.ctx;
    }
    const Audio = this.getAudioCtor();
    if (!Audio) {
      return null;
    }
    this.ctx = new Audio();
    return this.ctx;
  }

  private ensureGraph(ctx: AudioContext): void {
    if (this.compressor && this.masterGain) {
      return;
    }

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -19;
    compressor.knee.value = 20;
    compressor.ratio.value = 4.2;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.22;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.28;

    compressor.connect(masterGain);
    masterGain.connect(ctx.destination);

    this.compressor = compressor;
    this.masterGain = masterGain;
  }

  private getOutputNode(ctx: AudioContext): AudioNode {
    this.ensureGraph(ctx);
    return this.compressor as DynamicsCompressorNode;
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) {
      return this.noiseBuffer;
    }

    const length = Math.floor(ctx.sampleRate * 1.2);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private playTone(
    frequency: number,
    duration: number,
    options?: {
      type?: OscillatorType;
      volume?: number;
      delay?: number;
      slideTo?: number;
      attack?: number;
      release?: number;
      detune?: number;
      filterType?: BiquadFilterType;
      filterFrequency?: number;
    }
  ): void {
    if (!this.enabled) {
      return;
    }
    const ctx = this.getContext();
    if (!ctx || ctx.state !== "running") {
      return;
    }

    const start = ctx.currentTime + (options?.delay ?? 0);
    const end = start + duration;
    const release = options?.release ?? 0.08;
    const attack = options?.attack ?? 0.008;

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    const output = this.getOutputNode(ctx);

    oscA.type = options?.type ?? "triangle";
    oscB.type = options?.type ?? "triangle";
    filter.type = options?.filterType ?? "lowpass";
    filter.frequency.setValueAtTime(options?.filterFrequency ?? 12000, start);

    oscA.frequency.setValueAtTime(frequency, start);
    oscB.frequency.setValueAtTime(frequency * 1.0035, start);
    const detune = options?.detune ?? 4;
    oscA.detune.setValueAtTime(-detune, start);
    oscB.detune.setValueAtTime(detune, start);
    if (options?.slideTo && options.slideTo > 0) {
      oscA.frequency.exponentialRampToValueAtTime(options.slideTo, end);
      oscB.frequency.exponentialRampToValueAtTime(options.slideTo * 1.0015, end);
    }

    const volume = options?.volume ?? 0.03;
    const peak = Math.max(volume, 0.0015);
    const sustainAt = start + Math.min(duration * 0.5, 0.09);
    const sustain = Math.max(peak * 0.55, 0.0006);
    gain.gain.setValueAtTime(MIN_GAIN, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(sustain, sustainAt);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, end + release);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(output);

    oscA.start(start);
    oscB.start(start);
    oscA.stop(end + release + 0.05);
    oscB.stop(end + release + 0.05);
  }

  private playNoiseBurst(
    duration: number,
    options?: {
      volume?: number;
      delay?: number;
      filterType?: BiquadFilterType;
      freqStart?: number;
      freqEnd?: number;
      q?: number;
      release?: number;
    }
  ): void {
    if (!this.enabled) {
      return;
    }
    const ctx = this.getContext();
    if (!ctx || ctx.state !== "running") {
      return;
    }

    const start = ctx.currentTime + (options?.delay ?? 0);
    const end = start + duration;
    const release = options?.release ?? 0.08;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    source.buffer = this.getNoiseBuffer(ctx);
    filter.type = options?.filterType ?? "highpass";
    filter.frequency.setValueAtTime(Math.max(options?.freqStart ?? 2200, 40), start);
    if (options?.freqEnd && options.freqEnd > 40) {
      filter.frequency.exponentialRampToValueAtTime(options.freqEnd, end);
    }
    filter.Q.value = options?.q ?? 0.6;

    const peak = Math.max(options?.volume ?? 0.018, 0.0008);
    gain.gain.setValueAtTime(MIN_GAIN, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, end + release);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.getOutputNode(ctx));

    source.start(start, 0);
    source.stop(end + release + 0.05);
  }

  private playBgmPad(root: number): void {
    const chord = [root + 12, root + 15, root + 19, root + 22];
    chord.forEach((midi, index) => {
      this.playTone(midiToFrequency(midi), 0.95, {
        type: "triangle",
        volume: 0.013,
        detune: 3,
        filterType: "lowpass",
        filterFrequency: 4200,
        delay: index * 0.012,
        release: 0.14
      });
    });
  }

  private playBgmBass(root: number): void {
    this.playTone(midiToFrequency(root), 0.24, {
      type: "sine",
      volume: 0.026,
      detune: 2,
      filterType: "lowpass",
      filterFrequency: 980,
      release: 0.07
    });
  }

  private playBgmHat(step: number): void {
    const accent = step % 4 === 2;
    this.playNoiseBurst(0.055, {
      volume: accent ? 0.012 : 0.008,
      filterType: "highpass",
      freqStart: accent ? 4200 : 3600,
      freqEnd: accent ? 6500 : 5200,
      q: 0.4,
      release: 0.04
    });
  }

  private ensureToneReady(): boolean {
    if (this.toneReady) {
      return true;
    }
    try {
      const fxBus = new Tone.Gain(0.95);
      const compressor = new Tone.Compressor({
        threshold: -18,
        ratio: 3.6,
        attack: 0.004,
        release: 0.16
      });
      const limiter = new Tone.Limiter(-1);
      fxBus.chain(compressor, limiter, Tone.Destination);

      this.toneCardNoise = new Tone.NoiseSynth({
        noise: { type: "white" },
        envelope: {
          attack: 0.001,
          decay: 0.045,
          sustain: 0,
          release: 0.02
        }
      }).connect(fxBus);

      this.toneCardBody = new Tone.MembraneSynth({
        pitchDecay: 0.018,
        octaves: 2.8,
        oscillator: { type: "triangle" },
        envelope: {
          attack: 0.001,
          decay: 0.16,
          sustain: 0.03,
          release: 0.07
        }
      }).connect(fxBus);

      this.toneCardSnap = new Tone.Synth({
        oscillator: { type: "triangle" },
        envelope: {
          attack: 0.002,
          decay: 0.05,
          sustain: 0,
          release: 0.03
        }
      }).connect(fxBus);

      this.toneDrawSweep = new Tone.FMSynth({
        harmonicity: 3,
        modulationIndex: 7,
        oscillator: { type: "sine" },
        modulation: { type: "triangle" },
        envelope: {
          attack: 0.002,
          decay: 0.12,
          sustain: 0.08,
          release: 0.06
        },
        modulationEnvelope: {
          attack: 0.002,
          decay: 0.08,
          sustain: 0.04,
          release: 0.05
        }
      }).connect(fxBus);

      this.toneDrawPing = new Tone.Synth({
        oscillator: { type: "sine" },
        envelope: {
          attack: 0.001,
          decay: 0.12,
          sustain: 0,
          release: 0.07
        }
      }).connect(fxBus);

      this.toneModule = Tone;
      this.toneFxBus = fxBus;
      this.toneReady = true;
      return true;
    } catch {
      this.toneReady = false;
      return false;
    }
  }

  private playDrawWithTone(): boolean {
    if (!this.enabled || !this.toneReady || !this.toneModule) {
      return false;
    }
    try {
      const now = this.toneModule.now();
      this.toneCardNoise?.triggerAttackRelease("64n", now, 0.32);
      this.toneDrawSweep?.triggerAttackRelease("G5", "32n", now + 0.01, 0.45);
      this.toneDrawSweep?.triggerAttackRelease("C6", "32n", now + 0.07, 0.4);
      this.toneDrawPing?.triggerAttackRelease("E6", "16n", now + 0.12, 0.26);
      return true;
    } catch {
      return false;
    }
  }

  private playCardWithTone(cardsCount: number): boolean {
    if (!this.enabled || !this.toneReady || !this.toneModule) {
      return false;
    }

    try {
      const now = this.toneModule.now();
      const normalizedCount = Math.min(Math.max(cardsCount, 1), 6);
      const velocity = Math.min(0.5 + normalizedCount * 0.08, 0.95);
      const bodyMidi = 46 + normalizedCount;
      const snapMidi = 76 + normalizedCount;
      const bodyNote = this.toneModule.Frequency(bodyMidi, "midi").toNote();
      const snapNote = this.toneModule.Frequency(snapMidi, "midi").toNote();

      this.toneCardNoise?.triggerAttackRelease("128n", now, 0.2 + normalizedCount * 0.05);
      this.toneCardBody?.triggerAttackRelease(bodyNote, "16n", now + 0.006, velocity);
      this.toneCardSnap?.triggerAttackRelease(snapNote, "32n", now + 0.02, 0.17 + normalizedCount * 0.05);

      if (normalizedCount >= 3) {
        const accentNote = this.toneModule.Frequency(bodyMidi - 7, "midi").toNote();
        this.toneCardBody?.triggerAttackRelease(accentNote, "32n", now + 0.032, 0.28 + normalizedCount * 0.04);
      }
      return true;
    } catch {
      return false;
    }
  }

  private tickBgm(): void {
    if (!this.enabled) {
      return;
    }

    const ctx = this.getContext();
    if (!ctx || ctx.state !== "running") {
      return;
    }

    const progression = [48, 45, 43, 41];
    const melodyPattern = [12, 14, 16, 19, 21, 19, 16, 14, 12, 14, 16, 19, 23, 21, 19, 16];
    const step = this.bgmStep % melodyPattern.length;
    const root = progression[Math.floor(step / 4) % progression.length] ?? 48;

    if (step % 4 === 0) {
      this.playBgmPad(root);
    }
    if (step % 2 === 0) {
      this.playBgmBass(root);
    }

    const melodyMidi = root + melodyPattern[step];
    this.playTone(midiToFrequency(melodyMidi), 0.26, {
      type: "triangle",
      volume: 0.017,
      detune: 6,
      filterType: "lowpass",
      filterFrequency: 5200,
      release: 0.1
    });

    this.playBgmHat(step);

    this.bgmStep += 1;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.stopBackgroundMusic();
    }
  }

  async unlock(): Promise<boolean> {
    const toneNodesReady = this.ensureToneReady();
    if (toneNodesReady) {
      try {
        await Tone.start();
      } catch {
        // Keep fallback WebAudio path active.
      }
    }

    const ctx = this.getContext();
    if (!ctx) {
      return false;
    }
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
    }
    if (ctx.state !== "running") {
      return false;
    }

    // Prime a silent frame to make iOS Safari reliably transition into interactive audio mode.
    this.playTone(220, 0.02, { volume: 0.0002 });
    return true;
  }

  startBackgroundMusic(): void {
    if (!this.enabled || this.bgmTimer !== null) {
      return;
    }
    this.bgmStep = 0;
    this.tickBgm();
    this.bgmTimer = window.setInterval(() => {
      this.tickBgm();
    }, this.bgmStepMs);
  }

  stopBackgroundMusic(): void {
    if (this.bgmTimer !== null) {
      window.clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }

  playDraw(): void {
    if (this.toneReady && this.playDrawWithTone()) {
      return;
    }
    this.ensureToneReady();

    this.playNoiseBurst(0.06, {
      volume: 0.026,
      filterType: "highpass",
      freqStart: 1800,
      freqEnd: 6200,
      q: 0.35,
      release: 0.05
    });
    this.playNoiseBurst(0.03, {
      volume: 0.012,
      delay: 0.045,
      filterType: "bandpass",
      freqStart: 1200,
      freqEnd: 2600,
      q: 1.1,
      release: 0.03
    });
    this.playTone(midiToFrequency(74), 0.08, {
      type: "square",
      volume: 0.042,
      slideTo: midiToFrequency(69),
      filterType: "lowpass",
      filterFrequency: 3200,
      release: 0.05,
      detune: 3
    });
    this.playTone(midiToFrequency(84), 0.13, {
      type: "sine",
      volume: 0.026,
      delay: 0.03,
      slideTo: midiToFrequency(91),
      filterType: "lowpass",
      filterFrequency: 5600,
      release: 0.09
    });
  }

  playCard(cardsCount: number): void {
    if (this.toneReady && this.playCardWithTone(cardsCount)) {
      return;
    }
    this.ensureToneReady();

    const normalizedCount = Math.min(Math.max(cardsCount, 1), 6);
    const intensity = 1 + (normalizedCount - 1) * 0.13;
    const bodyMidi = 43 + normalizedCount;
    const snapMidi = 74 + normalizedCount;

    this.playNoiseBurst(0.02, {
      volume: 0.013 * intensity,
      filterType: "highpass",
      freqStart: 2500,
      freqEnd: 4200,
      q: 0.5,
      release: 0.024
    });

    this.playTone(midiToFrequency(bodyMidi), 0.08, {
      type: "square",
      volume: 0.051 * intensity,
      slideTo: midiToFrequency(bodyMidi - 4),
      filterType: "lowpass",
      filterFrequency: 2100,
      release: 0.045,
      detune: 2
    });

    this.playTone(midiToFrequency(snapMidi), 0.045, {
      type: "sine",
      volume: 0.018 * intensity,
      delay: 0.012,
      slideTo: midiToFrequency(snapMidi + 5),
      filterType: "lowpass",
      filterFrequency: 6400,
      release: 0.03,
      detune: 7
    });

    if (normalizedCount >= 3) {
      this.playTone(midiToFrequency(bodyMidi - 7), 0.07, {
        type: "triangle",
        volume: 0.028 * intensity,
        delay: 0.02,
        slideTo: midiToFrequency(bodyMidi - 11),
        filterType: "lowpass",
        filterFrequency: 1200,
        release: 0.05,
        detune: 2
      });
    }
  }

  playBomb(): void {
    this.playNoiseBurst(0.06, {
      volume: 0.06,
      filterType: "bandpass",
      freqStart: 2300,
      freqEnd: 1800,
      q: 1.1,
      release: 0.06
    });
    this.playNoiseBurst(0.42, {
      volume: 0.085,
      delay: 0.02,
      filterType: "lowpass",
      freqStart: 2200,
      freqEnd: 110,
      q: 0.7,
      release: 0.2
    });
    this.playTone(95, 0.52, {
      type: "sawtooth",
      volume: 0.12,
      slideTo: 38,
      filterType: "lowpass",
      filterFrequency: 900,
      release: 0.16,
      detune: 5
    });
    this.playTone(420, 0.3, {
      type: "triangle",
      volume: 0.036,
      delay: 0.03,
      slideTo: 140,
      filterType: "lowpass",
      filterFrequency: 3200,
      release: 0.12,
      detune: 9
    });
  }
}

const readStorageEnabled = (): boolean => {
  if (typeof window === "undefined") {
    return true;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return true;
  }
  return raw !== "0";
};

const audioEngine = new GameAudioEngine();
audioEngine.setEnabled(readStorageEnabled());

export const getAudioEnabledPreference = (): boolean => {
  return readStorageEnabled();
};

export const setAudioEnabledPreference = (enabled: boolean): void => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  }
  audioEngine.setEnabled(enabled);
};

export const unlockGameAudio = async (): Promise<boolean> => {
  return audioEngine.unlock();
};

export const startGameBackgroundMusic = (): void => {
  audioEngine.startBackgroundMusic();
};

export const stopGameBackgroundMusic = (): void => {
  audioEngine.stopBackgroundMusic();
};

export const playDrawSfx = (): void => {
  audioEngine.playDraw();
};

export const playCardSfx = (cardsCount: number): void => {
  audioEngine.playCard(cardsCount);
};

export const playBombSfx = (): void => {
  audioEngine.playBomb();
};
