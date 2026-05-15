/** Stop every MediaStream track under `scope` (or the whole document). */
export function releaseAllCameraStreams(scope?: ParentNode | null): void {
  const root = scope ?? document;
  root.querySelectorAll('video').forEach(video => {
    const stream = video.srcObject;
    if (stream instanceof MediaStream) {
      stream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch { /* */ }
      });
    }
    video.srcObject = null;
    video.removeAttribute('src');
  });
}
