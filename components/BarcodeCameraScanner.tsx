import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Camera, Loader2, RefreshCw, X } from 'lucide-react';
import { isPlausibleScanCode, normalizeBarcodeInput } from '../services/productResolver';
import {
  applyBarcodeCameraEnhancements,
  buildBarcodeCameraConstraints,
  buildBarcodeCameraConstraintsFallback,
  formatCameraError,
  isCameraEnvironmentOk,
  requestCameraPermission,
  type CameraAccessResult,
} from '../utils/cameraAccess';
import { releaseAllCameraStreams } from '../utils/cameraRelease';

const SCAN_COOLDOWN_MS = 900;
const SCAN_COOLDOWN_HANDLED_MS = 2800;
const STOP_SETTLE_MS = 400;

type Phase = 'idle' | 'starting' | 'live' | 'error';

type Html5QrcodeInstance = {
  start: (
    camera: string | MediaTrackConstraints,
    config: object,
    onSuccess: (text: string) => void,
    onError: () => void,
  ) => Promise<null>;
  stop: () => Promise<void>;
  clear: () => Promise<void>;
  pause: (shouldPauseVideo?: boolean) => void;
  resume: () => void;
  getState: () => number;
};

interface Props {
  active: boolean;
  paused?: boolean;
  onScan: (code: string) => boolean | void;
  onError?: (message: string) => void;
  onClose?: () => void;
}

const STATE_NOT_STARTED = 1;
const STATE_SCANNING = 2;
const STATE_PAUSED = 3;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function isTransitionError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /already under transition|transition to a new state/i.test(msg);
}

async function safeScannerStop(scanner: Html5QrcodeInstance | null): Promise<void> {
  if (!scanner) return;
  try {
    const state = scanner.getState?.();
    if (state === STATE_NOT_STARTED) {
      try {
        await scanner.clear();
      } catch { /* */ }
      return;
    }
    await scanner.stop();
    await scanner.clear();
  } catch (e) {
    if (!isTransitionError(e)) return;
    await delay(STOP_SETTLE_MS);
    try {
      await scanner.stop();
      await scanner.clear();
    } catch { /* */ }
  }
}

async function startScannerWithFallback(
  scanner: Html5QrcodeInstance,
  elementId: string,
  Html5QrcodeSupportedFormats: typeof import('html5-qrcode').Html5QrcodeSupportedFormats,
  onDecoded: (text: string) => void,
): Promise<void> {
  await safeScannerStop(scanner);

  const scanConfig = {
    fps: 15,
    disableFlip: false,
    useBarCodeDetectorIfSupported: true,
    qrbox: (viewfinderWidth: number, viewfinderHeight: number) => ({
      width: Math.floor(viewfinderWidth * 0.98),
      height: Math.floor(viewfinderHeight * 0.88),
    }),
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
    ],
  };

  const { Html5Qrcode } = await import('html5-qrcode');
  const cameraAttempts: MediaTrackConstraints[] = [];

  try {
    const cameras = await Html5Qrcode.getCameras();
    const back = cameras.find(c => /back|rear|environment|wide|ultra/i.test(c.label));
    const pick = back || cameras[cameras.length - 1];
    if (pick?.id) {
      cameraAttempts.push(buildBarcodeCameraConstraints(pick.id));
      cameraAttempts.push(buildBarcodeCameraConstraintsFallback(pick.id));
    }
  } catch { /* */ }

  cameraAttempts.push(buildBarcodeCameraConstraints());
  cameraAttempts.push(buildBarcodeCameraConstraintsFallback());

  let lastErr: unknown;
  for (const cameraIdOrConfig of cameraAttempts) {
    try {
      await scanner.start(
        cameraIdOrConfig,
        scanConfig,
        onDecoded,
        () => { /* no code in frame */ },
      );
      return;
    } catch (e) {
      lastErr = e;
      if (!isTransitionError(e)) {
        await safeScannerStop(scanner);
      } else {
        await delay(STOP_SETTLE_MS);
        await safeScannerStop(scanner);
      }
    }
  }
  throw lastErr ?? new Error('Could not start camera');
}

