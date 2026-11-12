import { AlarmBellGlyph, SoundWaveIcon } from './Icons.jsx';

export function AlarmControlBar({
  audioArmed,
  alarmEnabled,
  voiceEnabled,
  volumePercent,
  isCriticalLive,
  isPlaying,
  episodeSilenced,
  isTesting,
  onArmAudio,
  onToggleAlarmEnabled,
  onToggleVoiceEnabled,
  onVolumeChange,
  onSilenceEpisode,
  onResumeEpisode,
  onToggleTestSiren,
}) {
  let statusBadgeText = 'SIAGA OTOMATIS';
  let statusDescription =
    'Sirine Web Audio berkompresi siap berbunyi lantang otomatis begitu jarak sensor menyentuh <= 3.0 cm.';

  if (!alarmEnabled) {
    statusBadgeText = 'ALARM NONAKTIF';
    statusDescription = 'Alarm sirine di website sedang dimatikan sementara oleh operator.';
  } else if (!audioArmed && isCriticalLive) {
    statusBadgeText = 'KRITIS (MENUNGGU IZIN SUARA)';
    statusDescription =
      'Kondisi sudah KRITIS! Klik tombol aktifkan di samping agar browser mengizinkan sirine volume penuh berbunyi.';
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
      'Alarm untuk kondisi KRITIS saat ini disenyapkan. Sirine akan siaga kembali begitu air surut di atas 3.0 cm.';
  } else if (isPlaying) {
    statusBadgeText = `SIRINE KRITIS MENYALA (${volumePercent}%)`;
    statusDescription = voiceEnabled
      ? 'Alarm sirine volume maksimal aktif bersama pengumuman suara darurat!'
      : 'Alarm sirine volume maksimal sedang berbunyi!';
  }

  const barToneClass =
    isPlaying || (isCriticalLive && !audioArmed && alarmEnabled)
      ? 'alarm-bar--critical'
      : audioArmed && alarmEnabled
        ? 'alarm-bar--armed'
        : 'alarm-bar--standby';

  return (
    <section
      className={`alarm-bar ${barToneClass}`}
      aria-label="Kontrol Alarm Sirine Kritis"
      role={isCriticalLive ? 'alert' : 'region'}
    >
      <div className="alarm-bar-info">
        <div className="alarm-bar-head">
          <span className="alarm-title-group">
            <AlarmBellGlyph />
            <strong>Alarm Sirine Website</strong>
          </span>
          <span className="alarm-state-pill mono">{statusBadgeText}</span>
        </div>
        <p className="alarm-bar-desc">{statusDescription}</p>
      </div>

      <div className="alarm-bar-controls">
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
        ) : (
          <button
            type="button"
            className="btn"
            onClick={onToggleTestSiren}
            disabled={!alarmEnabled}
          >
            <SoundWaveIcon />
            <span>{isTesting ? 'Hentikan Tes' : 'Tes Sirine Keras'}</span>
          </button>
        )}

        <button
          type="button"
          className="btn btn-compact"
          aria-pressed={alarmEnabled}
          onClick={onToggleAlarmEnabled}
        >
          <span>{alarmEnabled ? 'Matikan Alarm' : 'Nyalakan Alarm'}</span>
        </button>

        <label className="alarm-volume-control" htmlFor="alarm-volume-range">
          <span className="alarm-control-label">
            Volume Sirine <strong className="mono">{volumePercent}%</strong>
          </span>
          <input
            id="alarm-volume-range"
            type="range"
            min="25"
            max="100"
            step="5"
            value={volumePercent}
            onChange={(e) => onVolumeChange(Number(e.target.value))}
            className="alarm-range-input"
          />
        </label>

        <label className="checkbox-label alarm-voice-toggle">
          <input
            type="checkbox"
            checked={voiceEnabled}
            onChange={(e) => onToggleVoiceEnabled(e.target.checked)}
          />
          <span>Suara Pengumuman BMKG</span>
        </label>
      </div>
    </section>
  );
}

