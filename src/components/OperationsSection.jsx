import { useEffect, useState } from 'react';
import { GPS_STATES } from '../shared/criteria.js';
import { formatShortClock } from '../utils/formatters.js';

const PRESET_DISTANCES = [
  { label: '2.0 cm (KRITIS)', value: 2.0 },
  { label: '5.0 cm (BAHAYA)', value: 5.0 },
  { label: '8.5 cm (WASPADA)', value: 8.5 },
  { label: '15.0 cm (AMAN)', value: 15.0 },
  { label: '999 cm (Timeout)', value: 999 },
];

const DATASTREAM_ROWS = [
  { pin: 'V0', name: 'Jarak Sensor', type: 'Double (cm)', purpose: 'Menentukan status AMAN/WASPADA/BAHAYA/KRITIS' },
  { pin: 'V1', name: 'Status ESP32', type: 'String', purpose: 'Sinkron label status dari perangkat' },
  { pin: 'V2', name: 'Latitude GPS', type: 'Double', purpose: 'Koordinat lintang TinyGPSPlus' },
  { pin: 'V3', name: 'Longitude GPS', type: 'Double', purpose: 'Koordinat bujur TinyGPSPlus' },
  { pin: 'V4', name: 'Jumlah Satelit', type: 'Integer', purpose: 'Jumlah satelit terkunci (gps.satellites)' },
  { pin: 'V5', name: 'Kondisi GPS', type: 'String', purpose: 'VALID, CARI_SATELIT, atau CEK_KABEL' },
];