const BarcodeCameraScanner: React.FC<Props> = ({ active, paused = false, onScan, onError, onClose }) => {
  const regionId = useId().replace(/:/g, '');
  const regionRef = useRef<HTMLDivElement>(null);
  const elementId = `stash-barcode-camera-${regionId}`;
  const [phase, setPhase] = useState<Phase>('idle');
  const [accessError, setAccessError] = useState<CameraAccessResult | null>(null);
  const [showShell, setShowShell] = useState(active);

  const runningRef = useRef(false);
  const scanLockedRef = useRef(false);
  const lastDecodeRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const opChainRef = useRef<Promise<void>>(Promise.resolve());
  const startingRef = useRef(false);
  const lifecycleRef = useRef(0);

  const pausedRef = useRef(paused);
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  const onCloseRef = useRef(onClose);
  pausedRef.current = paused;
  onScanRef.current = onScan;
  onErrorRef.current = onError;
  onCloseRef.current = onClose;

  const enqueue = useCallback((op: () => Promise<void>) => {
    opChainRef.current = opChainRef.current.then(op).catch(() => {});
    return opChainRef.current;
  }, []);

  const stopScanner = useCallback(async () => {
    scanLockedRef.current = false;
    lastDecodeRef.current = { code: '', at: 0 };
    lifecycleRef.current += 1;
    const scanner = scannerRef.current;
    scannerRef.current = null;
    runningRef.current = false;
    await safeScannerStop(scanner);
    releaseAllCameraStreams(regionRef.current);
    releaseAllCameraStreams();
    await delay(STOP_SETTLE_MS);
  }, []);

  const runScanner = useCallback(async () => {
    if (!regionRef.current) return;

    const runId = lifecycleRef.current + 1;
    setPhase('starting');
    setAccessError(null);
    onErrorRef.current?.('');

    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
      const scanner = new Html5Qrcode(elementId) as unknown as Html5QrcodeInstance;

      const onDecoded = (decodedText: string) => {
        if (lifecycleRef.current !== runId || scanLockedRef.current || pausedRef.current) return;
        const code = normalizeBarcodeInput(decodedText);
        if (!isPlausibleScanCode(code)) return;

        const now = Date.now();
        const last = lastDecodeRef.current;
        if (last.code === code && now - last.at < SCAN_COOLDOWN_HANDLED_MS) return;
        if (now - last.at < SCAN_COOLDOWN_MS) return;

        scanLockedRef.current = true;
        const handled = onScanRef.current(code) !== false;
        lastDecodeRef.current = { code, at: now };

        const pauseMs = handled ? SCAN_COOLDOWN_HANDLED_MS : SCAN_COOLDOWN_MS;
        window.setTimeout(() => {
          if (lifecycleRef.current !== runId) return;
          scanLockedRef.current = false;
        }, pauseMs);
      };

      await startScannerWithFallback(scanner, elementId, Html5QrcodeSupportedFormats, onDecoded);

      if (lifecycleRef.current !== runId) {
        await safeScannerStop(scanner);
        return;
      }

      await applyBarcodeCameraEnhancements(elementId);
      scannerRef.current = scanner;
      runningRef.current = true;
      setPhase('live');
    } catch (e: unknown) {
      if (lifecycleRef.current === runId) {
        const formatted = formatCameraError(e);
        setAccessError(formatted);
        setPhase('error');
        onErrorRef.current?.(formatted.message);
      }
    }
  }, [elementId]);

  const enableCamera = useCallback(() => {
    if (startingRef.current) return;
    startingRef.current = true;

    void enqueue(async () => {
      try {
        const env = isCameraEnvironmentOk();
        if (!env.ok) {
          const fail: CameraAccessResult = {
            ok: false,
            denied: false,
            message: env.message,
            hint: 'Bookmark your https:// Stash URL for stock take on your phone.',
          };
          setAccessError(fail);
          setPhase('error');
          onErrorRef.current?.(fail.message);
          return;
        }

        await stopScanner();
        const perm = await requestCameraPermission();
        if (!perm.ok) {
          setAccessError(perm);
          setPhase('error');
          onErrorRef.current?.(perm.message);
          return;
        }

        await runScanner();
      } finally {
        startingRef.current = false;
      }
    });
  }, [enqueue, runScanner, stopScanner]);

  const closeCamera = useCallback(() => {
    void enqueue(async () => {
      await stopScanner();
      setPhase('idle');
      setAccessError(null);
      onErrorRef.current?.('');
      onCloseRef.current?.();
    });
  }, [enqueue, stopScanner]);

  useEffect(() => {
    if (active) {
      setShowShell(true);
      return;
    }
    void enqueue(async () => {
      await stopScanner();
      setPhase('idle');
      setAccessError(null);
      if (!active) setShowShell(false);
    });
  }, [active, enqueue, stopScanner]);

  useEffect(() => () => {
    lifecycleRef.current += 1;
    void stopScanner();
  }, [stopScanner]);

  useEffect(() => {
    if (phase !== 'live' || !scannerRef.current || !paused) return;
    const scanner = scannerRef.current;
    try {
      if (scanner.getState?.() === STATE_SCANNING) {
        scanner.pause(true);
      }
    } catch { /* */ }
    return () => {
      try {
        if (scanner.getState?.() === STATE_PAUSED) {
          scanner.resume();
        }
      } catch { /* */ }
    };
  }, [paused, phase]);

  if (!showShell) return null;

  const env = isCameraEnvironmentOk();

  return (
    <div className="relative rounded-xl overflow-hidden border-2 border-indigo-400 bg-black shadow-inner min-h-[min(85vw,440px)] [&_#qr-shaded-region]:!hidden">
      <div
        ref={regionRef}
        id={elementId}
        className={`w-full min-h-[min(85vw,440px)] [&_video]:object-cover [&_video]:min-h-[min(85vw,440px)] [&_video]:w-full ${phase === 'live' || phase === 'starting' ? '' : 'invisible h-0 min-h-0 overflow-hidden'}`}
      />

      {!active && (
        <div className="absolute inset-0 z-10 bg-gray-50/95" aria-hidden />
      )}

      {active && phase === 'idle' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 bg-slate-900 text-center">
          {!env.ok ? (
            <>
              <p className="text-sm font-bold text-amber-200">{env.message}</p>
              <p className="text-[11px] text-white/60">Camera scanning needs https on mobile.</p>
            </>
          ) : (
            <>
              <Camera className="w-10 h-10 text-indigo-300" />
              <p className="text-sm font-bold text-white">Tap below to turn on the camera</p>
              <p className="text-[11px] text-white/60 max-w-xs">
                Your phone will ask to allow the camera. If you blocked it before, use the hint after tapping.
              </p>
              <button
                type="button"
                disabled={startingRef.current}
                onClick={() => enableCamera()}
                className="px-5 py-3 bg-indigo-600 text-white rounded-xl text-[11px] font-black uppercase tracking-widest hover:bg-indigo-500 disabled:opacity-50"
              >
                Enable camera
              </button>
            </>
          )}
        </div>
      )}

      {active && phase === 'starting' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-white z-20">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-300" />
          <span className="text-[10px] font-black uppercase tracking-widest">Starting camera…</span>
          <span className="text-[10px] text-white/50">Allow camera if prompted</span>
        </div>
      )}

      {active && (phase === 'error' || (phase === 'idle' && accessError)) && accessError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-5 bg-slate-900 text-center z-20">
          <p className="text-sm font-bold text-amber-200">{accessError.message}</p>
          <p className="text-[11px] text-white/70 max-w-sm leading-relaxed">{accessError.hint}</p>
          <button
            type="button"
            disabled={startingRef.current}
            onClick={() => enableCamera()}
            className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            Try again
          </button>
        </div>
      )}

      {active && phase === 'live' && (
        <>
          <button
            type="button"
            onClick={() => closeCamera()}
            className="absolute top-2 right-2 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/70 text-white text-[10px] font-black uppercase tracking-widest hover:bg-black/90 border border-white/20"
            aria-label="Close camera"
          >
            <X className="w-3.5 h-3.5" />
            Close
          </button>
          <div className="absolute bottom-0 inset-x-0 z-20 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
            <p className="text-[10px] font-bold text-white/90 text-center flex items-center justify-center gap-1.5">
              <Camera className="w-3.5 h-3.5" />
              Hold 25–50cm away — centre the barcode in frame
            </p>
          </div>
        </>
      )}
    </div>
  );
};

export default React.memo(
  BarcodeCameraScanner,
  (prev, next) => prev.active === next.active && prev.paused === next.paused,
);
