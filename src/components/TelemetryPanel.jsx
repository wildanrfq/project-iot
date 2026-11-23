import {
  formatRelativeSeconds,
  formatWibTime,
  isReadingStale,
} from '../utils/formatters.js';

function computeMarkerPercent(distanceCm) {
  if (!Number.isFinite(distanceCm) || distanceCm >= 999) return 96;
  if (distanceCm <= 0) return 2;
  if (distanceCm <= 5) return (distanceCm / 5) * 15;
  if (distanceCm <= 9) return 15 + ((distanceCm - 5) / 4) * 20;
  if (distanceCm <= 12) return 35 + ((distanceCm - 9) / 3) * 15;
  return Math.min(98, 50 + ((distanceCm - 12) / 10) * 50);
}

export function TelemetryPanel({ state, nowMs }) {
  const {
    reading,
    prediction,
    lastUpdatedAt,
    lastStatusChangeAt,
    hardwareConnected,
    config,
  } = state;

  if (!reading) return null;

  const { criterion } = reading;
  const markerPercent = computeMarkerPercent(criterion.distanceCm);
  const stale = isReadingStale(lastUpdatedAt, nowMs, config.pollIntervalMs);

  let rateText = 'Menunggu sampel...';
  let etaText = prediction?.statusText || 'Belum cukup data beruntun untuk estimasi.';
  if (prediction && Number.isFinite(prediction.riseRateCmPerSec)) {
    const sign = prediction.riseRateCmPerSec > 0 ? '+' : '';
    rateText = `${sign}${prediction.riseRateCmPerSec.toFixed(2)} cm/dtk (${prediction.trend})`;
    if (prediction.etaToCriticalSec === 0) {
      etaText = 'Batas KRITIS sudah tercapai (0 detik)';
    } else if (Number.isFinite(prediction.etaToCriticalSec)) {
      etaText = `Estimasi KRITIS: ~${prediction.etaToCriticalSec} detik`;
    }
  }

  return (
    <section
      aria-labelledby="telemetry-heading"
      className={`telemetry-hero telemetry-hero--${criterion.code}`}
    >
      <div className="hero-top-bar">
        <div
          className={`status-pill status-pill--${criterion.code}`}
          role="status"
          aria-live="polite"
        >
          <span>STATUS: {criterion.label}</span>
          <span>({criterion.ruleText})</span>
        </div>

        <span className="source-tag">
          {hardwareConnected
            ? `Live Blynk (${config.blynkServer})`
            : `Blynk Cloud (${config.blynkServer})`}
        </span>
      </div>

      <div className="hero-center-readout">
        <h2 id="telemetry-heading" className="eyebrow-label">
          Ketinggian Permukaan Air (Jarak ke Sensor)
        </h2>
        <p className={`distance-readout distance-readout--${criterion.code} mono`}>
          {criterion.displayDistance}
        </p>
        <p className="distance-note">
          {criterion.isTimeout
            ? 'Sensor ultrasonik mengembalikan timeout (nilai >= 999 cm, terbaca "--- cm" di OLED dan berstatus AMAN).'
            : criterion.description}
        </p>
      </div>

      <div className="clearance-meter" aria-label="Skala jarak aman hingga kritis">
        <div className="clearance-header">
          <span>Skala Ambang Sensor (makin kecil = air makin tinggi)</span>
          <span className="mono">{criterion.displayDistance}</span>
        </div>
        <div className="clearance-track">
          <div className="zone-seg--kritis" title="KRITIS <= 5 cm" />
          <div className="zone-seg--bahaya" title="BAHAYA 5-9 cm" />
          <div className="zone-seg--waspada" title="WASPADA 9-12 cm" />
          <div className="zone-seg--aman" title="AMAN > 12 cm" />
        </div>
        <div className="clearance-marker-row" aria-hidden="true">
          <div className="clearance-marker" style={{ left: `${markerPercent}%` }} />
        </div>
        <div className="clearance-ticks mono">
          <span>0 cm (Kritis)</span>
          <span>5 cm</span>
          <span>9 cm</span>
          <span>12 cm</span>
          <span>20+ cm (Aman)</span>
        </div>
      </div>

      <div className="prediction-strip" data-trend={prediction?.trend || 'UNKNOWN'}>
        <div className="timestamp-group">
          <span className="timestamp-label">Laju Perubahan Air</span>
          <span className="timestamp-value mono">{rateText}</span>
        </div>
        <div className="timestamp-group">
          <span className="timestamp-label">Hitung Mundur Prediksi Banjir</span>
          <span className="timestamp-value">{etaText}</span>
        </div>
      </div>

      <div className="last-updated-box">
        <div className="timestamp-group">
          <span className="timestamp-label">Last Updated</span>
          <span className="timestamp-value mono">
            {formatWibTime(lastUpdatedAt)} ({formatRelativeSeconds(lastUpdatedAt, nowMs)})
            {stale && <span className="stale-badge">DATA TERTUNDA</span>}
          </span>
        </div>

        <div className="timestamp-group">
          <span className="timestamp-label">Perubahan Status Terakhir</span>
          <span className="timestamp-value mono">
            {lastStatusChangeAt ? formatWibTime(lastStatusChangeAt) : 'Belum berpindah status'}
          </span>
        </div>
      </div>
    </section>
  );
}
