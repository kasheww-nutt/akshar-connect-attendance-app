export interface GeoFix {
  latitude: number;
  longitude: number;
  accuracy: number;
}

export class LocationError extends Error {}

export function getCurrentLocation(timeoutMs = 15000): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new LocationError('Location is not supported on this device.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        }),
      err => {
        const message =
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Please allow location access to save attendance.'
            : err.code === err.TIMEOUT
              ? 'Timed out getting your location. Please try again.'
              : 'Could not determine your location. Please try again.';
        reject(new LocationError(message));
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

export function mapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`;
}
