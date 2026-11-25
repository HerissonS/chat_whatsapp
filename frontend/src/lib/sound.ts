/**
 * Sons de notificação.
 * Os sons embutidos são sintetizados no navegador (Web Audio), sem arquivos de áudio:
 * nada de terceiros é distribuído. O usuário pode usar um arquivo próprio, que fica salvo
 * só no navegador dele (localStorage) e é tocado pelo Web Audio, sem URL externa.
 */

export type SoundId = 'classic' | 'pop' | 'double' | 'chime' | 'marimba' | 'drop' | 'soft' | 'custom' | 'none';

export interface SoundSettings {
  sound: SoundId;
  /** 0 a 100. */
  volume: number;
}

export const DEFAULT_SOUND: SoundSettings = { sound: 'classic', volume: 70 };

/** Nota curta com envelope (ataque rápido e decaimento exponencial). */
function tone(ctx: AudioContext, out: AudioNode, at: number, freq: number, dur: number, type: OscillatorType = 'sine', peak = 1, endFreq?: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, at + dur * 0.8);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.02);
}

type Synth = (ctx: AudioContext, out: AudioNode, t: number) => void;

export const SOUNDS: Array<{ id: Exclude<SoundId, 'custom' | 'none'>; label: string; play: Synth }> = [
  { id: 'classic', label: 'Padrão (bipe)', play: (c, o, t) => tone(c, o, t, 880, 0.25) },
  { id: 'pop', label: 'Pop', play: (c, o, t) => tone(c, o, t, 520, 0.14, 'sine', 1, 1150) },
  {
    id: 'double',
    label: 'Toque duplo',
    play: (c, o, t) => {
      tone(c, o, t, 988, 0.12);
      tone(c, o, t + 0.15, 1319, 0.16);
    },
  },
  {
    id: 'chime',
    label: 'Sino',
    play: (c, o, t) => {
      tone(c, o, t, 1047, 0.9, 'sine', 0.8);
      tone(c, o, t, 2094, 0.6, 'sine', 0.25);
      tone(c, o, t, 3141, 0.35, 'sine', 0.1);
    },
  },
  {
    id: 'marimba',
    label: 'Marimba',
    play: (c, o, t) => {
      [784, 988, 1175].forEach((f, i) => tone(c, o, t + i * 0.09, f, 0.22, 'triangle', 0.9));
    },
  },
  { id: 'drop', label: 'Gota', play: (c, o, t) => tone(c, o, t, 1500, 0.22, 'sine', 1, 480) },
  {
    id: 'soft',
    label: 'Suave',
    play: (c, o, t) => {
      tone(c, o, t, 523, 0.5, 'sine', 0.7);
      tone(c, o, t + 0.12, 659, 0.55, 'sine', 0.6);
    },
  },
];

const CUSTOM_KEY = 'atl-custom-sound';
export const CUSTOM_MAX_BYTES = 300 * 1024;

let ctx: AudioContext | null = null;
let current: SoundSettings = { ...DEFAULT_SOUND };
let customBuffer: { data: string; buffer: AudioBuffer } | null = null;

function audio(): AudioContext {
  if (!ctx || ctx.state === 'closed') ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setSoundSettings(s: Partial<SoundSettings> | undefined) {
  current = { ...DEFAULT_SOUND, ...(s ?? {}) };
}

/** Arquivo próprio salvo neste navegador: { name, data(base64) }. */
export function getCustomSound(): { name: string; data: string } | null {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as { name: string; data: string }) : null;
  } catch {
    return null;
  }
}

/** Valida (decodificando o áudio) e salva o arquivo próprio. Lança erro com mensagem amigável. */
export async function saveCustomSound(file: File): Promise<void> {
  if (file.size > CUSTOM_MAX_BYTES) throw new Error('O arquivo deve ter no máximo 300 KB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let decoded: AudioBuffer;
  try {
    decoded = await audio().decodeAudioData(bytes.slice().buffer);
  } catch {
    throw new Error('Não foi possível ler esse arquivo de áudio. Use MP3, OGG, WAV ou M4A.');
  }
  if (decoded.duration > 6) throw new Error('O som deve ter no máximo 6 segundos.');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const data = btoa(bin);
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify({ name: file.name.slice(0, 120), data }));
  } catch {
    throw new Error('O navegador não permitiu salvar o arquivo.');
  }
  customBuffer = { data, buffer: decoded };
}

export function removeCustomSound() {
  try {
    localStorage.removeItem(CUSTOM_KEY);
  } catch {
    /* sem armazenamento */
  }
  customBuffer = null;
}

async function customAudio(c: AudioContext): Promise<AudioBuffer | null> {
  const saved = getCustomSound();
  if (!saved) return null;
  if (customBuffer?.data === saved.data) return customBuffer.buffer;
  const bin = atob(saved.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const buffer = await c.decodeAudioData(bytes.buffer);
  customBuffer = { data: saved.data, buffer };
  return buffer;
}

/** Toca um som (as configurações atuais, ou as informadas para pré-visualizar). */
export async function playSound(settings: SoundSettings = current): Promise<void> {
  if (settings.sound === 'none' || settings.volume <= 0) return;
  try {
    const c = audio();
    const out = c.createGain();
    // Curva perceptual: volume 70 ≈ 0,15, próximo do som original.
    out.gain.value = Math.pow(settings.volume / 100, 2) * 0.3;
    out.connect(c.destination);
    if (settings.sound === 'custom') {
      const buffer = await customAudio(c);
      if (!buffer) return SOUNDS[0].play(c, out, c.currentTime + 0.01);
      out.gain.value = Math.pow(settings.volume / 100, 2);
      const src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(out);
      src.start();
      return;
    }
    (SOUNDS.find((s) => s.id === settings.sound) ?? SOUNDS[0]).play(c, out, c.currentTime + 0.01);
  } catch {
    /* áudio bloqueado até a primeira interação com a página */
  }
}
