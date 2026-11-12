import { useCallback, useEffect, useRef, useState } from 'react';
import { AlarmControlBar } from './components/AlarmControlBar.jsx';
import { CriteriaStrip } from './components/CriteriaStrip.jsx';
import { ExpoSection } from './components/ExpoSection.jsx';
import {
  GaugeMark,
  MoonGlyph,
  PauseGlyph,
  PlayGlyph,
  RefreshGlyph,
  SlidersGlyph,
  SunGlyph,
} from './components/Icons.jsx';
import { OperationsSection } from './components/OperationsSection.jsx';
import { SettingsModal } from './components/SettingsModal.jsx';
import { TelemetryPanel } from './components/TelemetryPanel.jsx';
import { createFloodAlarmEngine } from './utils/alarmAudio.js';
import { formatWibTime } from './utils/formatters.js';

const THEME_STORAGE_KEY = 'iot-flood-theme';

function getInitialTheme() {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // Abaikan jika storage tidak tersedia
  }
  return 'light';
}

export default function App() {
  const [theme, setTheme] = useState(getInitialTheme);
  const [state, setState] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
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

    const tryAutoArm = async () => {
      const ok = await engine.arm();
      if (ok) {
        setAudioArmed(true);
        window.removeEventListener('pointerdown', tryAutoArm);
        window.removeEventListener('keydown', tryAutoArm);
      }
    };

    window.addEventListener('pointerdown', tryAutoArm, { passive: true });
    window.addEventListener('keydown', tryAutoArm, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', tryAutoArm);
      window.removeEventListener('keydown', tryAutoArm);
      if (testTimerRef.current) clearTimeout(testTimerRef.current);
      engine.destroy();
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Abaikan jika storage tidak tersedia
    }
  }, [theme]);

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
    if (!autoRefresh) return undefined;
    const pollId = setInterval(() => {
      loadStatus();
    }, pollIntervalMs);
    return () => clearInterval(pollId);
  }, [autoRefresh, pollIntervalMs, loadStatus]);

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

  async function handleSwitchSource(nextSource) {
    await handleSaveConfig({ dataSource: nextSource });
  }

  async function handleSimulate(patch) {
    const res = await fetch('/api/simulator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const payload = await res.json();
    if (!res.ok) {
      throw new Error(payload?.error || 'Gagal memperbarui nilai simulasi.');
    }
    setState(payload);
    setFetchError(null);
    setNowMs(Date.now());
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

  const activeSource = state?.config?.dataSource ?? 'blynk';
  const activeCode = state?.reading?.criterion?.code ?? null;
  const isCriticalLive = Boolean(
    activeCode === 'KRITIS' &&
      (state?.reading?.isSimulated || state?.hardwareConnected === true)
  );

  // Reset status silence otomatis setiap kali status keluar dari KRITIS
  useEffect(() => {
    if (wasCriticalRef.current && !isCriticalLive) {
      setEpisodeSilenced(false);
    }
    wasCriticalRef.current = isCriticalLive;
  }, [isCriticalLive]);

  // Perbarui konteks jarak, volume, dan voice pada engine audio
  useEffect(() => {
    const engine = alarmEngineRef.current;
    engine.setDistanceContext(state?.reading?.criterion?.displayDistance);
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
    const ok = await alarmEngineRef.current.arm();
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
        setIsTestingAudio(false);
      }
      return next;
    });
  }

  async function handleToggleTestSiren() {
    if (isTestingAudio) {
      if (testTimerRef.current) {
        clearTimeout(testTimerRef.current);
        testTimerRef.current = null;
      }
      setIsTestingAudio(false);
      return;
    }

    const armed = audioArmed || (await alarmEngineRef.current.arm());
    if (armed) {
      setAudioArmed(true);
      setIsTestingAudio(true);
      testTimerRef.current = setTimeout(() => {
        testTimerRef.current = null;
        setIsTestingAudio(false);
      }, 2500);
    }
  }

  function handleChallengeWin() {
    if (!isPlayingAudio && audioArmed) {
      alarmEngineRef.current.playChallengeWinChime();
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
                Monitor Kriteria main.ino, Blynk Cloud &amp; Notifikasi Telegram
              </p>
            </div>
          </div>
        </div>

        <nav className="topbar-controls" aria-label="Kontrol monitoring">
          <div className="segmented-group" role="group" aria-label="Sumber data sensor">
            <button
              type="button"
              className="segmented-btn"
              aria-pressed={activeSource === 'blynk'}
              onClick={() => handleSwitchSource('blynk')}
              disabled={!state}
            >
              Live Blynk
            </button>
            <button
              type="button"
              className="segmented-btn"
              aria-pressed={activeSource === 'simulator'}
              onClick={() => handleSwitchSource('simulator')}
              disabled={!state}
            >
              Simulasi Uji
            </button>
          </div>

          <button
            type="button"
            className="btn"
            aria-pressed={autoRefresh}
            onClick={() => setAutoRefresh((prev) => !prev)}
          >
            {autoRefresh ? <PauseGlyph /> : <PlayGlyph />}
            <span>
              {autoRefresh
                ? `Auto ${Math.round(pollIntervalMs / 1000)}d (Jeda)`
                : 'Lanjut Auto'}
            </span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            <RefreshGlyph />
            <span>{refreshing ? 'Menyegarkan...' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setSettingsOpen(true)}
            disabled={!state}
          >
            <SlidersGlyph />
            <span>Pengaturan</span>
          </button>

          <button
            type="button"
            className="btn"
            onClick={() => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))}
          >
            {theme === 'light' ? <MoonGlyph /> : <SunGlyph />}
            <span>{theme === 'light' ? 'Mode Gelap' : 'Mode Terang'}</span>
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
              Menghubungi backend lokal untuk mengambil status sensor ultrasonik, GPS, dan Telegram.
            </p>
          </section>
        )}

        {state && state.connectionState === 'unconfigured' && (
          <section className="state-banner">
            <h2 className="state-banner-title">Token Blynk Belum Dikonfigurasi</h2>
            <p className="state-banner-desc">
              Mode Live Blynk aktif, namun <strong>BLYNK_AUTH_TOKEN</strong> belum diisi. Masukkan
              Auth Token Blynk Anda di menu Pengaturan, atau jalankan Mode Simulasi Uji untuk
              mencoba semua kriteria status dan notifikasi Telegram sekarang.
            </p>
            <div className="state-banner-actions">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setSettingsOpen(true)}
              >
                Isi Token Blynk &amp; Telegram
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => handleSwitchSource('simulator')}
              >
                Jalankan Simulasi Uji
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
          <TelemetryPanel
            state={state}
            nowMs={nowMs}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        <CriteriaStrip activeCode={activeCode} />

        {state && (
          <ExpoSection
            state={state}
            onSaveConfig={handleSaveConfig}
            onSwitchSource={handleSwitchSource}
            onChallengeWin={handleChallengeWin}
          />
        )}

        {state && (
          <OperationsSection
            state={state}
            onSimulate={handleSimulate}
            onOpenSettings={() => setSettingsOpen(true)}
            onSwitchSource={handleSwitchSource}
          />
        )}
      </main>

      <footer className="app-footer">
        <span>Sumber ambang batas: main.ino (AMAN &gt; 10 cm, WASPADA &gt; 7 cm, BAHAYA &gt; 3 cm, KRITIS &lt;= 3 cm)</span>
        <span>
          Status polling:{' '}
          <strong className="mono">
            {autoRefresh ? `Aktif tiap ${Math.round(pollIntervalMs / 1000)} dtk` : 'Dijeda'}
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

