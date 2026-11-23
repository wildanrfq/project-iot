import { useState } from 'react';
import { AlarmBellGlyph, SoundWaveIcon } from './Icons.jsx';

export function AlarmPanel({
  audioArmed,
  alarmEnabled,
  alarmSensitivity = 'bahaya',
  volumePercent,
  isCriticalLive,
  isPlaying,
  episodeSilenced,
  isTesting,
  isSerialConnected,
  onArmAudio,
  onToggleAlarmEnabled,
  onToggleAlarmSensitivity,
  onToggleSerial,
  onVolumeChange,
  onSilenceEpisode,
  onResumeEpisode,
  onToggleTestSiren,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  const triggerZoneText =
    alarmSensitivity === 'bahaya' ? '<= 9.0 cm (BAHAYA & KRITIS)' : '<= 5.0 cm (KRITIS)';

  let statusBadgeText = 'SIAGA OTOMATIS';
  let statusDescription =
    `Sirine Web Audio berkompresi siap berbunyi lantang otomatis begitu jarak sensor menyentuh ${triggerZoneText}.`;

  if (!alarmEnabled) {
    statusBadgeText = 'ALARM NONAKTIF';
    statusDescription = 'Alarm sirine di website sedang dimatikan sementara oleh operator.';
  } else if (!audioArmed && isCriticalLive) {
    statusBadgeText = 'DARURAT (MENUNGGU IZIN SUARA)';
    statusDescription =
      'Kondisi darurat terdeteksi! Klik tombol aktifkan di samping agar browser mengizinkan sirine volume penuh berbunyi.';
  } else if (!audioArmed) {
    statusBadgeText = 'KLIK UNTUK SIAGAKAN SUARA';
    statusDescription =
      'Browser memblokir audio otomatis sebelum interaksi pertama. Klik tombol di samping sekali untuk membuka kunci alarm.';
  } else if (isTesting) {
    statusBadgeText = 'TES SIRINE AKTIF';
    statusDescription = `Menguji keluaran audio maksimal (${volumePercent}%) selama beberapa detik.`;
  } else if (isCriticalLive && episodeSilenced) {
    statusBadgeText = 'DISENYAPKAN SEMENTARA';
    statusDescription =
      `Alarm disenyapkan sementara. Sirine akan siaga kembali begitu air surut di atas ${alarmSensitivity === 'bahaya' ? '9.0 cm' : '5.0 cm'}.`;
  } else if (isPlaying) {
    statusBadgeText = `SIRINE KRITIS MENYALA (${volumePercent}%)`;
    statusDescription = 'Alarm sirine volume maksimal sedang berbunyi!';
  }

  const toneClass =
    isPlaying || (isCriticalLive && !audioArmed && alarmEnabled)
      ? 'alarm-panel--critical'
      : audioArmed && alarmEnabled
        ? 'alarm-panel--armed'
        : 'alarm-panel--standby';

  return (
    <section
      className={`card-panel alarm-panel ${toneClass}`}
      aria-label="Kontrol Alarm Sirine Kritis"
      role={isCriticalLive ? 'alert' : 'region'}
    >
      <div className="alarm-panel-header">
        <div className="alarm-title-block">
          <div className="alarm-icon-wrap" aria-hidden="true">
            <AlarmBellGlyph />
          </div>
          <div>
            <h2 className="card-title">Alarm Sirine Website</h2>
            <p className="card-subtitle">Kendali Audio Darurat &amp; Web Serial</p>
          </div>
        </div>

        <div className="alarm-status-pill-wrap">
          <span className="alarm-state-pill mono">{statusBadgeText}</span>
        </div>
      </div>

      <div className="alarm-panel-controls-row">
        {/* Tombol Utama Suara */}
        {!audioArmed ? (
          <button
            type="button"
            className="btn btn-primary"
            onClick={onArmAudio}
          >
            <SoundWaveIcon />
            <span>
              {isCriticalLive
                ? 'Aktifkan & Bunyikan Sirine Sekarang'
                : 'Aktifkan Izin Audio Alarm'}
            </span>
          </button>
        ) : isCriticalLive && alarmEnabled ? (
          episodeSilenced ? (
            <button type="button" className="btn btn-primary" onClick={onResumeEpisode}>
              <SoundWaveIcon />
              <span>Bunyikan Sirine Lagi</span>
            </button>
          ) : (
            <button type="button" className="btn btn-danger" onClick={onSilenceEpisode}>
              <span>Senyapkan Sirine</span>
            </button>
          )
        ) : null}

        {!(audioArmed && isCriticalLive && alarmEnabled) ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onToggleTestSiren}
            disabled={!alarmEnabled}
          >
            <SoundWaveIcon />
            <span>{isTesting ? 'Hentikan Tes' : 'Tes Sirine Keras'}</span>
          </button>
        ) : null}

        <button
          type="button"
          className="btn btn-secondary"
          aria-pressed={alarmEnabled}
          onClick={onToggleAlarmEnabled}
        >
          <span>{alarmEnabled ? 'Matikan Alarm' : 'Nyalakan Alarm'}</span>
        </button>

        <button
          type="button"
          className={`btn ${isSerialConnected ? 'btn-primary' : 'btn-secondary'}`}
          onClick={onToggleSerial}
          title="Koneksikan ESP32 langsung via kabel USB untuk update 0 ms saat presentasi"
        >
          <span>{isSerialConnected ? 'USB 0ms Aktif' : 'Mode USB (0 ms)'}</span>
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => onToggleAlarmSensitivity?.(alarmSensitivity === 'bahaya' ? 'kritis' : 'bahaya')}
          title="Ganti ambang jarak pemicu alarm web"
        >
          <span>
            {alarmSensitivity === 'bahaya' ? 'Pemicu: <= 9cm' : 'Pemicu: <= 5cm'}
          </span>
        </button>

        {/* Slider Volume */}
        <div className="alarm-volume-slider-group">
          <label className="alarm-volume-label" htmlFor="alarm-volume-range">
            Volume: <strong className="mono">{volumePercent}%</strong>
          </label>
          <input
            id="alarm-volume-range"
            type="range"
            min="25"
            max="100"
            step="5"
            value={volumePercent}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="range-slider"
            aria-label="Atur volume sirine website"
          />
        </div>
      </div>

      {/* Bagian Detail yang Bisa Dilipat */}
      <div className="alarm-collapsible-section">
        <button
          type="button"
          className="btn-link-toggle"
          onClick={() => setDetailsOpen((prev) => !prev)}
          aria-expanded={detailsOpen}
        >
          <span>{detailsOpen ? 'Sembunyikan Informasi Detail' : 'Tampilkan Informasi Detail & Aturan Sirine'}</span>
        </button>

        {detailsOpen && (
          <div className="alarm-details-content">
            <p className="alarm-desc-text">{statusDescription}</p>
            <div className="alarm-rule-chips mono">
              <span className="rule-chip">Ambang Pemicu: {triggerZoneText}</span>
              <span className="rule-chip">Audio Engine: Web Audio API (Siren Synthesizer)</span>
              <span className="rule-chip">Koneksi Serial: {isSerialConnected ? 'Terhubung (Baud 115200)' : 'Tidak Terhubung'}</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// Re-export untuk kompatibilitas jika masih ada import lama
export { AlarmPanel as AlarmControlBar };
