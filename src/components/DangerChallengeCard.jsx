import { useCallback, useEffect, useRef, useState } from 'react';
import { TrophyTargetGlyph } from './Icons.jsx';

const CHALLENGE_TARGET_MS = 3000;
const ANGKATAN_OPTIONS = ['23', '24', '25', '26'];

export function DangerChallengeCard({
  state,
  onChallengeWin,
}) {
  const { reading, hardwareConnected } = state;
  const criterion = reading?.criterion;

  const [playerName, setPlayerName] = useState('');
  const [angkatan, setAngkatan] = useState('');
  const [formError, setFormError] = useState(null);

  const [phase, setPhase] = useState('idle'); // idle | armed | holding | won | failed
  const [holdMs, setHoldMs] = useState(0);
  const [challengeNote, setChallengeNote] = useState(
    'Isi nama & pilih angkatan, tekan Mulai Tantangan, lalu tahan air di zona BAHAYA (3.1 - 7.0 cm) selama 3.0 detik.'
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
      // Abaikan error polling awal bila backend belum siap
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
        `Air turun ke ${criterion.code} (${criterion.displayDistance}). Naikkan lagi ke zona BAHAYA (3.1 - 7.0 cm)!`
      );
    }
  }, [criterion, submitResultToLeaderboard]);

  // Timer real-time saat berada dalam fase holding
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
          `Menang! Bertahan penuh 3.0 detik di zona BAHAYA (${criterion?.displayDistance || '-'}) tanpa meledakkan sirine KRITIS!`
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
      `Tantangan aktif untuk ${cleanName} (Angk. ${angkatan})! Naikkan air ke 3.1 - 7.0 cm (BAHAYA).`
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
      className={`panel-card challenge-card challenge-card--${phase}`}
    >
      <div className="section-head" style={{ marginBottom: 0 }}>
        <h2 id="challenge-heading" className="section-title expo-title-row">
          <TrophyTargetGlyph />
          <span>Mini-Game Expo: Tahan 3 Detik di Zona BAHAYA</span>
        </h2>
        <span className="source-tag mono">
          {criterion ? `${criterion.code} (${criterion.displayDistance})` : 'Siaga'}
        </span>
      </div>

      <p className="field-help">
        Tantang pengunjung untuk menaikkan air tepat ke zona <strong>BAHAYA (3.1 - 7.0 cm)</strong>{' '}
        lalu menahannya stabil selama <strong>3.0 detik</strong> tanpa menyentuh{' '}
        <strong>KRITIS (&lt;= 3.0 cm)</strong>!
      </p>

      {!isSourcePlayable && (
        <div className="state-banner state-banner--warning" style={{ padding: 12 }}>
          <p className="state-banner-desc">
            ESP32 sedang offline. Hubungkan perangkat ESP32 ke WiFi dan Blynk untuk bermain tantangan langsung.
          </p>
        </div>
      )}

      <div className="player-identity-grid">
        <div className="field-group">
          <label htmlFor="player-name-input" className="field-label">
            Nama Pemain
          </label>
          <input
            ref={nameInputRef}
            id="player-name-input"
            type="text"
            maxLength={32}
            className="text-input"
            placeholder="Masukkan nama Anda..."
            value={playerName}
            disabled={isRunning}
            onChange={(e) => {
              setPlayerName(e.target.value);
              if (formError) setFormError(null);
            }}
          />
        </div>

        <div className="field-group">
          <span id="angkatan-group-label" className="field-label">
            Angkatan
          </span>
          <div
            className="segmented-group angkatan-group"
            role="group"
            aria-labelledby="angkatan-group-label"
          >
            {ANGKATAN_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                className="segmented-btn"
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
      </div>

      {formError && (
        <div className="feedback-banner feedback-banner--err" role="alert">
          {formError}
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
                {lastResult.finalDistanceCm !== null ? `${lastResult.finalDistanceCm.toFixed(1)} cm` : '-'}
              </strong>
            </div>
            <div className="result-metric">
              <span className="timestamp-label">Status Akhir</span>
              <strong className="mono">
                {lastResult.outcome === 'won' ? 'Lulus 3.0 dtk' : 'Tersentuh KRITIS'}
              </strong>
            </div>
          </div>
        </div>
      )}

      <div className="challenge-score-row">
        <div className="score-tile">
          <span className="timestamp-label">Menang Sesi</span>
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
        {isRunning ? (
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

      <div className="leaderboard-section">
        <div className="section-head">
          <h3 className="leaderboard-heading">
            Leaderboard Expo ({leaderboard.totalEntries} Catatan)
          </h3>
          <button
            type="button"
            className="btn btn-compact"
            disabled={leaderboardBusy || leaderboard.entries.length === 0}
            onClick={handleResetLeaderboard}
          >
            {leaderboardBusy ? 'Mereset...' : 'Reset Leaderboard'}
          </button>
        </div>

        <div className="angkatan-summary-grid" aria-label="Rekap pemenang per angkatan">
          {leaderboard.stats.map((item) => (
            <div
              key={item.angkatan}
              className="angkatan-stat-tile"
              data-angkatan={item.angkatan}
            >
              <span className="timestamp-label">Angkatan {item.angkatan}</span>
              <strong className="mono">
                {item.wins} menang / {item.plays} main
              </strong>
            </div>
          ))}
        </div>

        {leaderboardError && (
          <div className="feedback-banner feedback-banner--err" role="alert">
            {leaderboardError}
          </div>
        )}

        {leaderboard.entries.length === 0 ? (
          <p className="field-help leaderboard-empty">
            Belum ada skor tercatat. Isi nama dan angkatan Anda lalu mainkan tantangan ini!
          </p>
        ) : (
          <ol className="leaderboard-list" aria-label="Daftar peringkat pemain">
            {leaderboard.entries.slice(0, 15).map((entry, idx) => {
              const isMine = lastResult?.entryId && lastResult.entryId === entry.id;
              return (
                <li
                  key={entry.id}
                  className={`leaderboard-row ${isMine ? 'leaderboard-row--highlight' : ''}`}
                >
                  <span
                    className={`lb-rank mono ${
                      idx === 0
                        ? 'lb-rank--top1'
                        : idx === 1
                          ? 'lb-rank--top2'
                          : idx === 2
                            ? 'lb-rank--top3'
                            : ''
                    }`}
                  >
                    #{idx + 1}
                  </span>
                  <div className="lb-player-meta">
                    <span className="lb-player-name">{entry.name}</span>
                    <span className="lb-player-sub">
                      <span className="lb-angkatan-badge" data-angkatan={entry.angkatan}>
                        Angkatan {entry.angkatan}
                      </span>
                      {entry.finalDistanceCm !== null && (
                        <span className="mono"> · {entry.finalDistanceCm.toFixed(1)} cm</span>
                      )}
                    </span>
                  </div>
                  <div className="lb-result-col">
                    <span
                      className={`lb-outcome-chip mono ${
                        entry.outcome === 'won'
                          ? 'lb-outcome-chip--won'
                          : 'lb-outcome-chip--failed'
                      }`}
                    >
                      {entry.outcome === 'won' ? 'MENANG' : 'GAGAL'}
                    </span>
                    <strong className="lb-hold-sec mono">{entry.holdSec.toFixed(1)} dtk</strong>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
