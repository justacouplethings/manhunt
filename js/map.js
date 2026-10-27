/**
 * Manhunt Tactical Leaflet Map Controller
 * Delivers zero-API-key tactical cartography, automatic viewport resizing,
 * multi-target marker rendering, and squad-wide zoom fitting.
 */
class TacticalMap {
  constructor(containerId = 'map-view') {
    this.containerId = containerId;
    this.map = null;
    this.tileLayer = null;
    this.selfMarker = null;
    this.playerMarkers = new Map(); // playerId -> L.Marker
    this.breadcrumbPaths = new Map(); // playerId -> L.Polyline
    this.boundaryCircle = null;
    this.isInitialized = false;
    this.autoFollowSelf = true;
  }

  init(initialLat = 40.7128, initialLng = -74.0060, zoom = 15) {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    if (this.map) {
      this.invalidate();
      return;
    }

    // Initialize Leaflet map with standard mobile touch controls
    this.map = L.map(this.containerId, {
      zoomControl: false,
      attributionControl: false,
      maxZoom: 19,
      minZoom: 2,
      fadeAnimation: true,
      zoomAnimation: true
    }).setView([initialLat, initialLng], zoom);

    // Apply zero-key universal high-speed basemap
    this.applyTileStyle();

    // Disable auto-follow when user manually moves or zooms the map
    this.map.on('dragstart zoomstart', () => {
      this.autoFollowSelf = false;
      const followBtn = document.getElementById('btn-recenter');
      if (followBtn) followBtn.classList.remove('active');
    });

    this.isInitialized = true;
    this.invalidate();
  }

  /**
   * Re-evaluates container dimensions (essential when transitioning from hidden to visible screens)
   */
  invalidate() {
    if (!this.map) return;
    [50, 150, 400].forEach(delay => {
      setTimeout(() => {
        try {
          if (this.map) this.map.invalidateSize({ animate: false });
        } catch (e) {}
      }, delay);
    });
  }

  /**
   * Universal zero-key, high-resolution tile provider with automatic OpenStreetMap fallback
   */
  applyTileStyle() {
    if (!this.map) return;
    if (this.tileLayer) {
      this.map.removeLayer(this.tileLayer);
    }

    // High-speed ArcGIS World Street Map (free, zero API key required, global coverage)
    const arcGisUrl = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
    const osmUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

    this.tileLayer = L.tileLayer(arcGisUrl, {
      maxZoom: 19,
      minZoom: 2,
      subdomains: 'abcd',
      crossOrigin: true
    }).addTo(this.map);

    // Fallback to OSM if ArcGIS tiles encounter network errors
    this.tileLayer.on('tileerror', () => {
      if (!this._fallbackActive) {
        this._fallbackActive = true;
        console.warn('Switching to secondary map tile provider (OSM)');
        if (this.tileLayer) this.map.removeLayer(this.tileLayer);
        this.tileLayer = L.tileLayer(osmUrl, {
          maxZoom: 19,
          minZoom: 2,
          crossOrigin: true
        }).addTo(this.map);
      }
    });
  }

  /**
   * Update current player's location marker with high-accuracy heading arrow
   */
  updateSelfLocation(lat, lng, role, heading = null) {
    if (!this.map) {
      this.init(lat, lng);
    }

    const isSeeker = role === 'seeker';
    const markerColor = isSeeker ? '#ff4757' : '#00f5b4';
    const roleLabel = isSeeker ? 'SEEKER (YOU)' : 'RUNNER (YOU)';

    const iconHtml = `
      <div class="tactical-marker-container">
        <div class="marker-pulse" style="border-color: ${markerColor};"></div>
        <div class="marker-core" style="background-color: ${markerColor};">
          ${heading !== null && heading !== undefined ? `<div class="marker-heading" style="transform: rotate(${heading}deg);">▲</div>` : ''}
        </div>
        <div class="marker-callsign">${roleLabel}</div>
      </div>
    `;

    const icon = L.divIcon({
      className: 'tactical-div-icon',
      html: iconHtml,
      iconSize: [42, 42],
      iconAnchor: [21, 21]
    });

    if (!this.selfMarker) {
      this.selfMarker = L.marker([lat, lng], { icon: icon, zIndexOffset: 1000 }).addTo(this.map);
    } else {
      this.selfMarker.setLatLng([lat, lng]);
      this.selfMarker.setIcon(icon);
    }

    if (this.autoFollowSelf) {
      this.map.panTo([lat, lng], { animate: true, duration: 0.5 });
    }
  }

