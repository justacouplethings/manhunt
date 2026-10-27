/**
 * Manhunt Geolocation & Spatial Calculations
 * Provides high-precision GPS tracking, satellite accuracy, Haversine distance math, and bearing orientation.
 */
class GeoEngine {
  constructor() {
    this.watchId = null;
    this.currentPosition = null;
    this.locationCallbacks = new Set();
    this.errorCallbacks = new Set();
    this.isTracking = false;
    this._orientationBound = false;
    this.setupOrientation();
  }

  /**
   * Hardware compass & gyroscope heading listener (with iOS WebKit permission support)
   */
  setupOrientation() {
    if (this._orientationBound) return;
    this._orientationBound = true;

    const handleOrientation = (e) => {
      let compassHeading = null;
      if (e.webkitCompassHeading !== undefined) {
        // iOS WebKit true or magnetic compass heading
        compassHeading = e.webkitCompassHeading;
      } else if (e.alpha !== null && e.absolute) {
        compassHeading = 360 - e.alpha;
      }

      if (compassHeading !== null) {
        if (!this.currentPosition) {
          this.currentPosition = { heading: compassHeading };
        } else {
          this.currentPosition.heading = compassHeading;
        }
        const headingArrow = document.querySelector('.marker-heading');
        if (headingArrow) {
          headingArrow.style.transform = `rotate(${Math.round(compassHeading)}deg)`;
        }
      }
    };

    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        this.requestIosCompassPermission = async () => {
          try {
            const res = await DeviceOrientationEvent.requestPermission();
            if (res === 'granted') {
              window.addEventListener('deviceorientation', handleOrientation, true);
            }
          } catch (e) {
            console.warn('iOS orientation permission notice:', e);
          }
        };
      } else {
        window.addEventListener('deviceorientationabsolute', handleOrientation, true);
        window.addEventListener('deviceorientation', handleOrientation, true);
      }
    }
  }

  /**
   * Start tracking the device GPS with fresh satellite readings
   */
  startTracking(highAccuracy = true) {
    if (this.isTracking) return;

    if (!('geolocation' in navigator)) {
      this.notifyErrors({ code: 0, message: 'Geolocation not supported on this device' });
      return;
    }

    const options = {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0 // Zero stale cache: forces live outdoor GPS chip readings
    };

    // Immediate initial location fix
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => this.handlePosition(pos),
        (err) => console.warn('Initial GPS check:', err.message),
        options
      );
    } catch (e) {}

    // Continuous high-precision tracking
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.handlePosition(pos),
      (err) => {
        console.warn('Geolocation warning/error:', err.message);
        this.notifyErrors(err);
      },
      options
    );

    this.isTracking = true;
  }

  handlePosition(pos) {
    const coords = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      altitude: pos.coords.altitude,
      heading: pos.coords.heading,
      speed: pos.coords.speed,
      timestamp: pos.timestamp || Date.now()
    };
    this.currentPosition = coords;
    this.notifyLocation(coords);
  }

  stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isTracking = false;
  }

  getCurrentPosition(options = { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }) {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          this.handlePosition(pos);
          resolve(this.currentPosition);
        },
        (err) => reject(err),
        options
      );
    });
  }

  onLocationUpdate(cb) {
    this.locationCallbacks.add(cb);
  }

  offLocationUpdate(cb) {
    this.locationCallbacks.delete(cb);
  }

  onError(cb) {
    this.errorCallbacks.add(cb);
  }

  notifyLocation(coords) {
    for (const cb of this.locationCallbacks) {
      try { cb(coords); } catch (e) { console.error('Geo callback error:', e); }
    }
  }

  notifyErrors(err) {
    for (const cb of this.errorCallbacks) {
      try { cb(err); } catch (e) { console.error('Geo error callback:', e); }
    }
  }

  /**
   * Haversine formula to compute great-circle distance between two GPS coordinates in meters
   */
  static getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Compute forward azimuth / compass bearing from point 1 to point 2 (0 - 360 degrees)
   */
  static getBearing(lat1, lon1, lat2, lon2) {
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(deltaLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) -
              Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

    let theta = Math.atan2(y, x);
    let bearing = (theta * 180 / Math.PI + 360) % 360;
    return bearing;
  }

  static formatDistance(meters) {
    if (meters < 1000) {
      return `${Math.round(meters)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
  }

  static getCardinalDirection(degrees) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(((degrees %= 360) < 0 ? degrees + 360 : degrees) / 45) % 8;
    return directions[index];
  }
}

// Global GeoEngine singleton
const Geo = new GeoEngine();