export function OperationsSection({
  state,
  onSimulate,
  onOpenSettings,
  onSwitchSource,
}) {
  const { config, simulatorState, logs } = state;
  const isSim = config.dataSource === 'simulator';

  const [manualDistance, setManualDistance] = useState(
    String(simulatorState?.distanceCm ?? 15)
  );
  const [simError, setSimError] = useState('');
  const [simPending, setSimPending] = useState(false);

  useEffect(() => {
    if (simulatorState?.distanceCm !== undefined) {
      setManualDistance(String(simulatorState.distanceCm));
    }
  }, [simulatorState?.distanceCm]);

  async function applySimulation(patch) {
    setSimError('');
    setSimPending(true);
    try {
      await onSimulate(patch);
    } catch (err) {
      setSimError(err?.message || 'Gagal menerapkan nilai simulasi.');
    } finally {
      setSimPending(false);
    }
  }

  function handleDistanceFormSubmit(e) {
    e.preventDefault();
    const num = Number(manualDistance);
    if (!Number.isFinite(num) || num < 0 || num > 999) {
      setSimError('Masukkan angka jarak antara 0 hingga 999 cm.');
      return;
    }
    applySimulation({ distanceCm: num });
  }

  return (
    <section
      aria-labelledby="operations-heading"
      className="operations-grid"
    >
      <div className="panel-card">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <h2 id="operations-heading" className="section-title">
            {isSim ? 'Panel Simulasi Uji Kriteria & Telegram' : 'Pemetaan Datastream Blynk Cloud'}
          </h2>
        </div>

        {isSim ? (
          <div className="simulator-controls">
            <p className="field-help">
              Gunakan slider atau tombol cepat di bawah untuk menguji perpindahan status main.ino.
              Jika jarak diatur ke 3.0 cm atau lebih rendah dan Bot Telegram aktif, pesan darurat langsung dikirim.
            </p>

            <div className="range-row">
              <label htmlFor="sim-slider" className="field-label">
                Geser Jarak Simulasi (0 sampai 25 cm):{' '}
                <span className="mono">
                  {Math.min(25, Number(simulatorState?.distanceCm ?? 15)).toFixed(1)} cm
                </span>
              </label>
              <input
                id="sim-slider"
                className="range-input"
                type="range"
                min="0"
                max="25"
                step="0.5"
                value={Math.min(25, Number(simulatorState?.distanceCm ?? 15))}
                onChange={(e) => applySimulation({ distanceCm: Number(e.target.value) })}
                disabled={simPending}
              />
            </div>

            <div className="preset-row" role="group" aria-label="Preset jarak uji">
              {PRESET_DISTANCES.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className="btn btn-compact"
                  onClick={() => applySimulation({ distanceCm: preset.value })}
                  disabled={simPending}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <form
              onSubmit={handleDistanceFormSubmit}
              className="form-grid form-grid--2col"
              noValidate
            >
              <div className="field-group">
                <label htmlFor="sim-exact-input" className="field-label">
                  Input Jarak Eksak (cm)
                </label>
                <input
                  id="sim-exact-input"
                  type="number"
                  step="0.1"
                  min="0"
                  max="999"
                  className="text-input mono"
                  value={manualDistance}
                  onChange={(e) => setManualDistance(e.target.value)}
                />
              </div>

              <div className="field-group">
                <label htmlFor="sim-gps-select" className="field-label">
                  Simulasi Status GPS
                </label>
                <select
                  id="sim-gps-select"
                  className="select-input"
                  value={simulatorState?.gpsState || GPS_STATES.VALID}
                  onChange={(e) => applySimulation({ gpsState: e.target.value })}
                  disabled={simPending}
                >
                  <option value={GPS_STATES.VALID}>Valid (Terkunci -6.2088, 106.8456)</option>
                  <option value={GPS_STATES.CARI_SATELIT}>Cari Satelit</option>
                  <option value={GPS_STATES.CEK_KABEL}>Cek Kabel GPS</option>
                </select>
              </div>

              <div className="state-banner-actions">
                <button type="submit" className="btn btn-primary" disabled={simPending}>
                  Terapkan Jarak Uji
                </button>
              </div>
            </form>

            {simError && (
              <p className="feedback-banner feedback-banner--err" role="alert">
                {simError}
              </p>
            )}
          </div>
        ) : (
          <div>
            <p className="field-help" style={{ marginBottom: 12 }}>
              Website membaca virtual pin berikut dari Blynk Cloud setiap{' '}
              <span className="mono">{(config.pollIntervalMs / 1000).toFixed(1)} detik</span>.
              Gunakan sketch <span className="mono">firmware/esp32_blynk/esp32_blynk.ino</span> pada ESP32 Anda.
            </p>

            <div className="datastream-table-wrap">
              <table className="datastream-table">
                <thead>
                  <tr>
                    <th scope="col">Pin</th>
                    <th scope="col">Parameter</th>
                    <th scope="col">Tipe</th>
                    <th scope="col">Fungsi</th>
                  </tr>
                </thead>
                <tbody>
                  {DATASTREAM_ROWS.map((row) => (
                    <tr key={row.pin}>
                      <td className="mono"><strong>{row.pin}</strong></td>
                      <td>{row.name}</td>
                      <td className="mono">{row.type}</td>
                      <td>{row.purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="state-banner-actions" style={{ marginTop: 14 }}>
              <button type="button" className="btn" onClick={onOpenSettings}>
                Ubah Token &amp; Interval
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => onSwitchSource('simulator')}
              >
                Uji di Mode Simulasi
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="panel-card">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <h2 className="section-title">Riwayat Status &amp; Notifikasi Telegram</h2>
        </div>

        {logs.length === 0 ? (
          <div className="state-banner" style={{ padding: 14 }}>
            <p className="state-banner-title">Belum ada catatan aktivitas.</p>
            <p className="state-banner-desc">
              Riwayat akan tercatat otomatis saat perangkat mengirim pembacaan pertama, berpindah
              kriteria status, atau mengirim notifikasi Telegram.
            </p>
          </div>
        ) : (
          <ul className="log-list" aria-live="polite">
            {logs.map((entry) => (
              <li key={entry.id} className="log-item">
                <div className="log-top">
                  <span className="mono">{formatShortClock(entry.timestamp)}</span>
                  <strong>{entry.level || entry.type}</strong>
                </div>
                <p className="log-msg">{entry.message}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
