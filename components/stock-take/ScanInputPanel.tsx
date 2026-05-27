import React, { FormEvent } from 'react';
import { Barcode, Camera, Keyboard, Volume2, VolumeX } from 'lucide-react';
import BarcodeCameraScanner from '../BarcodeCameraScanner';

export type ScanMode = 'camera' | 'keyboard';

interface Props {
  scanMode: ScanMode;
  onChangeMode: (mode: ScanMode) => void;
  cameraOpen: boolean;
  cameraError: string | null;
  cameraFlash: string | null;
  onCameraOpen: () => void;
  onCameraScan: (raw: string) => boolean;
  onCameraError: (msg: string) => void;
  onCameraClose: () => void;
  pauseCamera: boolean;
  scanValue: string;
  onChangeScanValue: (value: string) => void;
  onScanSubmit: (e?: FormEvent) => void;
  scanInputRef: React.RefObject<HTMLInputElement | null>;
  addQty: number;
  onChangeAddQty: (value: number) => void;
  cartonMode: boolean;
  onToggleCartonMode: () => void;
  embellished: boolean;
  onToggleEmbellished: () => void;
  clubName: string;
  onChangeClubName: (value: string) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  unknownOverlay?: React.ReactNode;
}

const ScanInputPanel: React.FC<Props> = ({
  scanMode,
  onChangeMode,
  cameraOpen,
  cameraError,
  cameraFlash,
  onCameraOpen,
  onCameraScan,
  onCameraError,
  onCameraClose,
  pauseCamera,
  scanValue,
  onChangeScanValue,
  onScanSubmit,
  scanInputRef,
  addQty,
  onChangeAddQty,
  cartonMode,
  onToggleCartonMode,
  embellished,
  onToggleEmbellished,
  clubName,
  onChangeClubName,
  soundEnabled,
  onToggleSound,
  unknownOverlay,
}) => (
  <div className="bg-white rounded-xl border-2 border-indigo-200 shadow-sm p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label className="text-[10px] font-black uppercase tracking-widest text-indigo-600 flex items-center gap-2">
        <Barcode className="w-4 h-4" /> Add items
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleSound}
          title={soundEnabled ? 'Mute scan tones' : 'Enable scan tones'}
          className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"
        >
          {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-[10px] font-black uppercase tracking-widest">
          <button
            type="button"
            onClick={() => onChangeMode('camera')}
            className={`flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 transition-colors ${scanMode === 'camera' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            <Camera className="w-3.5 h-3.5" /> Camera
          </button>
          <button
            type="button"
            onClick={() => onChangeMode('keyboard')}
            className={`flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 border-l border-gray-200 transition-colors ${scanMode === 'keyboard' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          >
            <Keyboard className="w-3.5 h-3.5" /> Type
          </button>
        </div>
      </div>
    </div>

    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[9px] font-black uppercase text-gray-400">Qty per scan</span>
        <input
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min={1}
          value={addQty}
          onChange={e => onChangeAddQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
          className="w-16 min-h-[40px] py-1.5 text-center font-black text-sm border border-gray-200 rounded-lg"
        />
      </div>
      <label className={`min-h-[40px] flex items-center gap-2 px-3 rounded-lg border text-[10px] font-black uppercase tracking-widest cursor-pointer transition-colors ${
        cartonMode ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-500 border-gray-200'
      }`}>
        <input
          type="checkbox"
          className="sr-only"
          checked={cartonMode}
          onChange={onToggleCartonMode}
        />
        Carton mode {cartonMode ? '· qty stays' : '· qty auto-resets'}
      </label>
      <label className={`min-h-[40px] flex items-center gap-2 px-3 rounded-lg border text-[10px] font-black uppercase tracking-widest cursor-pointer transition-colors ${
        embellished ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-500 border-gray-200'
      }`}>
        <input
          type="checkbox"
          className="sr-only"
          checked={embellished}
          onChange={onToggleEmbellished}
        />
        Embellished
      </label>
      {embellished && (
        <input
          value={clubName}
          onChange={e => onChangeClubName(e.target.value)}
          placeholder="Club / customer"
          className="min-h-[40px] px-3 border border-purple-200 rounded-lg text-sm font-bold"
        />
      )}
    </div>

    {scanMode === 'camera' && (
      <div className="relative space-y-2">
        <BarcodeCameraScanner
          active={cameraOpen}
          paused={pauseCamera}
          onScan={onCameraScan}
          onError={onCameraError}
          onClose={onCameraClose}
        />
        {!cameraOpen && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/95 p-6 text-center">
            <Camera className="w-8 h-8 text-gray-400" />
            <p className="text-sm font-bold text-gray-600">Camera is off</p>
            <p className="text-[11px] text-gray-400 max-w-xs">
              Turn it on to scan barcodes, or use Type for a USB scanner.
            </p>
            <button
              type="button"
              onClick={onCameraOpen}
              className="min-h-[44px] px-4 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500"
            >
              Open camera
            </button>
          </div>
        )}
        {cameraError && (
          <p className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {cameraError}
          </p>
        )}
        {cameraFlash && (
          <p className="text-center text-sm font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg py-2 font-mono">
            ✓ {cameraFlash}
          </p>
        )}
        {unknownOverlay}
      </div>
    )}

    {scanMode === 'keyboard' && (
      <form onSubmit={onScanSubmit} className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <input
            ref={scanInputRef}
            value={scanValue}
            onChange={e => onChangeScanValue(e.target.value)}
            placeholder="EAN / barcode — Enter to add"
            className="flex-1 min-w-[200px] min-h-[52px] px-4 py-3 text-lg font-mono border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500/30 outline-none"
            autoComplete="off"
            inputMode="numeric"
          />
          <button
            type="submit"
            className="min-h-[52px] px-5 py-3 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-indigo-500"
          >
            Add
          </button>
        </div>
        <p className="text-[10px] text-gray-400">
          USB wedge scanners work here — focus stays in the box.
        </p>
      </form>
    )}
  </div>
);

export default ScanInputPanel;
