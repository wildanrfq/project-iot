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
  AMAN: '#138a56',
  WASPADA: '#c47f00',
  BAHAYA: '#dc4e11',
  KRITIS: '#c91824',
};

export function MapLibrePanel({ state, onSaveConfig }) {
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
  const pinColor = PIN_COLOR_BY_STATUS[statusCode] || '#0b63c5';
  const distanceLabel = criterion?.displayDistance || '--- cm';
  const locationTitle = gps?.isFallback
    ? gps.locationLabel || 'Stand Expo IoT Kampus'
    : 'Sensor Banjir ESP32';

  // Inisialisasi & pembaruan instance MapLibre GL JS saat koordinat valid
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
      // Abaikan jika clipboard dibatasi
    }
  }

  const googleMapsUrl = hasCoords
    ? `https://maps.google.com/?q=${latNum},${lngNum}`
    : null;

  return (
    <section aria-labelledby="maplibre-heading" className="panel-card maplibre-card">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2 id="maplibre-heading" className="section-title expo-title-row">
          <MapRadarGlyph />
          <span>Peta Lokasi Sensor (MapLibre GL)</span>
        </h2>
        <span className="source-tag">
          {hasCoords
            ? gps.isFallback
              ? 'Pin Kampus (Indoor)'
              : 'GPS Satelit Asli'
            : 'Menunggu Kunci GPS'}
        </span>
      </div>

      {hasCoords ? (
        <div className="map-body">
          <div className="map-frame-wrap">
            {webglError ? (
              <div className="map-fallback-box">
                <p className="side-fact-value mono">
                  {latNum.toFixed(6)}, {lngNum.toFixed(6)}
                </p>
                <p className="side-fact-sub">
                  Pratinjau WebGL MapLibre tidak tersedia pada perangkat ini. Gunakan tautan Google Maps di bawah.
                </p>
              </div>
            ) : (
              <div ref={mapContainerRef} className="maplibre-canvas" />
            )}
          </div>

          <div className="map-meta-bar">
            <div>
              <p className="side-fact-value mono">
                {latNum.toFixed(6)}, {lngNum.toFixed(6)}
              </p>
              <p className="side-fact-sub">
                {gps.isFallback
                  ? `Sumber: Pin Demo Indoor (${gps.locationLabel || 'Kampus'})`
                  : `Sumber: TinyGPSPlus (${gps.satellites ?? 0} satelit)`}
              </p>
            </div>
            <div className="state-banner-actions">
              <a
                href={googleMapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-compact"
              >
                Buka Google Maps
              </a>
              <button
                type="button"
                className="btn btn-compact"
                onClick={() => handleCopyCoords(latNum, lngNum)}
              >
                {copiedCoords ? 'Tersalin' : 'Salin Koordinat'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="state-banner" style={{ padding: 14 }}>
          <p className="state-banner-title">Sinyal GPS Belum Terkunci</p>
          <p className="state-banner-desc">
            Saat demo di dalam gedung expo, sinyal satelit GPS sering tertahan atap beton. Aktifkan
            Pin Demo Kampus agar lokasi tampil di peta MapLibre dan alert Telegram.
          </p>
          <div className="state-banner-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleToggleFallback(true)}
              disabled={mapBusy}
            >
              Aktifkan Pin Demo Kampus (Indoor)
            </button>
          </div>
        </div>
      )}

      <div className="map-footer-controls">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={Boolean(config.gpsFallbackEnabled)}
            onChange={(e) => handleToggleFallback(e.target.checked)}
            disabled={mapBusy}
          />
          <span>Gunakan Pin Kampus saat GPS belum terkunci (Demo Indoor)</span>
        </label>

        <button
          type="button"
          className="btn btn-compact"
          aria-expanded={editorOpen}
          onClick={() => setEditorOpen((prev) => !prev)}
        >
          {editorOpen ? 'Tutup Edit Koordinat' : 'Ubah Titik Kampus'}
        </button>
      </div>

      {editorOpen && (
        <form onSubmit={handleSaveCampusPin} className="campus-pin-form" noValidate>
          <div className="form-grid form-grid--3col">
            <div className="field-group">
              <label htmlFor="campus-label-input" className="field-label">
                Label Stand / Kampus
              </label>
              <input
                id="campus-label-input"
                type="text"
                maxLength={60}
                className="text-input"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="campus-lat-input" className="field-label">
                Latitude
              </label>
              <input
                id="campus-lat-input"
                type="number"
                step="0.000001"
                className="text-input mono"
                value={latInput}
                onChange={(e) => setLatInput(e.target.value)}
              />
            </div>

            <div className="field-group">
              <label htmlFor="campus-lng-input" className="field-label">
                Longitude
              </label>
              <input
                id="campus-lng-input"
                type="number"
                step="0.000001"
                className="text-input mono"
                value={lngInput}
                onChange={(e) => setLngInput(e.target.value)}
              />
            </div>
          </div>

          {mapFeedback && (
            <p
              className={`feedback-banner ${
                mapFeedback.type === 'ok' ? 'feedback-banner--ok' : 'feedback-banner--err'
              }`}
              role={mapFeedback.type === 'err' ? 'alert' : 'status'}
            >
              {mapFeedback.text}
            </p>
          )}

          <div className="state-banner-actions">
            <button type="submit" className="btn btn-primary btn-compact" disabled={mapBusy}>
              {mapBusy ? 'Menyimpan...' : 'Simpan & Terapkan Pin Kampus'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
