import { useEffect, useRef, useState } from 'react';
import { MapRadarGlyph, TrophyTargetGlyph } from './Icons.jsx';

const CHALLENGE_TARGET_MS = 3000;

export function ExpoSection({
  state,
  onSaveConfig,
  onSwitchSource,
  onChallengeWin,
}) {
  const { config, reading, connectionState } = state;
  const gps = reading?.gps;
  const criterion = reading?.criterion;

  // State form pin lokasi kampus indoor
  const [latInput, setLatInput] = useState(String(config.campusLat ?? -6.208763));
  const [lngInput, setLngInput] = useState(String(config.campusLng ?? 106.845599));
  const [labelInput, setLabelInput] = useState(
    config.campusLocationLabel || 'Stand Expo IoT Kampus'
  );
  const [mapBusy, setMapBusy] = useState(false);
  const [mapFeedback, setMapFeedback] = useState(null);
  const [copiedCoords, setCopiedCoords] = useState(false);

  useEffect(() => {
    setLatInput(String(config.campusLat ?? -6.208763));
    setLngInput(String(config.campusLng ?? 106.845599));
    setLabelInput(config.campusLocationLabel || 'Stand Expo IoT Kampus');
  }, [config.campusLat, config.campusLng, config.campusLocationLabel]);

  // State Mini-Game Challenge "Tahan 3 Detik di BAHAYA"
  const [phase, setPhase] = useState('idle'); // idle | armed | holding | won | failed
  const [holdMs, setHoldMs] = useState(0);
  const [challengeNote, setChallengeNote] = useState(
    'Tekan Mulai Tantangan lalu naikkan air ke zona BAHAYA (3.1 - 7.0 cm).'
  );
  const [score, setScore] = useState({ wins: 0, failures: 0, bestSec: 0 });
  const holdStartRef = useRef(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const isSourcePlayable =
    connectionState === 'simulator' || state.hardwareConnected === true;

  // Transisi state challenge berdasarkan pembacaan kriteria live
  useEffect(() => {
    if (!criterion) return;
    const currentPhase = phaseRef.current;
    if (currentPhase !== 'armed' && currentPhase !== 'holding') return;

    if (criterion.code === 'KRITIS') {
      holdStartRef.current = null;
      setHoldMs(0);
      setPhase('failed');
      setChallengeNote(
        `Banjir! Air menembus ${criterion.displayDistance} (KRITIS) sebelum 3.0 detik selesai.`
      );
      setScore((prev) => ({ ...prev, failures: prev.failures + 1 }));
      return;
    }

    if (criterion.code === 'BAHAYA') {
      if (currentPhase === 'armed') {
        holdStartRef.current = performance.now();
        setHoldMs(0);
        setPhase('holding');
        setChallengeNote(
          `Zona BAHAYA tercapai (${criterion.displayDistance}). Tahan stabil selama 3.0 detik!`
        );
      }
      return;
    }

    // Kembali ke AMAN / WASPADA saat sedang holding
    if (currentPhase === 'holding') {
      const elapsedSec = holdStartRef.current
        ? Number(((performance.now() - holdStartRef.current) / 1000).toFixed(1))
        : 0;
      holdStartRef.current = null;
      setHoldMs(0);
      setPhase('armed');
      setScore((prev) => ({ ...prev, bestSec: Math.max(prev.bestSec, elapsedSec) }));
      setChallengeNote(
        `Air turun ke ${criterion.code} (${criterion.displayDistance}). Naikkan lagi ke zona BAHAYA (3.1 - 7.0 cm)!`
      );
    }
  }, [criterion]);

  // Timer real-time saat berada dalam fase holding
  useEffect(() => {
    if (phase !== 'holding') return undefined;

    const timerId = setInterval(() => {
      if (!holdStartRef.current) return;
      const elapsed = performance.now() - holdStartRef.current;
      if (elapsed >= CHALLENGE_TARGET_MS) {
        holdStartRef.current = null;
        setHoldMs(CHALLENGE_TARGET_MS);
        setPhase('won');
        setChallengeNote(
          `Menang! Posisi bertahan penuh 3.0 detik di zona BAHAYA (${criterion?.displayDistance || '-'}) tanpa meledakkan sirine KRITIS!`
        );
        setScore((prev) => ({
          ...prev,
          wins: prev.wins + 1,
          bestSec: 3.0,
        }));
        if (onChallengeWin) onChallengeWin();
      } else {
        setHoldMs(elapsed);
      }
    }, 60);

    return () => clearInterval(timerId);
  }, [phase, criterion?.displayDistance, onChallengeWin]);

  function handleStartChallenge() {
    if (criterion?.code === 'KRITIS') {
      holdStartRef.current = null;
      setHoldMs(0);
      setPhase('armed');
      setChallengeNote(
        'Status masih KRITIS! Turunkan air dulu ke atas 3.0 cm lalu bidik zona BAHAYA (3.1 - 7.0 cm).'
      );
      return;
    }

    if (criterion?.code === 'BAHAYA') {
      holdStartRef.current = performance.now();
      setHoldMs(0);
      setPhase('holding');
      setChallengeNote(
        `Sudah di zona BAHAYA (${criterion.displayDistance})! Tahan stabil 3.0 detik!`
      );
      return;
    }

    holdStartRef.current = null;
    setHoldMs(0);
    setPhase('armed');
    setChallengeNote(
      'Tantangan aktif! Naikkan permukaan air atau slider ke 3.1 - 7.0 cm (BAHAYA).'
    );
  }

  function handleCancelChallenge() {
    holdStartRef.current = null;
    setHoldMs(0);
    setPhase('idle');
    setChallengeNote('Tantangan dibatalkan. Siap dimulai kapan saja.');
  }

  function handleResetScore() {
    setScore({ wins: 0, failures: 0, bestSec: 0 });
  }

  async function handleToggleFallback(checked) {
    setMapFeedback(null);
    setMapBusy(true);
    try {
      await onSaveConfig({ gpsFallbackEnabled: checked });
      setMapFeedback({
        type: 'ok',
        text: checked
          ? 'Pin Demo Kampus (Indoor) diaktifkan.'
          : 'Pin Demo Kampus dinonaktifkan (menggunakan sinyal GPS satelit).',
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
        text: 'Koordinat pin kampus tersimpan & langsung aktif untuk peta serta alert Telegram.',
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
      // Abaikan jika izin clipboard dibatasi
    }
  }

  const hasCoords = Boolean(
    gps && gps.state === 'VALID' && Number.isFinite(gps.lat) && Number.isFinite(gps.lng)
  );
  const latNum = hasCoords ? gps.lat : null;
  const lngNum = hasCoords ? gps.lng : null;

  const osmEmbedUrl = hasCoords
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${(lngNum - 0.0045).toFixed(6)}%2C${(
        latNum - 0.003
      ).toFixed(6)}%2C${(lngNum + 0.0045).toFixed(6)}%2C${(latNum + 0.003).toFixed(
        6
      )}&layer=mapnik&marker=${latNum.toFixed(6)}%2C${lngNum.toFixed(6)}`
    : null;

  const googleMapsUrl = hasCoords
    ? `https://maps.google.com/?q=${latNum.toFixed(6)},${lngNum.toFixed(6)}`
    : null;

  const holdSecDisplay = (holdMs / 1000).toFixed(1);
  const holdProgressPct = Math.min(100, Math.round((holdMs / CHALLENGE_TARGET_MS) * 100));

  return (
    <section aria-labelledby="expo-heading" className="expo-grid">
      {/* Kiri: Peta Interaktif + Pin Demo Kampus Indoor */}
      <div className="panel-card">
        <div className="section-head" style={{ marginBottom: 0 }}>
          <h2 id="expo-heading" className="section-title expo-title-row">
            <MapRadarGlyph />
            <span>Peta Lokasi Sensor &amp; Fallback Indoor</span>
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
              <iframe
                title="Peta OpenStreetMap lokasi sensor banjir ESP32"
                src={osmEmbedUrl}
                className="map-iframe"
                loading="lazy"
              />
            </div>

            <div className="map-meta-bar">
              <div>
                <p className="side-fact-value mono">
                  {latNum.toFixed(6)}, {lngNum.toFixed(6)}
                </p>
                <p className="side-fact-sub">
                  {gps.isFallback
                    ? `Sumber: Fallback Indoor (${gps.locationLabel || 'Kampus'})`
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
              Saat demo di dalam gedung expo, modul GPS NEO-6M sering tertahan atap beton. Aktifkan
              Pin Demo Kampus agar peta dashboard dan tombol lokasi Telegram tetap aktif.
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

        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={Boolean(config.gpsFallbackEnabled)}
            onChange={(e) => handleToggleFallback(e.target.checked)}
            disabled={mapBusy}
          />
          <span>Gunakan Pin Kampus saat GPS satelit belum terkunci (Demo Indoor)</span>
        </label>

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
            <button type="submit" className="btn btn-compact" disabled={mapBusy}>
              {mapBusy ? 'Menyimpan...' : 'Simpan & Terapkan Pin Kampus'}
            </button>
          </div>
        </form>
      </div>

      {/* Kanan: Mini-Game Challenge "Tahan 3 Detik di BAHAYA" */}
      <div className={`panel-card challenge-card challenge-card--${phase}`}>
        <div className="section-head" style={{ marginBottom: 0 }}>
          <h2 className="section-title expo-title-row">
            <TrophyTargetGlyph />
            <span>Tantangan Expo: Tahan 3 Detik di BAHAYA</span>
          </h2>
          <span className="source-tag mono">
            {criterion ? `${criterion.code} (${criterion.displayDistance})` : 'Siaga'}
          </span>
        </div>

        <p className="field-help">
          Tantang pengunjung untuk menaikkan air tepat ke zona <strong>BAHAYA (3.1 - 7.0 cm)</strong>{' '}
          lalu menahannya stabil selama <strong>3.0 detik</strong> tanpa menyentuh{' '}
          <strong>KRITIS (&lt;= 3.0 cm)</strong> yang meledakkan sirine!
        </p>

        {!isSourcePlayable && (
          <div className="state-banner state-banner--warning" style={{ padding: 12 }}>
            <p className="state-banner-desc">
              ESP32 sedang offline. Hubungkan perangkat atau pindah ke Simulasi Uji untuk bermain.
            </p>
            <div className="state-banner-actions">
              <button
                type="button"
                className="btn btn-compact"
                onClick={() => onSwitchSource('simulator')}
              >
                Pindah ke Simulasi Uji
              </button>
            </div>
          </div>
        )}

        <div className="challenge-meter-box">
          <div className="challenge-meter-head">
            <span className="timestamp-label">Progress Tahan Zona BAHAYA</span>
            <span className="mono">
              <strong>{holdSecDisplay} dtk</strong> / 3.0 dtk
            </span>
          </div>
          <div
            className="challenge-progress-track"
            role="progressbar"
            aria-valuenow={holdProgressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress tantangan 3 detik zona BAHAYA"
          >
            <div
              className="challenge-progress-fill"
              style={{ width: `${holdProgressPct}%` }}
            />
          </div>
          <p className="challenge-status-text" role="status" aria-live="polite">
            {challengeNote}
          </p>
        </div>

        <div className="challenge-score-row">
          <div className="score-tile">
            <span className="timestamp-label">Menang</span>
            <strong className="score-value mono">{score.wins}</strong>
          </div>
          <div className="score-tile">
            <span className="timestamp-label">Gagal Banjir</span>
            <strong className="score-value mono">{score.failures}</strong>
          </div>
          <div className="score-tile">
            <span className="timestamp-label">Tahan Terlama</span>
            <strong className="score-value mono">{score.bestSec.toFixed(1)} dtk</strong>
          </div>
        </div>

        <div className="state-banner-actions">
          {phase === 'armed' || phase === 'holding' ? (
            <button type="button" className="btn" onClick={handleCancelChallenge}>
              Batalkan Tantangan
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={handleStartChallenge}>
              {phase === 'idle' ? 'Mulai Tantangan' : 'Main Lagi'}
            </button>
          )}
          <button type="button" className="btn btn-compact" onClick={handleResetScore}>
            Reset Skor Sesi
          </button>
        </div>
      </div>
    </section>
  );
}

