/**
 * Tiny audio + haptic feedback helper for the stock-take scanner.  Uses
 * WebAudio so we don't have to ship an mp3 with the bundle, and quietly
 * no-ops if the browser blocks it.
 *
 * Three sounds:
 *   • ok      → 880 Hz blip                  (known scan, counted)
 *   • reject  → 220 Hz buzz                  (unknown / dismissed barcode)
 *   • duplicate → soft 660 Hz                (camera double-tick suppressed)
 */

type FeedbackKind = 'ok' | 'reject' | 'duplicate';

let ctx: AudioContext | null = null;
let enabled = true;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

export function setScanFeedbackEnabled(value: boolean): void {
  enabled = value;
}

export function isScanFeedbackEnabled(): boolean {
  return enabled;
}

export function playScanFeedback(kind: FeedbackKind): void {
  if (!enabled) return;
  if (typeof navigator !== 'undefined') {
    try {
      const pattern = kind === 'ok' ? 35 : kind === 'reject' ? [60, 40, 60] : 20;
      navigator.vibrate?.(pattern);
    } catch { /* unsupported */ }
  }
  const audio = getCtx();
  if (!audio) return;
  try {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.connect(gain);
    gain.connect(audio.destination);
    const now = audio.currentTime;
    if (kind === 'ok') {
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      osc.start(now);
      osc.stop(now + 0.15);
    } else if (kind === 'duplicate') {
      osc.frequency.setValueAtTime(660, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.1, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.1);
    } else {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.32);
    }
  } catch {
    /* user-gesture not yet given — first scan will silently miss audio,
       browsers re-allow it once any input event happens. */
  }
}
