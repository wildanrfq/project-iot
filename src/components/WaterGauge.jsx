import {
  formatRelativeSeconds,
  formatWibTime,
  isReadingStale,
} from '../utils/formatters.js';

function computeWaterLevelPercent(distanceCm) {
  if (!Number.isFinite(distanceCm) || distanceCm >= 999) return 10;
  if (distanceCm <= 0) return 95;
  if (distanceCm <= 5) return 80 + ((5 - distanceCm) / 5) * 15;
  if (distanceCm <= 9) return 55 + ((9 - distanceCm) / 4) * 25;
  if (distanceCm <= 12) return 35 + ((12 - distanceCm) / 3) * 20;
  const clamped = Math.min(25, distanceCm);
  return Math.max(10, 35 - ((clamped - 12) / 13) * 25);
}

export function WaterGauge({ state, nowMs }) {
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
  const waterPercent = computeWaterLevelPercent(criterion.distanceCm);
  const stale = isReadingStale(lastUpdatedAt, nowMs, config.pollIntervalMs);
  const statusCode = (criterion.code || 'AMAN').toLowerCase();

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
      className={`card-panel card-hero water-gauge-card water-gauge-card--${statusCode}`}
    >
      <div className="water-gauge-top">
        <div className={`status-pill status-pill--${criterion.code}`} role="status" aria-live="polite">
          <span className="status-pill-dot" aria-hidden="true" />
          <span className="status-pill-label">STATUS: {criterion.label}</span>
          <span className="status-pill-rule">({criterion.ruleText})</span>
        </div>

        <span className="source-tag mono">
          {hardwareConnected
            ? `Live Blynk (${config.blynkServer})`
            : `Blynk Cloud (${config.blynkServer})`}
        </span>
      </div>

      <div className="water-gauge-main">
        {/* Kolom Visual Tangki Air Vertikal */}
        <div className="water-tank-wrapper" aria-hidden="true">
          <div className="water-tank-frame">
            <div className="tank-sensor-head">
              <span className="sensor-eye" />
              <span className="sensor-eye" />
            </div>

            <div className="tank-reservoir">
              <div
                className="tank-water-body"
                style={{ height: `${waterPercent}%` }}
              >
                <div className="tank-wave-wrapper">
                  <svg
                    className="tank-wave-svg"
                    viewBox="0 0 240 28"
                    preserveAspectRatio="none"
                  >
                    <path
                      className="wave-path wave-path--back"
                      d="M0 14 Q 30 4, 60 14 T 120 14 T 180 14 T 240 14 V 28 H 0 Z"
                    />
                    <path
                      className="wave-path wave-path--front"
                      d="M0 14 Q 30 24, 60 14 T 120 14 T 180 14 T 240 14 V 28 H 0 Z"
                    />
                  </svg>
                </div>
                <div className="tank-water-fill" />
              </div>

              {/* Garis Ambang Batas pada Tangki */}
              <div className="tank-thresholds">
                <div className="tank-threshold tank-threshold--kritis" style={{ bottom: '85%' }}>
                  <span className="threshold-line" />
                  <span className="threshold-label mono">&lt;= 5 cm (KRITIS)</span>
                </div>
                <div className="tank-threshold tank-threshold--bahaya" style={{ bottom: '65%' }}>
                  <span className="threshold-line" />
                  <span className="threshold-label mono">9 cm (BAHAYA)</span>
                </div>
                <div className="tank-threshold tank-threshold--waspada" style={{ bottom: '45%' }}>
                  <span className="threshold-line" />
                  <span className="threshold-label mono">12 cm (WASPADA)</span>
                </div>
                <div className="tank-threshold tank-threshold--aman" style={{ bottom: '15%' }}>
                  <span className="threshold-line" />
                  <span className="threshold-label mono">&gt; 12 cm (AMAN)</span>
                </div>
              </div>
            </div>

            <div className="tank-base" />
          </div>
        </div>

        {/* Kolom Angka dan Keterangan Utama */}
        <div className="water-gauge-readout">
          <h2 id="telemetry-heading" className="eyebrow-label">
            Ketinggian Permukaan Air (Jarak ke Sensor)
          </h2>

          <div className="distance-display-row">
            <span className={`distance-number distance-number--${statusCode} mono`}>
              {criterion.displayDistance}
            </span>
          </div>

          <p className="distance-description">
            {criterion.isTimeout
              ? 'Sensor ultrasonik mengembalikan timeout (nilai >= 999 cm, terbaca "--- cm" di OLED dan berstatus AMAN).'
              : criterion.description}
          </p>

          <div className="supporting-stats-grid">
            <div className="stat-card">
              <span className="stat-label">Laju Perubahan Air</span>
              <strong className="stat-value mono">{rateText}</strong>
            </div>

            <div className="stat-card">
              <span className="stat-label">Hitung Mundur Prediksi Banjir</span>
              <strong className="stat-value">{etaText}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Riwayat Waktu */}
      <div className="water-gauge-footer">
        <div className="timestamp-item">
          <span className="timestamp-label">Terakhir Diperbarui</span>
          <span className="timestamp-val mono">
            {formatWibTime(lastUpdatedAt)} ({formatRelativeSeconds(lastUpdatedAt, nowMs)})
            {stale && <span className="stale-badge">DATA TERTUNDA</span>}
          </span>
        </div>

        <div className="timestamp-item">
          <span className="timestamp-label">Perubahan Status Terakhir</span>
          <span className="timestamp-val mono">
            {lastStatusChangeAt ? formatWibTime(lastStatusChangeAt) : 'Belum berpindah status'}
          </span>
        </div>
      </div>
    </section>
  );
}
