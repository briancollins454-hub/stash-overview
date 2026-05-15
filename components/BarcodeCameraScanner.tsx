import React, { useEffect, useId, useRef, useState } from 'react';
import { Camera, Loader2 } from 'lucide-react';
import { isPlausibleScanCode, normalizeBarcodeInput } from '../services/productResolver';

const SCAN_COOLDOWN_MS = 550;

interface Props {
  active: boolean;
  onScan: (code: string) => void;
  onError?: (message: string) => void;
}

/** Phone / tablet camera barcode reader (EAN, UPC, Code 128). */
const BarcodeCameraScanner: React.FC<Props> = ({ active, onScan, onError }) => {
  const regionId = useId().replace(/:/g, '');
  const regionRef = useRef<HTMLDivElement>(null);
  const [starting, setStarting] = useState(false);
  const runningRef = useRef(false);
  const scanLockedRef = useRef(false);
  const scannerRef = useRef<{
    stop: () => Promise<void>;
    clear: () => Promise<void>;
    pause: (shouldPauseVideo?: boolean) => void;
    resume: () => void;
  } | null>(null);
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  onScanRef.current = onScan;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!active) {
      scanLockedRef.current = false;
      const stop = async () => {
        if (scannerRef.current && runningRef.current) {
          try {
            await scannerRef.current.stop();
            await scannerRef.current.clear();
          } catch { /* camera already stopped */ }
          runningRef.current = false;
          scannerRef.current = null;
        }
      };
      void stop();
      return;
    }

    if (runningRef.current) return;

    let cancelled = false;
    setStarting(true);

    const elementId = `stash-barcode-camera-${regionId}`;

    const start = async () => {
      if (!regionRef.current || cancelled) return;
      try {
        const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');
        if (cancelled) return;

        const scanner = new Html5Qrcode(elementId);
        await scanner.start(
          {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          {
            fps: 24,
            disableFlip: false,
            useBarCodeDetectorIfSupported: true,
            qrbox: (viewfinderWidth, viewfinderHeight) => ({
              width: Math.floor(viewfinderWidth * 0.96),
              height: Math.floor(viewfinderHeight * 0.75),
            }),
            formatsToSupport: [
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.CODE_39,
            ],
          },
          decodedText => {
            if (cancelled || scanLockedRef.current) return;
            const code = normalizeBarcodeInput(decodedText);
            if (!isPlausibleScanCode(code)) return;

            scanLockedRef.current = true;
            onScanRef.current(code);

            try {
              scanner.pause(true);
            } catch { /* */ }

            window.setTimeout(() => {
              if (cancelled) return;
              try {
                scanner.resume();
              } catch { /* */ }
              scanLockedRef.current = false;
            }, SCAN_COOLDOWN_MS);
          },
          () => { /* no barcode in frame */ },
        );

        if (cancelled) {
          await scanner.stop().catch(() => {});
          return;
        }
        scannerRef.current = scanner;
        runningRef.current = true;
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Could not start camera';
          onErrorRef.current?.(msg);
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    };

    void start();

    return () => {
      cancelled = true;
      scanLockedRef.current = false;
      void (async () => {
        if (scannerRef.current && runningRef.current) {
          try {
            await scannerRef.current.stop();
            await scannerRef.current.clear();
          } catch { /* */ }
          runningRef.current = false;
          scannerRef.current = null;
        }
      })();
    };
  }, [active, regionId]);

  if (!active) return null;

  return (
    <div className="relative rounded-xl overflow-hidden border-2 border-indigo-400 bg-black shadow-inner">
      <div
        ref={regionRef}
        id={`stash-barcode-camera-${regionId}`}
        className="w-full min-h-[min(70vw,380px)] [&_video]:object-cover [&_video]:min-h-[min(70vw,380px)]"
      />
      {starting && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-300" />
          <span className="text-[10px] font-black uppercase tracking-widest">Starting camera…</span>
        </div>
      )}
      <div className="absolute bottom-0 inset-x-0 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
        <p className="text-[10px] font-bold text-white/90 text-center flex items-center justify-center gap-1.5">
          <Camera className="w-3.5 h-3.5" />
          Hold barcode in frame — beeps when counted
        </p>
      </div>
    </div>
  );
};

export default React.memo(BarcodeCameraScanner, (prev, next) => prev.active === next.active);
