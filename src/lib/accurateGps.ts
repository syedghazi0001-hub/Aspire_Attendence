export interface AveragedGps { coords: { latitude: number; longitude: number; accuracy: number }; samples: number }
/** Fresh watch readings reduce random jitter, not systematic GPS error. */
export function getAveragedGps(onProgress?: (message: string) => void, signal?: AbortSignal): Promise<AveragedGps> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("GPS is not supported by this browser."));
    let watch: number | undefined;
    let finished = false;
    const samples: GeolocationPosition[] = [];
    const startedAt = Date.now();
    const cleanup = () => {
      if (watch !== undefined) navigator.geolocation.clearWatch(watch);
      clearTimeout(deadline);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (message: string) => { if (finished) return; finished = true; cleanup(); reject(new Error(message)); };
    const abort = () => fail("GPS request cancelled.");
    const deadline = setTimeout(() => fail("GPS signal weak, please wait."), 30000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    watch = navigator.geolocation.watchPosition(position => {
      if (finished) return;
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 30) {
        onProgress?.("GPS signal weak, please wait."); return;
      }
      if (position.timestamp < startedAt || samples.some(s => s.timestamp === position.timestamp)) return;
      samples.push(position);
      onProgress?.(`GPS readings ${samples.length}/5. Please stand still.`);
      if (samples.length < 5) return;
      finished = true; cleanup();
      resolve({ coords: {
        latitude: samples.reduce((sum,s) => sum + s.coords.latitude,0) / samples.length,
        longitude: samples.reduce((sum,s) => sum + s.coords.longitude,0) / samples.length,
        accuracy: Math.max(...samples.map(s => s.coords.accuracy)),
      }, samples: samples.length });
    }, error => {
      if (error.code === 1) fail("GPS Location Permission Denied. Enable Location access in your browser settings.");
      else onProgress?.("GPS signal weak, please wait.");
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
    if (finished && watch !== undefined) navigator.geolocation.clearWatch(watch);
  });
}
