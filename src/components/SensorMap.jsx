import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapRadarGlyph } from './Icons.jsx';

if (typeof maplibregl.setWorkerUrl === 'function') {
  maplibregl.setWorkerUrl(maplibreWorkerUrl);
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const VECTOR_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

const OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: 'OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
};

const PIN_COLOR_BY_STATUS = {
  AMAN: '#10b981',
  WASPADA: '#f59e0b',
  BAHAYA: '#f97316',
  KRITIS: '#ef4444',
};

export function SensorMap({ state, onSaveConfig }) {
  const { config, reading } = state;
  const gps = reading?.gps;
  const criterion = reading?.criterion;

  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const markerElRef = useRef(null);
  const popupRef = useRef(null);
  const lastCoordsRef = useRef(null);
  const fallbackAppliedRef = useRef(false);

  const [webglError, setWebglError] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [latInput, setLatInput] = useState(String(config.campusLat ?? -7.782196920093637));
  const [lngInput, setLngInput] = useState(String(config.campusLng ?? 110.4146253));
  const [labelInput, setLabelInput] = useState(
    config.campusLocationLabel || 'Stand Expo IoT Kampus'
  );
  const [mapBusy, setMapBusy] = useState(false);
  const [mapFeedback, setMapFeedback] = useState(null);
  const [copiedCoords, setCopiedCoords] = useState(false);

  useEffect(() => {
    setLatInput(String(config.campusLat ?? -7.782196920093637));
    setLngInput(String(config.campusLng ?? 110.4146253));
    setLabelInput(config.campusLocationLabel || 'Stand Expo IoT Kampus');
  }, [config.campusLat, config.campusLng, config.campusLocationLabel]);

  const hasCoords = Boolean(
    gps && gps.state === 'VALID' && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)
  );
  const latNum = hasCoords ? gps.lat : null;
  const lngNum = hasCoords ? gps.lng : null;
  const statusCode = criterion?.code || 'AMAN';
  const pinColor = PIN_COLOR_BY_STATUS[statusCode] || '#0284c7';
  const distanceLabel = criterion?.displayDistance || '--- cm';
  const locationTitle = gps?.isFallback
    ? gps.locationLabel || 'Stand Expo IoT Kampus'
    : 'Sensor Banjir ESP32';

  // Inisialisasi & update MapLibre instance
  useEffect(() => {
    if (!hasCoords || !mapContainerRef.current) {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markerRef.current = null;
        markerElRef.current = null;
        popupRef.current = null;
        lastCoordsRef.current = null;
      }
      return undefined;
    }

    if (!mapInstanceRef.current) {
      fallbackAppliedRef.current = false;
      try {
        const map = new maplibregl.Map({
          container: mapContainerRef.current,
          style: VECTOR_STYLE_URL,
          center: [lngNum, latNum],
          zoom: 16.2,
          pitch: 32,
          attributionControl: { compact: true },
        });

        map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

        map.on('error', () => {
          if (!fallbackAppliedRef.current && mapInstanceRef.current === map) {
            fallbackAppliedRef.current = true;
            try {
              map.setStyle(OSM_RASTER_STYLE);
            } catch {
              // Abaikan bila gaya raster juga gagal
            }
          }
        });

        const markerEl = document.createElement('div');
        markerEl.className = 'maplibre-status-pin';
        markerEl.style.setProperty('--pin-color', pinColor);
        markerEl.setAttribute('aria-label', `Lokasi sensor status ${statusCode}`);

        const popupHtml = `<strong>${escapeHtml(locationTitle)}</strong><br/>Status: <b>${escapeHtml(statusCode)}</b> (${escapeHtml(distanceLabel)})<br/><code>${latNum.toFixed(6)}, ${lngNum.toFixed(6)}</code>`;
        const popup = new maplibregl.Popup({ offset: 18 }).setHTML(popupHtml);

        const marker = new maplibregl.Marker({ element: markerEl })
          .setLngLat([lngNum, latNum])
          .setPopup(popup)
          .addTo(map);

        mapInstanceRef.current = map;
        markerRef.current = marker;
        markerElRef.current = markerEl;
        popupRef.current = popup;
        lastCoordsRef.current = { lat: latNum, lng: lngNum };
        setWebglError(false);
      } catch {
        setWebglError(true);
      }
    } else {
      const map = mapInstanceRef.current;
      if (markerElRef.current) {
        markerElRef.current.style.setProperty('--pin-color', pinColor);
        markerElRef.current.setAttribute('aria-label', `Lokasi sensor status ${statusCode}`);
      }
      if (popupRef.current) {
        popupRef.current.setHTML(
          `<strong>${escapeHtml(locationTitle)}</strong><br/>Status: <b>${escapeHtml(statusCode)}</b> (${escapeHtml(distanceLabel)})<br/><code>${latNum.toFixed(6)}, ${lngNum.toFixed(6)}</code>`
        );
      }
      if (markerRef.current) {
        markerRef.current.setLngLat([lngNum, latNum]);
      }

      const prev = lastCoordsRef.current;
      const moved =
        !prev ||
        Math.abs(prev.lat - latNum) > 0.00001 ||
        Math.abs(prev.lng - lngNum) > 0.00001;

      if (moved) {
        lastCoordsRef.current = { lat: latNum, lng: lngNum };
        map.flyTo({ center: [lngNum, latNum], zoom: 16.2, duration: 700 });
      }
    }

    return undefined;
  }, [hasCoords, latNum, lngNum, pinColor, statusCode, distanceLabel, locationTitle]);

  useEffect(() => {
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  async function handleToggleFallback(checked) {
    setMapFeedback(null);
    setMapBusy(true);
    try {
      await onSaveConfig({ gpsFallbackEnabled: checked });
      setMapFeedback({
        type: 'ok',
        text: checked
          ? 'Pin Demo Kampus (Indoor) diaktifkan.'
          : 'Pin Demo Kampus dinonaktifkan (menggunakan GPS satelit).',
      });
    } catch (err) {
      setMapFeedback({
        type: 'err',
        text: err?.message || 'Gagal mengubah mode fallback GPS.',
      });
    } finally {
      setMapBusy(false);
    }
  }

  async function handleSaveCampusPin(e) {
    e.preventDefault();
    setMapFeedback(null);

    const parsedLat = Number(latInput);
    const parsedLng = Number(lngInput);
    if (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90) {
      setMapFeedback({ type: 'err', text: 'Latitude harus berupa angka antara -90 dan 90.' });
      return;
    }
    if (!Number.isFinite(parsedLng) || parsedLng < -180 || parsedLng > 180) {
      setMapFeedback({ type: 'err', text: 'Longitude harus berupa angka antara -180 dan 180.' });
      return;
    }

    setMapBusy(true);
    try {
      await onSaveConfig({
        gpsFallbackEnabled: true,
        campusLat: parsedLat,
        campusLng: parsedLng,
        campusLocationLabel: labelInput.trim() || 'Stand Expo IoT Kampus',
      });
      setMapFeedback({
        type: 'ok',
        text: 'Koordinat kampus tersimpan dan pin MapLibre diperbarui.',
      });
    } catch (err) {
      setMapFeedback({
        type: 'err',
        text: err?.message || 'Gagal menyimpan koordinat kampus.',
      });
    } finally {
      setMapBusy(false);
    }
  }

  async function handleCopyCoords(lat, lng) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        setCopiedCoords(true);
        setTimeout(() => setCopiedCoords(false), 1800);
      }
    } catch {
      // Abaikan jika clipboard dibatasi browser
    }
  }

  return (
    <section className="card-panel sensor-map-card" aria-label="Peta Lokasi Sensor">
      <div className="card-header-row">
        <div className="map-title-wrap">
          <div className="map-icon-wrap" aria-hidden="true">
            <MapRadarGlyph />
          </div>
          <div>
            <h2 id="map-heading" className="card-title">
              Peta Lokasi Sensor (MapLibre GL)
            </h2>
            <p className="card-subtitle">Pemantauan Posisi Geografis Node ESP32</p>
          </div>
        </div>

        <div className="map-meta-chips mono">
          {hasCoords && (
            <button
              type="button"
              className="chip-btn"
              onClick={() => handleCopyCoords(latNum, lngNum)}
              title="Salin koordinat GPS ke clipboard"
            >
              <span>{latNum.toFixed(4)}, {lngNum.toFixed(4)}</span>
              <span className="chip-action">{copiedCoords ? 'Tersalin' : 'Salin'}</span>
            </button>
          )}
          <span className={`chip-badge chip-badge--${gps?.state === 'VALID' ? 'valid' : 'invalid'}`}>
            {gps?.isFallback ? 'PIN KAMPUS' : `GPS ${gps?.state || 'INVALID'}`}
          </span>
        </div>
      </div>

      {/* Frame Peta MapLibre */}
      <div className="sensor-map-canvas-container">
        {hasCoords && !webglError ? (
          <div ref={mapContainerRef} className="maplibre-gl-viewport" />
        ) : (
          <div className="map-fallback-box">
            <p className="map-fallback-title">
              {webglError
                ? 'Akselerasi WebGL tidak aktif di browser Anda.'
                : 'Sinyal GPS Satelit Belum Mengunci Posisi (NO LOCK).'}
            </p>
            <p className="map-fallback-desc">
              Untuk kebutuhan presentasi indoor atau expo kampus, aktifkan opsi <strong>Gunakan Pin Lokasi Kampus</strong> di bawah.
            </p>
          </div>
        )}
      </div>

      {/* Kontrol & Opsi Lokasi Kampus */}
      <div className="sensor-map-footer">
        <div className="map-fallback-toggle-row">
          <label className="checkbox-label" htmlFor="gps-fallback-checkbox">
            <input
              id="gps-fallback-checkbox"
              type="checkbox"
              checked={Boolean(config.gpsFallbackEnabled)}
              disabled={mapBusy}
              onChange={(e) => handleToggleFallback(e.target.checked)}
              className="form-checkbox"
            />
            <span>Gunakan Pin Lokasi Kampus jika GPS satelit tidak mendapat sinyal (Indoor)</span>
          </label>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setEditorOpen((prev) => !prev)}
            aria-expanded={editorOpen}
          >
            {editorOpen ? 'Tutup Pengaturan Pin' : 'Atur Koordinat Pin'}
          </button>
        </div>

        {mapFeedback && (
          <div
            className={`feedback-banner feedback-banner--${mapFeedback.type}`}
            role="status"
          >
            {mapFeedback.text}
          </div>
        )}

        {editorOpen && (
          <form className="campus-pin-editor-form" onSubmit={handleSaveCampusPin}>
            <div className="editor-fields-row">
              <div className="form-group">
                <label className="form-label" htmlFor="campus-label-input">
                  Label Lokasi
                </label>
                <input
                  id="campus-label-input"
                  type="text"
                  className="text-input"
                  value={labelInput}
                  disabled={mapBusy}
                  onChange={(e) => setLabelInput(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="campus-lat-input">
                  Latitude
                </label>
                <input
                  id="campus-lat-input"
                  type="text"
                  className="text-input mono"
                  value={latInput}
                  disabled={mapBusy}
                  onChange={(e) => setLatInput(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="campus-lng-input">
                  Longitude
                </label>
                <input
                  id="campus-lng-input"
                  type="text"
                  className="text-input mono"
                  value={lngInput}
                  disabled={mapBusy}
                  onChange={(e) => setLngInput(e.target.value)}
                />
              </div>
            </div>

            <div className="editor-action-row">
              <button
                type="submit"
                className="btn btn-primary btn-sm"
                disabled={mapBusy}
              >
                {mapBusy ? 'Menyimpan...' : 'Simpan Koordinat Pin'}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

// Re-export untuk kompatibilitas jika masih ada import lama
export { SensorMap as MapLibrePanel };
