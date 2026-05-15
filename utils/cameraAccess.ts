export type CameraAccessResult =
  | { ok: true }
  | { ok: false; denied: boolean; message: string; hint: string };

export function isCameraEnvironmentOk(): { ok: true } | { ok: false; message: string } {
  if (typeof window === 'undefined') {
    return { ok: false, message: 'Camera is only available in the browser.' };
  }
  if (!window.isSecureContext) {
    return {
      ok: false,
      message: 'Camera requires a secure connection (https://). Open Stash from your production URL, not a plain http link.',
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, message: 'This browser does not support camera access.' };
  }
  return { ok: true };
}

function cameraSettingsHint(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  if (isIOS) {
    return 'iPhone/iPad: Settings → Safari → Camera → Allow. Or tap the aA icon in the address bar → Website Settings → Camera → Allow, then reload.';
  }
  if (isAndroid) {
    return 'Android: tap the lock icon in the address bar → Permissions → Camera → Allow, then tap Enable camera again.';
  }
  return 'Click the lock or camera icon in the address bar, allow Camera for this site, then tap Enable camera again.';
}

export function formatCameraError(err: unknown): CameraAccessResult {
  const denied = err instanceof DOMException && (
    err.name === 'NotAllowedError'
    || err.name === 'PermissionDeniedError'
    || err.name === 'SecurityError'
  );
  const notFound = err instanceof DOMException && (
    err.name === 'NotFoundError'
    || err.name === 'DevicesNotFoundError'
  );
  const overconstrained = err instanceof DOMException && err.name === 'OverconstrainedError';
  const transitionConflict = /already under transition|transition to a new state/i.test(
    err instanceof Error ? err.message : String(err),
  );

  if (transitionConflict) {
    return {
      ok: false,
      denied: false,
      message: 'Camera is still starting or stopping.',
      hint: 'Wait two seconds, tap Close, then Enable camera again.',
    };
  }

  if (denied) {
    return {
      ok: false,
      denied: true,
      message: 'Camera access was blocked.',
      hint: cameraSettingsHint(),
    };
  }
  if (notFound) {
    return {
      ok: false,
      denied: false,
      message: 'No camera found on this device.',
      hint: 'Use Type mode or connect a device with a rear camera.',
    };
  }
  if (overconstrained) {
    return {
      ok: false,
      denied: false,
      message: 'Could not use the rear camera with the requested settings.',
      hint: 'Tap Enable camera again — Stash will try a simpler camera mode.',
    };
  }

  const raw = err instanceof Error ? err.message : String(err);
  return {
    ok: false,
    denied: false,
    message: raw || 'Could not start camera.',
    hint: cameraSettingsHint(),
  };
}

/** Prefer rear camera at high resolution so 1D barcodes decode from farther away. */
export function buildBarcodeCameraConstraints(deviceId?: string): MediaTrackConstraints {
  const highRes: MediaTrackConstraints = {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1920, min: 1280 },
    height: { ideal: 1080, min: 720 },
    aspectRatio: { ideal: 1.7777777778 },
  };
  if (deviceId) {
    return { ...highRes, deviceId: { exact: deviceId } };
  }
  return highRes;
}

/** Lighter constraints when the phone rejects 1080p / continuous focus. */
export function buildBarcodeCameraConstraintsFallback(deviceId?: string): MediaTrackConstraints {
  const basic: MediaTrackConstraints = { facingMode: { ideal: 'environment' } };
  if (deviceId) {
    return { ...basic, deviceId: { exact: deviceId } };
  }
  return basic;
}

/** Enable continuous autofocus when the device supports it (helps scan range). */
export async function applyBarcodeCameraEnhancements(containerId: string): Promise<void> {
  const root = document.getElementById(containerId);
  const video = root?.querySelector('video');
  const stream = video?.srcObject;
  if (!(stream instanceof MediaStream)) return;

  const track = stream.getVideoTracks()[0];
  if (!track?.applyConstraints) return;

  try {
    const caps = track.getCapabilities?.() as MediaTrackCapabilities & {
      focusMode?: string[];
    };
    if (caps?.focusMode?.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    }
  } catch {
    /* optional — some browsers omit focusMode */
  }
}

/** Request camera permission — must be called from a user tap/click. */
export async function requestCameraPermission(): Promise<CameraAccessResult> {
  const env = isCameraEnvironmentOk();
  if (!env.ok) {
    return { ok: false, denied: false, message: env.message, hint: 'Use the https:// link for your live Stash site.' };
  }

  try {
    const perm = await navigator.permissions.query({ name: 'camera' as PermissionName });
    if (perm.state === 'denied') {
      return {
        ok: false,
        denied: true,
        message: 'Camera is blocked for this site.',
        hint: cameraSettingsHint(),
      };
    }
  } catch {
    /* permissions.query not supported — fall through to getUserMedia */
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    stream.getTracks().forEach(t => t.stop());
    return { ok: true };
  } catch (e) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      stream.getTracks().forEach(t => t.stop());
      return { ok: true };
    } catch (e2) {
      return formatCameraError(e2);
    }
  }
}