  /**
   * Update or reveal a remote player
   * Tapping directly on any runner selects and locks onto them!
   */
  updatePeerLocation(peerId, lat, lng, role, nickname, isPingReveal = false) {
    if (!this.map) return;

    const isSeeker = role === 'seeker';
    const isLocked = Game.lockedTargetId === peerId;
    const markerColor = isSeeker ? '#ff4757' : (isLocked ? '#00d4ff' : '#00f5b4');

    const iconHtml = `
      <div class="tactical-marker-container ${isLocked ? 'target-locked-beacon' : ''}">
        <div class="marker-pulse ${isPingReveal ? 'beacon-flash' : ''}" style="border-color: ${markerColor};"></div>
        <div class="marker-core peer-marker" style="background-color: ${markerColor}; ${isLocked ? 'box-shadow: 0 0 16px #00d4ff; border-color: #00d4ff;' : ''}"></div>
        <div class="marker-callsign ${isLocked ? 'callsign-locked' : ''}">
          ${isLocked ? '🎯 ' : ''}${nickname} (${role.toUpperCase()})
        </div>
      </div>
    `;

    const icon = L.divIcon({
      className: 'tactical-div-icon',
      html: iconHtml,
      iconSize: [38, 38],
      iconAnchor: [19, 19]
    });

    let marker = this.playerMarkers.get(peerId);
    if (!marker) {
      marker = L.marker([lat, lng], { icon: icon }).addTo(this.map);
      marker.on('click', () => {
        if (Game.role === 'seeker' && role === 'runner') {
          Game.selectTarget(peerId, nickname);
        }
      });
      this.playerMarkers.set(peerId, marker);
    } else {
      marker.setLatLng([lat, lng]);
      marker.setIcon(icon);
    }

    // If Runner ping revealed or Seeker, trigger tactical beacon wave
    if (isPingReveal || !isSeeker) {
      this.triggerPingWave(lat, lng, markerColor);
      this.addBreadcrumb(peerId, lat, lng, markerColor);
    }
  }

  /**
   * Expanding radar ripple wave on Runner ping
   */
  triggerPingWave(lat, lng, color) {
    if (!this.map) return;
    const wave = L.circle([lat, lng], {
      radius: 35,
      color: color,
      weight: 2,
      fillColor: color,
      fillOpacity: 0.4
    }).addTo(this.map);

    let radius = 35;
    let opacity = 0.4;
    const interval = setInterval(() => {
      radius += 20;
      opacity -= 0.04;
      if (opacity <= 0 || radius > 200) {
        clearInterval(interval);
        try { this.map.removeLayer(wave); } catch (e) {}
      } else {
        wave.setRadius(radius);
        wave.setStyle({ fillOpacity: opacity, opacity: opacity * 1.5 });
      }
    }, 50);
  }

  addBreadcrumb(peerId, lat, lng, color) {
    let polyline = this.breadcrumbPaths.get(peerId);
    if (!polyline) {
      polyline = L.polyline([[lat, lng]], {
        color: color,
        weight: 3,
        opacity: 0.6,
        dashArray: '4, 8'
      }).addTo(this.map);
      this.breadcrumbPaths.set(peerId, polyline);
    } else {
      const latlngs = polyline.getLatLngs();
      latlngs.push([lat, lng]);
      if (latlngs.length > 25) latlngs.shift();
      polyline.setLatLngs(latlngs);
    }
  }

  removePeer(peerId) {
    const marker = this.playerMarkers.get(peerId);
    if (marker) {
      this.map.removeLayer(marker);
      this.playerMarkers.delete(peerId);
    }
    const polyline = this.breadcrumbPaths.get(peerId);
    if (polyline) {
      this.map.removeLayer(polyline);
      this.breadcrumbPaths.delete(peerId);
    }
  }

  recenter() {
    this.autoFollowSelf = true;
    if (this.selfMarker) {
      this.map.panTo(this.selfMarker.getLatLng(), { animate: true, duration: 0.5 });
    }
    const followBtn = document.getElementById('btn-recenter');
    if (followBtn) followBtn.classList.add('active');
  }

  zoomIn() {
    if (this.map) this.map.zoomIn();
  }

  zoomOut() {
    if (this.map) this.map.zoomOut();
  }

  /**
   * Fit all players (Seekers & active Runners) on screen when zooming out
   */
  fitAll() {
    if (!this.map) return;
    const points = [];
    if (this.selfMarker) points.push(this.selfMarker.getLatLng());

    // Include all known peer locations
    for (const pos of Game.lastKnownPositions.values()) {
      if (pos.lat && pos.lng) {
        points.push([pos.lat, pos.lng]);
      }
    }
    for (const marker of this.playerMarkers.values()) {
      points.push(marker.getLatLng());
    }

    if (points.length === 1) {
      this.map.setView(points[0], 15, { animate: true });
    } else if (points.length > 1) {
      this.map.fitBounds(L.latLngBounds(points), {
        padding: [60, 60],
        maxZoom: 16,
        animate: true
      });
    }
  }

  setBoundary(centerLat, centerLng, radiusMeters) {
    if (this.boundaryCircle) {
      this.map.removeLayer(this.boundaryCircle);
      this.boundaryCircle = null;
    }
    if (radiusMeters > 0 && this.map) {
      this.boundaryCircle = L.circle([centerLat, centerLng], {
        radius: radiusMeters,
        color: '#fbbf24',
        weight: 2,
        fillColor: '#fbbf24',
        fillOpacity: 0.04,
        dashArray: '6, 6'
      }).addTo(this.map);
    }
  }
}

// Global TacticalMap singleton
const MapController = new TacticalMap();
