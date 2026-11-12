import { GPS_STATES } from '../shared/criteria.js';
import {
  formatRelativeSeconds,
  formatWibTime,
  isReadingStale,
} from '../utils/formatters.js';
import { GpsPinIcon, SoundWaveIcon, TelegramMark } from './Icons.jsx';

function computeMarkerPercent(distanceCm) {
  if (!Number.isFinite(distanceCm) || distanceCm >= 999) return 96;
  if (distanceCm <= 0) return 2;
  if (distanceCm <= 3) return (distanceCm / 3) * 15;
  if (distanceCm <= 7) return 15 + ((distanceCm - 3) / 4) * 20;
  if (distanceCm <= 10) return 35 + ((distanceCm - 7) / 3) * 15;
  return Math.min(98, 50 + ((distanceCm - 10) / 10) * 50);
}

export function TelemetryPanel({
  state,
  nowMs,
  onOpenSettings,
}) {
  const {
    reading,
    prediction,
    lastUpdatedAt,
    lastStatusChangeAt,
    hardwareConnected,
    telegramState,
    config,
  } = state;

  if (!reading) return null;

  const { criterion, gps, isSimulated } = reading;
  const markerPercent = computeMarkerPercent(criterion.distanceCm);
  const stale = !isSimulated && isReadingStale(lastUpdatedAt, nowMs, config.pollIntervalMs);

  const ledActiveGreen = criterion.code === 'AMAN';
  const ledActiveYellow = criterion.code === 'WASPADA';
  const ledActiveRed = criterion.code === 'BAHAYA' || criterion.code === 'KRITIS';

  let gpsPrimary = `Mencari satelit (${gps?.satellites ?? 0} satelit)`;
  let gpsSub = 'Menunggu kunci sinyal GPS pada UART2 (RX 16, TX 17).';
  let mapHref = null;

  if (gps?.isFallback && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)) {
    const latStr = gps.lat.toFixed(6);
    const lngStr = gps.lng.toFixed(6);
    gpsPrimary = `${latStr}, ${lngStr}`;
    gpsSub = `Pin Demo Kampus (Indoor): ${gps.locationLabel || 'Stand Expo'}`;
    mapHref = `https://maps.google.com/?q=${latStr},${lngStr}`;
  } else if (gps?.state === GPS_STATES.CEK_KABEL) {
    gpsPrimary = 'GPS: Cek kabel';
    gpsSub = 'Data serial GPS tidak terbaca (< 10 karakter).';
  } else if (
    gps?.state === GPS_STATES.VALID &&
    Number.isFinite(gps.lat) &&
    Number.isFinite(gps.lng)
  ) {
    const latStr = gps.lat.toFixed(6);
    const lngStr = gps.lng.toFixed(6);
    gpsPrimary = `${latStr}, ${lngStr}`;
    gpsSub = `${gps.satellites ?? 0} satelit terkunci`;
    mapHref = `https://maps.google.com/?q=${latStr},${lngStr}`;
  }

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

  let telegramSummary = 'Belum dikonfigurasi';
  let telegramSub = 'Buka Pengaturan untuk mengisi Bot Token dan Chat ID.';
  if (config.telegramConfigured) {
    if (telegramState.lastResult === 'sent') {
      telegramSummary = `Terkirim (${formatWibTime(telegramState.lastSentAt)})`;
      telegramSub =
        telegramState.lastAlertType === 'critical'
          ? `Peringatan KRITIS terkirim ke Chat ID ${config.telegramChatId}.`
          : `Pesan Telegram terakhir berhasil dikirim ke Chat ID ${config.telegramChatId}.`;
    } else if (telegramState.lastResult === 'error') {
      telegramSummary = 'Gagal mengirim pesan';
      telegramSub = telegramState.lastError || 'Periksa Bot Token dan Chat ID.';
    } else {
      telegramSummary = `Siaga (Chat ID ${config.telegramChatId})`;
      telegramSub = `Otomatis kirim notif saat jarak <= 3 cm (cooldown ${config.telegramCooldownSec} dtk).`;
    }
  }

  return (
    <section
      aria-labelledby="telemetry-heading"
      className={`telemetry-panel telemetry-panel--${criterion.code}`}
    >
      <div className="telemetry-primary">
        <div className="status-header-row">
          <div className={`status-pill status-pill--${criterion.code}`} role="status" aria-live="polite">
            <span>STATUS: {criterion.label}</span>
            <span>({criterion.ruleText})</span>
          </div>

          <span className="source-tag">
            {isSimulated
              ? 'SIMULASI UJI (Bukan Sensor Fisik)'
              : hardwareConnected
                ? `Blynk Live (${config.blynkServer})`
                : `Blynk Cloud (${config.blynkServer})`}
          </span>
        </div>

        <div className="distance-block">
          <h2 id="telemetry-heading" className="eyebrow-label">
            Jarak Permukaan Air ke Sensor Ultrasonik
          </h2>
          <p className="distance-readout mono">{criterion.displayDistance}</p>
          <p className="distance-note">
            {criterion.isTimeout
              ? 'Sensor ultrasonik mengembalikan timeout (nilai >= 999 cm, terbaca sebagai "--- cm" di OLED dan masuk kriteria AMAN).'
              : criterion.description}
          </p>
        </div>

        <div className="clearance-meter" aria-label="Skala jarak aman hingga kritis">
          <div className="clearance-header">
            <span>Skala Ambang main.ino (makin kecil = air makin tinggi)</span>
            <span className="mono">{criterion.displayDistance}</span>
          </div>
          <div className="clearance-track">
            <div className="zone-seg--kritis" title="KRITIS <= 3 cm" />
            <div className="zone-seg--bahaya" title="BAHAYA 3-7 cm" />
            <div className="zone-seg--waspada" title="WASPADA 7-10 cm" />
            <div className="zone-seg--aman" title="AMAN > 10 cm" />
          </div>
          <div className="clearance-marker-row" aria-hidden="true">
            <div
              className="clearance-marker"
              style={{ left: `${markerPercent}%` }}
            />
          </div>
          <div className="clearance-ticks mono">
            <span>0 cm (Kritis)</span>
            <span>3 cm</span>
            <span>7 cm</span>
            <span>10 cm</span>
            <span>20+ cm (Aman)</span>
          </div>
        </div>

        <div className="prediction-strip" data-trend={prediction?.trend || 'UNKNOWN'}>
          <div className="timestamp-group">
            <span className="timestamp-label">Laju Kenaikan Permukaan Air</span>
            <span className="timestamp-value mono">{rateText}</span>
          </div>
          <div className="timestamp-group">
            <span className="timestamp-label">Hitung Mundur Prediksi Banjir</span>
            <span className="timestamp-value">{etaText}</span>
          </div>
        </div>

        <div className="last-updated-box">
          <div className="timestamp-group">
            <span className="timestamp-label">Last Updated (Pembaruan Terakhir)</span>
            <span className="timestamp-value mono">
              {formatWibTime(lastUpdatedAt)} ({formatRelativeSeconds(lastUpdatedAt, nowMs)})
              {stale && <span className="stale-badge">DATA TERTUNDA</span>}
            </span>
          </div>

          <div className="timestamp-group">
            <span className="timestamp-label">Perubahan Kriteria Terakhir</span>
            <span className="timestamp-value mono">
              {lastStatusChangeAt ? formatWibTime(lastStatusChangeAt) : 'Belum berpindah status'}
            </span>
          </div>
        </div>
      </div>

      <aside className="telemetry-side" aria-label="Status hardware dan notifikasi">
        <div className="side-fact">
          <h3 className="side-fact-title">
            <SoundWaveIcon />
            <span>Indikator LED &amp; Buzzer (main.ino)</span>
          </h3>
          <div className="led-row">
            <span className="led-chip" data-active={ledActiveGreen} data-color="green">
              <span className="led-swatch" aria-hidden="true" />
              <span>Hijau {ledActiveGreen ? 'ON' : 'OFF'}</span>
            </span>
            <span className="led-chip" data-active={ledActiveYellow} data-color="yellow">
              <span className="led-swatch" aria-hidden="true" />
              <span>Kuning {ledActiveYellow ? 'ON' : 'OFF'}</span>
            </span>
            <span className="led-chip" data-active={ledActiveRed} data-color="red">
              <span className="led-swatch" aria-hidden="true" />
              <span>Merah {ledActiveRed ? 'ON' : 'OFF'}</span>
            </span>
          </div>
          <p className="side-fact-sub">Buzzer (GPIO 21): {criterion.buzzerBehavior}</p>
        </div>

        <div className="side-fact">
          <h3 className="side-fact-title">
            <GpsPinIcon />
            <span>Modul GPS (TinyGPSPlus)</span>
          </h3>
          <p className="side-fact-value mono">{gpsPrimary}</p>
          <p className="side-fact-sub">{gpsSub}</p>
          {mapHref && (
            <div style={{ marginTop: 4 }}>
              <a
                href={mapHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-compact"
              >
                Buka di Google Maps
              </a>
            </div>
          )}
        </div>

        <div className="side-fact">
          <h3 className="side-fact-title">
            <TelegramMark />
            <span>Notifikasi Bot Telegram</span>
          </h3>
          <p className="side-fact-value">{telegramSummary}</p>
          <p className="side-fact-sub">{telegramSub}</p>
          {!config.telegramConfigured && (
            <div style={{ marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-compact"
                onClick={onOpenSettings}
              >
                Atur Telegram Sekarang
              </button>
            </div>
          )}
        </div>
      </aside>
    </section>
  );
}
