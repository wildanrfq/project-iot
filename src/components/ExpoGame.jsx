import { useCallback, useEffect, useRef, useState } from 'react';
import { TrophyTargetGlyph } from './Icons.jsx';

const CHALLENGE_TARGET_MS = 3000;
const ANGKATAN_OPTIONS = ['23', '24', '25', '26'];

export function ExpoGame({ state, onChallengeWin }) {
  const { reading, hardwareConnected } = state;
  const criterion = reading?.criterion;

  const [playerName, setPlayerName] = useState('');
  const [angkatan, setAngkatan] = useState('');
  const [formError, setFormError] = useState(null);

  const [phase, setPhase] = useState('idle'); // idle | armed | holding | won | failed
  const [holdMs, setHoldMs] = useState(0);
  const [challengeNote, setChallengeNote] = useState(
    'Isi nama dan pilih angkatan, tekan Mulai Tantangan, lalu tahan air di zona BAHAYA (5.1 - 9.0 cm) selama 3.0 detik.'
  );
  const [score, setScore] = useState({ wins: 0, failures: 0, bestSec: 0 });
  const [lastResult, setLastResult] = useState(null);

  const [leaderboard, setLeaderboard] = useState({
    entries: [],
    stats: ANGKATAN_OPTIONS.map((ang) => ({
      angkatan: ang,
      plays: 0,
      wins: 0,
      bestHoldSec: 0,
    })),
    totalEntries: 0,
  });
  const [leaderboardBusy, setLeaderboardBusy] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState(null);

  const nameInputRef = useRef(null);
  const holdStartRef = useRef(null);
  const roundPeakHoldMsRef = useRef(0);
  const activePlayerRef = useRef({ name: '', angkatan: '' });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const isSourcePlayable = hardwareConnected === true;

  const loadLeaderboard = useCallback(async () => {
    try {
      const res = await fetch('/api/leaderboard', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.entries)) {
        setLeaderboard(data);
        setLeaderboardError(null);
      }
    } catch {
      // Abaikan error polling awal bila server belum siap
    }
  }, []);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  const submitResultToLeaderboard = useCallback(
    async ({ name, angkatan: batch, outcome, holdSec, finalDistanceCm }) => {
      setLastResult({
        name,
        angkatan: batch,
        outcome,
        holdSec,
        finalDistanceCm,
        rank: null,
        totalEntries: null,
        entryId: null,
        saving: true,
      });
      setLeaderboardError(null);

      try {
        const res = await fetch('/api/leaderboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            angkatan: batch,
            outcome,
            holdSec,
            finalDistanceCm,
          }),
        });
        const payload = await res.json();
        if (!res.ok) {
          throw new Error(payload?.error || 'Gagal menyimpan hasil ke leaderboard.');
        }
        setLeaderboard({
          entries: payload.entries || [],
          stats: payload.stats || [],
          totalEntries: payload.totalEntries || 0,
        });
        setLastResult({
          name,
          angkatan: batch,
          outcome,
          holdSec,
          finalDistanceCm,
          rank: payload.rank ?? null,
          totalEntries: payload.totalEntries ?? null,
          entryId: payload.entry?.id ?? null,
          saving: false,
        });
      } catch (err) {
        setLeaderboardError(err?.message || 'Gagal mencatat skor ke leaderboard.');
        setLastResult((prev) => (prev ? { ...prev, saving: false } : prev));
      }
    },
    []
  );

  // Transisi state challenge berdasarkan pembacaan kriteria live
  useEffect(() => {
    if (!criterion) return;
    const currentPhase = phaseRef.current;
    if (currentPhase !== 'armed' && currentPhase !== 'holding') return;

    if (criterion.code === 'KRITIS') {
      const currentElapsed =
        currentPhase === 'holding' && holdStartRef.current
          ? Math.min(CHALLENGE_TARGET_MS, performance.now() - holdStartRef.current)
          : 0;
      const peakMs = Math.max(roundPeakHoldMsRef.current, currentElapsed);
      const holdSec = Number((peakMs / 1000).toFixed(1));

      holdStartRef.current = null;
      roundPeakHoldMsRef.current = peakMs;
      setHoldMs(0);
      setPhase('failed');
      setChallengeNote(
        `Banjir! Air menembus ${criterion.displayDistance} (KRITIS) dengan waktu tahan ${holdSec.toFixed(1)} dtk.`
      );
      setScore((prev) => ({
        ...prev,
        failures: prev.failures + 1,
        bestSec: Math.max(prev.bestSec, holdSec),
      }));

      const player = activePlayerRef.current;
      submitResultToLeaderboard({
        name: player.name,
        angkatan: player.angkatan,
        outcome: 'failed',
        holdSec,
        finalDistanceCm: criterion.distanceCm ?? null,
      });
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
      const elapsedMs = holdStartRef.current
        ? Math.min(CHALLENGE_TARGET_MS, performance.now() - holdStartRef.current)
        : 0;
      roundPeakHoldMsRef.current = Math.max(roundPeakHoldMsRef.current, elapsedMs);
      const elapsedSec = Number((roundPeakHoldMsRef.current / 1000).toFixed(1));
      holdStartRef.current = null;
      setHoldMs(0);
      setPhase('armed');
      setScore((prev) => ({ ...prev, bestSec: Math.max(prev.bestSec, elapsedSec) }));
      setChallengeNote(
        `Air turun ke ${criterion.code} (${criterion.displayDistance}). Naikkan lagi ke zona BAHAYA (5.1 - 9.0 cm)!`
      );
    }
  }, [criterion, submitResultToLeaderboard]);

  // Timer real-time saat fase holding
  useEffect(() => {
    if (phase !== 'holding') return undefined;

    const timerId = setInterval(() => {
      if (!holdStartRef.current) return;
      const elapsed = performance.now() - holdStartRef.current;
      if (elapsed >= CHALLENGE_TARGET_MS) {
        holdStartRef.current = null;
        roundPeakHoldMsRef.current = CHALLENGE_TARGET_MS;
        setHoldMs(CHALLENGE_TARGET_MS);
        setPhase('won');
        setChallengeNote(
          `Menang! Bertahan penuh 3.0 detik di zona BAHAYA (${criterion?.displayDistance || '-'}) tanpa menyentuh KRITIS!`
        );
        setScore((prev) => ({
          ...prev,
          wins: prev.wins + 1,
          bestSec: 3.0,
        }));
        if (onChallengeWin) onChallengeWin();

        const player = activePlayerRef.current;
        submitResultToLeaderboard({
          name: player.name,
          angkatan: player.angkatan,
          outcome: 'won',
          holdSec: 3.0,
          finalDistanceCm: criterion?.distanceCm ?? null,
        });
      } else {
        setHoldMs(elapsed);
      }
    }, 60);

    return () => clearInterval(timerId);
  }, [phase, criterion?.displayDistance, criterion?.distanceCm, onChallengeWin, submitResultToLeaderboard]);

  function handleStartChallenge() {
    const cleanName = playerName.trim().replace(/\s+/g, ' ');
    if (!cleanName) {
      setFormError('Masukkan nama pemain terlebih dahulu sebelum memulai tantangan.');
      nameInputRef.current?.focus();
      return;
    }
    if (!ANGKATAN_OPTIONS.includes(angkatan)) {
      setFormError('Pilih angkatan (23, 24, 25, atau 26) terlebih dahulu.');
      return;
    }

    setFormError(null);
    setLastResult(null);
    activePlayerRef.current = { name: cleanName.slice(0, 32), angkatan };
    roundPeakHoldMsRef.current = 0;

    if (criterion?.code === 'KRITIS') {
      holdStartRef.current = null;
      setHoldMs(0);
      setPhase('armed');
      setChallengeNote(
        'Status masih KRITIS! Turunkan air dulu ke atas 5.0 cm lalu bidik zona BAHAYA (5.1 - 9.0 cm).'
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
      `Tantangan aktif untuk ${cleanName} (Angkatan ${angkatan})! Naikkan air ke 5.1 - 9.0 cm (BAHAYA).`
    );
  }

  function handleCancelChallenge() {
    holdStartRef.current = null;
    roundPeakHoldMsRef.current = 0;
    setHoldMs(0);
    setPhase('idle');
    setChallengeNote('Tantangan dibatalkan. Siap dimulai kapan saja.');
  }

  function handleResetScore() {
    setScore({ wins: 0, failures: 0, bestSec: 0 });
    setLastResult(null);
  }

  async function handleResetLeaderboard() {
    setLeaderboardBusy(true);
    setLeaderboardError(null);
    try {
      const res = await fetch('/api/leaderboard', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Gagal mengosongkan leaderboard.');
      }
      setLeaderboard(data);
      setLastResult(null);
    } catch (err) {
      setLeaderboardError(err?.message || 'Gagal mengosongkan leaderboard.');
    } finally {
      setLeaderboardBusy(false);
    }
  }

  const isRunning = phase === 'armed' || phase === 'holding';
  const holdSecDisplay = (holdMs / 1000).toFixed(1);
  const holdProgressPct = Math.min(100, Math.round((holdMs / CHALLENGE_TARGET_MS) * 100));

  return (
    <section
      aria-labelledby="challenge-heading"
      className={`card-panel expo-game-card expo-game-card--${phase}`}
    >
      <div className="card-header-row">
        <div className="expo-title-group">
          <div className="expo-icon-wrap" aria-hidden="true">
            <TrophyTargetGlyph />
          </div>
          <div>
            <h2 id="challenge-heading" className="card-title">
              Mini-Game Expo: Tahan 3 Detik di Zona BAHAYA
            </h2>
            <p className="card-subtitle">
              Tantang pengunjung untuk menahan air di zona BAHAYA (5.1 - 9.0 cm) stabil selama 3.0 detik.
            </p>
          </div>
        </div>
        <span className="source-tag mono">
          {criterion ? `${criterion.code} (${criterion.displayDistance})` : 'Siaga'}
        </span>
      </div>

      {!isSourcePlayable && (
        <div className="state-banner state-banner--warning" style={{ padding: '10px 14px', margin: '12px 0' }}>
          <p className="state-banner-desc">
            ESP32 sedang offline. Hubungkan perangkat ESP32 ke WiFi dan Blynk untuk bermain secara langsung.
          </p>
        </div>
      )}

      {/* Kontrol Input Pemain & Angkatan */}
      <div className="expo-controls-grid">
        <div className="form-group">
          <label htmlFor="player-name-input" className="form-label">
            Nama Pemain
          </label>
          <input
            ref={nameInputRef}
            id="player-name-input"
            type="text"
            maxLength={32}
            className="text-input"
            placeholder="Ketik nama pemain..."
            value={playerName}
            disabled={isRunning}
            onChange={(e) => {
              setPlayerName(e.target.value);
              if (formError) setFormError(null);
            }}
          />
        </div>

        <div className="form-group">
          <span id="angkatan-group-label" className="form-label">
            Pilih Angkatan
          </span>
          <div
            className="segmented-control"
            role="group"
            aria-labelledby="angkatan-group-label"
          >
            {ANGKATAN_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                className={`segmented-btn ${angkatan === opt ? 'segmented-btn--active' : ''}`}
                aria-pressed={angkatan === opt}
                disabled={isRunning}
                onClick={() => {
                  setAngkatan(opt);
                  if (formError) setFormError(null);
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        <div className="expo-action-buttons">
          {!isRunning ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStartChallenge}
            >
              Mulai Tantangan
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleCancelChallenge}
            >
              Batalkan Tantangan
            </button>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleResetScore}
            title="Reset skor sesi ini"
          >
            Reset Skor
          </button>
        </div>
      </div>

      {formError && (
        <div className="feedback-banner feedback-banner--err" role="alert">
          {formError}
        </div>
      )}

      {/* Progress Bar Tahan 3 Detik */}
      <div className="challenge-progress-box">
        <div className="progress-header-row">
          <span className="progress-title">Progress Tahan Zona BAHAYA</span>
          <span className="progress-value mono">
            <strong>{holdSecDisplay} dtk</strong> / 3.0 dtk ({holdProgressPct}%)
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
            className={`challenge-progress-fill challenge-progress-fill--${phase}`}
            style={{ width: `${holdProgressPct}%` }}
          />
        </div>

        <p className="challenge-status-text" role="status" aria-live="polite">
          {challengeNote}
        </p>
      </div>

      {/* Hasil Terakhir */}
      {lastResult && (
        <div
          className={`challenge-result-card ${
            lastResult.outcome === 'won'
              ? 'challenge-result-card--won'
              : 'challenge-result-card--failed'
          }`}
          role="status"
          aria-live="polite"
        >
          <div className="challenge-result-head">
            <div>
              <span className="result-outcome-badge mono">
                {lastResult.outcome === 'won' ? 'BERHASIL MENANG' : 'GAGAL (BANJIR KRITIS)'}
              </span>
              <h3 className="result-player-title">
                {lastResult.name}{' '}
                <span className="mono result-angkatan-chip">Angkatan {lastResult.angkatan}</span>
              </h3>
            </div>
            <span className="result-rank-pill mono">
              {lastResult.saving
                ? 'Menyimpan...'
                : lastResult.rank
                  ? `Peringkat #${lastResult.rank} dari ${lastResult.totalEntries}`
                  : 'Tercatat'}
            </span>
          </div>

          <div className="challenge-result-metrics">
            <div className="result-metric">
              <span className="timestamp-label">Waktu Bertahan</span>
              <strong className="mono">{lastResult.holdSec.toFixed(1)} dtk</strong>
            </div>
            <div className="result-metric">
              <span className="timestamp-label">Jarak Sensor Akhir</span>
              <strong className="mono">
                {Number.isFinite(lastResult.finalDistanceCm)
                  ? `${lastResult.finalDistanceCm.toFixed(1)} cm`
                  : '-'}
              </strong>
            </div>
          </div>
        </div>
      )}

      {/* Ringkasan Skor Angkatan */}
      <div className="batch-stats-row">
        {leaderboard.stats.map((st) => (
          <div key={st.angkatan} className="batch-stat-card">
            <span className="batch-name mono">Angkatan {st.angkatan}</span>
            <div className="batch-metrics">
              <span>Menang: <strong>{st.wins}</strong> / {st.plays}</span>
              <span>Terbaik: <strong className="mono">{st.bestHoldSec.toFixed(1)}s</strong></span>
            </div>
          </div>
        ))}
      </div>

      {/* Tabel Leaderboard */}
      <div className="leaderboard-section">
        <div className="card-header-row" style={{ marginTop: '16px' }}>
          <div>
            <h3 className="card-subtitle">Peringkat Pengunjung</h3>
            <h3 className="card-title" style={{ fontSize: '1rem' }}>
              Leaderboard Stand Expo ({leaderboard.totalEntries} Total Entri)
            </h3>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleResetLeaderboard}
            disabled={leaderboardBusy}
          >
            {leaderboardBusy ? 'Mengosongkan...' : 'Kosongkan Leaderboard'}
          </button>
        </div>

        {leaderboardError && (
          <div className="feedback-banner feedback-banner--err" role="alert">
            {leaderboardError}
          </div>
        )}

        <div className="leaderboard-table-wrap">
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th scope="col" className="mono">Rank</th>
                <th scope="col">Nama Pemain</th>
                <th scope="col">Angkatan</th>
                <th scope="col" className="mono">Tahan</th>
                <th scope="col">Hasil</th>
                <th scope="col">Waktu</th>
              </tr>
            </thead>
            <tbody>
              {leaderboard.entries.length === 0 ? (
                <tr>
                  <td colSpan={6} className="table-empty-cell">
                    Belum ada data skor. Mulai tantangan pertama untuk mengisi papan peringkat.
                  </td>
                </tr>
              ) : (
                leaderboard.entries.map((entry, idx) => (
                  <tr
                    key={entry.id || idx}
                    className={entry.id === lastResult?.entryId ? 'table-row--highlight' : ''}
                  >
                    <td className="mono rank-cell">#{idx + 1}</td>
                    <td className="name-cell">
                      <strong>{entry.name}</strong>
                    </td>
                    <td className="mono">Angk. {entry.angkatan}</td>
                    <td className="mono bold">{entry.holdSec.toFixed(1)}s</td>
                    <td>
                      <span
                        className={`table-outcome-badge table-outcome-badge--${entry.outcome}`}
                      >
                        {entry.outcome === 'won' ? 'MENANG' : 'GAGAL'}
                      </span>
                    </td>
                    <td className="mono date-cell">
                      {new Date(entry.createdAt).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

// Re-export untuk kompatibilitas jika masih ada import lama
export { ExpoGame as DangerChallengeCard };
