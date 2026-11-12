import { useCallback, useEffect, useRef, useState } from 'react';
import { AlarmControlBar } from './components/AlarmControlBar.jsx';
import { DangerChallengeCard } from './components/DangerChallengeCard.jsx';
import {
  GaugeMark,
  RefreshGlyph,
} from './components/Icons.jsx';
import { MapLibrePanel } from './components/MapLibrePanel.jsx';
import { SettingsModal } from './components/SettingsModal.jsx';
import { TelemetryPanel } from './components/TelemetryPanel.jsx';
import { createFloodAlarmEngine } from './utils/alarmAudio.js';
import { formatWibTime } from './utils/formatters.js';

export default function App() {
  const [state, setState] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // State Alarm Sirine Keras & Pengumuman BMKG
  const [audioArmed, setAudioArmed] = useState(false);
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [volumePercent, setVolumePercent] = useState(100);
  const [episodeSilenced, setEpisodeSilenced] = useState(false);
  const [isTestingAudio, setIsTestingAudio] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const alarmEngineRef = useRef(null);
  const testTimerRef = useRef(null);
  const wasCriticalRef = useRef(false);

  if (!alarmEngineRef.current) {
    alarmEngineRef.current = createFloodAlarmEngine();
  }

  useEffect(() => {
    const engine = alarmEngineRef.current;

    const tryAutoArm = async (event) => {
      if (event?.target?.closest?.('.alarm-bar, button')) {
        return;
      }
      const ok = await engine.arm();
      if (ok) {
        setAudioArmed(true);
        window.removeEventListener('click', tryAutoArm);
        window.removeEventListener('keydown', tryAutoArm);
      }
    };

    window.addEventListener('click', tryAutoArm, { passive: true });
    window.addEventListener('keydown', tryAutoArm, { passive: true });

    return () => {
      window.removeEventListener('click', tryAutoArm);
      window.removeEventListener('keydown', tryAutoArm);
      if (testTimerRef.current) clearTimeout(testTimerRef.current);
      engine.destroy();
    };
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Server merespons HTTP ${res.status}`);
      }
      const data = await res.json();
      setState(data);
      setFetchError(null);
    } catch (err) {
      setFetchError(err?.message || 'Tidak dapat terhubung ke server monitoring.');
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const clockTimer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(clockTimer);
  }, []);

  const pollIntervalMs = state?.config?.pollIntervalMs ?? 2000;

  useEffect(() => {
    const pollId = setInterval(() => {
      loadStatus();
    }, pollIntervalMs);
    return () => clearInterval(pollId);
  }, [pollIntervalMs, loadStatus]);

  async function handleManualRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      if (!res.ok) {
        throw new Error(`Gagal refresh (HTTP ${res.status})`);
      }
      const data = await res.json();
      setState(data);
      setFetchError(null);
      setNowMs(Date.now());
    } catch (err) {
      setFetchError(err?.message || 'Gagal melakukan refresh manual.');
    } finally {
      setRefreshing(false);
    }
  }

  async function handleSaveConfig(patch) {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload?.error || 'Gagal menyimpan konfigurasi.');
    }
    setState(payload);
    setFetchError(null);
    setNowMs(Date.now());
    return payload;
  }

  async function handleTestTelegram() {
    const res = await fetch('/api/telegram/test', { method: 'POST' });
    const payload = await res.json();
    if (payload?.state) {
      setState(payload.state);
    }
    return {
      ok: Boolean(payload?.ok),
      error: payload?.error || null,
    };
  }

  const activeCode = state?.reading?.criterion?.code ?? null;
  const isCriticalLive = Boolean(
    activeCode === 'KRITIS' && state?.hardwareConnected === true
  );

  // Reset status silence otomatis setiap kali status keluar dari KRITIS
  useEffect(() => {
    if (wasCriticalRef.current && !isCriticalLive) {
      setEpisodeSilenced(false);
    }
    wasCriticalRef.current = isCriticalLive;
  }, [isCriticalLive]);

  useEffect(() => {
    alarmEngineRef.current.setDistanceContext(state?.reading?.criterion?.displayDistance);
  }, [state?.reading?.criterion?.displayDistance]);

  useEffect(() => {
    alarmEngineRef.current.setVolume(volumePercent / 100);
  }, [volumePercent]);

  useEffect(() => {
    alarmEngineRef.current.setVoiceEnabled(voiceEnabled);
  }, [voiceEnabled]);

  // Jalankan atau hentikan sirine keras sesuai kondisi KRITIS atau mode tes
  useEffect(() => {
    const engine = alarmEngineRef.current;
    const shouldPlayCritical =
      audioArmed && alarmEnabled && isCriticalLive && !episodeSilenced;
    const shouldPlay = shouldPlayCritical || (audioArmed && isTestingAudio);

    let cancelled = false;

    if (shouldPlay) {
      if (shouldPlayCritical && isTestingAudio) {
        if (testTimerRef.current) {
          clearTimeout(testTimerRef.current);
          testTimerRef.current = null;
        }
        setIsTestingAudio(false);
      }
      engine
        .startSiren({
          volume: volumePercent / 100,
          voiceEnabled: shouldPlayCritical ? voiceEnabled : false,
        })
        .then((started) => {
          if (!cancelled) {
            setIsPlayingAudio(Boolean(started));
          }
        });
    } else {
      engine.stopSiren();
      setIsPlayingAudio(false);
    }

    return () => {
      cancelled = true;
    };
  }, [
    audioArmed,
    alarmEnabled,
    isCriticalLive,
    episodeSilenced,
    isTestingAudio,
    volumePercent,
    voiceEnabled,
  ]);

  async function handleArmAudio() {
    const engine = alarmEngineRef.current;
    if (isCriticalLive && alarmEnabled && !episodeSilenced) {
      const started = await engine.startSiren({
        volume: volumePercent / 100,
        voiceEnabled,
      });
      setAudioArmed(started || engine.isArmed());
      setIsPlayingAudio(Boolean(started));
      return;
    }
    const ok = await engine.arm();
    setAudioArmed(ok);
  }

  function handleToggleAlarmEnabled() {
    setAlarmEnabled((prev) => {
      const next = !prev;
      if (!next) {
        if (testTimerRef.current) {
          clearTimeout(testTimerRef.current);
          testTimerRef.current = null;
        }
        alarmEngineRef.current.stopSiren();
        setIsTestingAudio(false);
        setIsPlayingAudio(false);
      }
      return next;
    });
  }

  async function handleToggleTestSiren() {
    const engine = alarmEngineRef.current;
    if (isTestingAudio) {
      if (testTimerRef.current) {
        clearTimeout(testTimerRef.current);
        testTimerRef.current = null;
      }
      engine.stopSiren();
      setIsTestingAudio(false);
      setIsPlayingAudio(false);
      return;
    }

    if (testTimerRef.current) {
      clearTimeout(testTimerRef.current);
      testTimerRef.current = null;
    }

    // Panggil startSiren langsung pada click handler agar browser mengizinkan AudioContext berbunyi
    const started = await engine.startSiren({
      volume: volumePercent / 100,
      voiceEnabled: false,
    });

    if (started) {
      setAudioArmed(true);
      setIsTestingAudio(true);
      setIsPlayingAudio(true);
      testTimerRef.current = setTimeout(() => {
        testTimerRef.current = null;
        setIsTestingAudio(false);
      }, 3500);
    } else {
      setAudioArmed(engine.isArmed());
      setIsTestingAudio(false);
      setIsPlayingAudio(false);
    }
  }

  function handleChallengeWin() {
    if (!isPlayingAudio && audioArmed) {
      alarmEngineRef.current.playChallengeWinChime();
    }
  }

  let connectionPill = 'Menghubungkan...';
  if (state) {
    if (state.hardwareConnected) {
      connectionPill = 'ESP32 Online';
    } else if (state.connectionState === 'offline') {
      connectionPill = 'ESP32 Offline';
    } else if (state.connectionState === 'unconfigured') {
      connectionPill = 'Blynk Belum Diatur';
    } else {
      connectionPill = 'Live Blynk';
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand-row">
          <div className="brand-lockup">
            <div className="brand-icon">
              <GaugeMark />
            </div>
            <div>
              <h1 className="brand-title">Pantau Banjir ESP32</h1>
              <p className="brand-subtitle">
                Early Warning Ketinggian Air, Prediksi Banjir &amp; Peta Lokasi
              </p>
            </div>
          </div>
          <span className="source-tag mono">{connectionPill}</span>
        </div>

        <nav className="topbar-controls" aria-label="Kontrol monitoring">
          <button
            type="button"
            className="btn"
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            <RefreshGlyph />
            <span>{refreshing ? 'Menyegarkan...' : 'Refresh'}</span>
          </button>
        </nav>
      </header>

      <main id="main-content" tabIndex={-1} className="main-content">
        {fetchError && (
          <section className="state-banner state-banner--error" role="alert">
            <h2 className="state-banner-title">Koneksi ke Server Backend Terputus</h2>
            <p className="state-banner-desc">
              {fetchError}. Pastikan server backend berjalan (`npm run dev`).
            </p>
            <div className="state-banner-actions">
              <button type="button" className="btn btn-primary" onClick={handleManualRefresh}>
                Coba Hubungkan Ulang
              </button>
            </div>
          </section>
        )}

        {!state && !fetchError && (
          <section className="state-banner" role="status" aria-live="polite">
            <h2 className="state-banner-title">Memuat Data Monitoring...</h2>
            <p className="state-banner-desc">
              Menghubungi backend lokal untuk mengambil status sensor ultrasonik dan peta GPS.
            </p>
          </section>
        )}

        {state && state.connectionState === 'unconfigured' && (
          <section className="state-banner">
            <h2 className="state-banner-title">Token Blynk Belum Dikonfigurasi</h2>
            <p className="state-banner-desc">
              Mode Live Blynk aktif, namun <strong>BLYNK_AUTH_TOKEN</strong> belum diisi. Buka
              Pengaturan untuk mengisi token Blynk Cloud Anda.
            </p>
            <div className="state-banner-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setSettingsOpen(true)}
              >
                Buka Pengaturan
              </button>
            </div>
          </section>
        )}

        {state &&
          (state.connectionState === 'error' || state.connectionState === 'offline') && (
            <section
              className={`state-banner ${
                state.connectionState === 'error'
                  ? 'state-banner--error'
                  : 'state-banner--warning'
              }`}
              role="alert"
            >
              <h2 className="state-banner-title">
                {state.connectionState === 'error'
                  ? 'Gagal Mengambil Data dari Blynk Cloud'
                  : 'Perangkat ESP32 Sedang Offline'}
              </h2>
              <p className="state-banner-desc">
                {state.errorMessage || 'Periksa koneksi internet ESP32 dan Auth Token Blynk.'}
                {state.lastAttemptAt && ` (Percobaan terakhir: ${formatWibTime(state.lastAttemptAt)})`}
              </p>
              <div className="state-banner-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleManualRefresh}
                  disabled={refreshing}
                >
                  Coba Refresh Sekarang
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setSettingsOpen(true)}
                >
                  Cek Pengaturan Blynk
                </button>
              </div>
            </section>
          )}

        {state && state.connectionState === 'loading' && !state.reading && (
          <section className="state-banner" role="status" aria-live="polite">
            <h2 className="state-banner-title">Menunggu Pembacaan Pertama dari Blynk...</h2>
            <p className="state-banner-desc">
              Sedang mengambil nilai virtual pin V0..V5 dari server {state.config.blynkServer}.
            </p>
          </section>
        )}

        {state && (
          <AlarmControlBar
            audioArmed={audioArmed}
            alarmEnabled={alarmEnabled}
            voiceEnabled={voiceEnabled}
            volumePercent={volumePercent}
            isCriticalLive={isCriticalLive}
            isPlaying={isPlayingAudio}
            episodeSilenced={episodeSilenced}
            isTesting={isTestingAudio}
            onArmAudio={handleArmAudio}
            onToggleAlarmEnabled={handleToggleAlarmEnabled}
            onToggleVoiceEnabled={setVoiceEnabled}
            onVolumeChange={setVolumePercent}
            onSilenceEpisode={() => setEpisodeSilenced(true)}
            onResumeEpisode={() => setEpisodeSilenced(false)}
            onToggleTestSiren={handleToggleTestSiren}
          />
        )}

        {state && state.reading && (
          <TelemetryPanel state={state} nowMs={nowMs} />
        )}

        {state && (
          <DangerChallengeCard
            state={state}
            onChallengeWin={handleChallengeWin}
          />
        )}

        {state && (
          <MapLibrePanel state={state} onSaveConfig={handleSaveConfig} />
        )}
      </main>

      <footer className="app-footer">
        <span>Ambang Sensor: AMAN &gt; 10 cm, WASPADA &gt; 7 cm, BAHAYA &gt; 3 cm, KRITIS &lt;= 3 cm</span>
        <span>
          Auto-refresh:{' '}
          <strong className="mono">
            Aktif tiap {Math.round(pollIntervalMs / 1000)} dtk
          </strong>
        </span>
      </footer>

      {state && (
        <SettingsModal
          isOpen={settingsOpen}
          config={state.config}
          onClose={() => setSettingsOpen(false)}
          onSaveConfig={handleSaveConfig}
          onTestTelegram={handleTestTelegram}
        />
      )}
    </div>
  );
}
