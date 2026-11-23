import { useCallback, useEffect, useRef, useState } from 'react';
import { AlarmPanel } from './components/AlarmPanel.jsx';
import { ExpoGame } from './components/ExpoGame.jsx';
import { HistoryChart } from './components/HistoryChart.jsx';
import { SensorMap } from './components/SensorMap.jsx';
import { SettingsModal } from './components/SettingsModal.jsx';
import { StatusHeader } from './components/StatusHeader.jsx';
import { WaterGauge } from './components/WaterGauge.jsx';
import { createFloodAlarmEngine } from './utils/alarmAudio.js';
import { formatWibTime } from './utils/formatters.js';

export default function App() {
  const [state, setState] = useState(null);
  const [fetchError, setFetchError] = useState(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [activeTab, setActiveTab] = useState('monitoring');
  const [historyReadings, setHistoryReadings] = useState([]);

  // State Alarm Sirine Keras
  const [audioArmed, setAudioArmed] = useState(false);
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [alarmSensitivity, setAlarmSensitivity] = useState('bahaya'); // 'bahaya' (<= 9 cm) | 'kritis' (<= 5 cm)
  const [volumePercent, setVolumePercent] = useState(100);
  const [episodeSilenced, setEpisodeSilenced] = useState(false);
  const [isTestingAudio, setIsTestingAudio] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isSerialConnected, setIsSerialConnected] = useState(false);

  const alarmEngineRef = useRef(null);
  const testTimerRef = useRef(null);
  const wasCriticalRef = useRef(false);
  const serialPortRef = useRef(null);
  const serialReaderRef = useRef(null);
  const serialKeepReadingRef = useRef(false);

  if (!alarmEngineRef.current) {
    alarmEngineRef.current = createFloodAlarmEngine();
  }

  useEffect(() => {
    const engine = alarmEngineRef.current;

    const tryAutoArm = async (event) => {
      if (event?.target?.closest?.('.alarm-panel, .alarm-bar, button, input')) {
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
      setErrorDismissed(false);
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

  const pollIntervalMs = state?.config?.pollIntervalMs ?? 500;

  // SSE /api/live stream untuk realtime updates
  useEffect(() => {
    let es = null;
    try {
      es = new EventSource('/api/live');
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data && typeof data === 'object') {
            setState(data);
            setFetchError(null);
            setErrorDismissed(false);
          }
        } catch {
          // Abaikan error parsing JSON stream
        }
      };
    } catch {
      // EventSource tidak didukung browser
    }

    const interval = Math.min(pollIntervalMs, 600);
    const pollId = setInterval(() => {
      loadStatus();
    }, interval);

    return () => {
      if (es) {
        es.close();
      }
      clearInterval(pollId);
    };
  }, [loadStatus, pollIntervalMs]);

  // Buffer riwayat 30 sampai 60 pembacaan sensor
  useEffect(() => {
    const dist = state?.reading?.criterion?.distanceCm;
    if (dist !== undefined && Number.isFinite(dist)) {
      setHistoryReadings((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.distanceCm === dist && Date.now() - last.timestamp < 350) {
          return prev;
        }
        const next = [
          ...prev,
          {
            timestamp: Date.now(),
            distanceCm: dist,
            code: state.reading.criterion.code || 'AMAN',
          },
        ];
        return next.slice(-60);
      });
    }
  }, [state?.reading?.criterion?.distanceCm, state?.reading?.criterion?.code]);

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
      setErrorDismissed(false);
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
  const isDeviceActive = Boolean(state?.hardwareConnected === true || isSerialConnected);
  const isTriggerLevelMet =
    alarmSensitivity === 'bahaya'
      ? activeCode === 'KRITIS' || activeCode === 'BAHAYA'
      : activeCode === 'KRITIS';
  const isCriticalLive = Boolean(isTriggerLevelMet && isDeviceActive);

  useEffect(() => {
    if (wasCriticalRef.current && !isCriticalLive) {
      setEpisodeSilenced(false);
    }
    wasCriticalRef.current = isCriticalLive;
  }, [isCriticalLive]);

  async function handleToggleSerial() {
    if (isSerialConnected) {
      serialKeepReadingRef.current = false;
      try {
        if (serialReaderRef.current) {
          await serialReaderRef.current.cancel();
        }
        if (serialPortRef.current) {
          await serialPortRef.current.close();
        }
      } catch {}
      serialPortRef.current = null;
      serialReaderRef.current = null;
      setIsSerialConnected(false);
      return;
    }

    if (typeof navigator === 'undefined' || !navigator.serial) {
      alert('Browser ini belum mendukung Web Serial API. Gunakan Chrome, Brave, atau Edge untuk koneksi kabel USB langsung.');
      return;
    }

    try {
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      serialPortRef.current = port;
      serialKeepReadingRef.current = true;
      setIsSerialConnected(true);

      const textDecoder = new TextDecoderStream();
      const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
      const reader = textDecoder.readable.getReader();
      serialReaderRef.current = reader;

      let buffer = '';
      let consecutiveGlitch = 0;
      let lastValidSerialDist = null;
      (async () => {
        try {
          while (serialKeepReadingRef.current) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              buffer += value;
              const lines = buffer.split('\n');
              buffer = lines.pop();
              for (const line of lines) {
                const trimmed = line.trim();
                let distNum = null;
                if (trimmed.startsWith('TELEMETRY:')) {
                  try {
                    const parsed = JSON.parse(trimmed.slice(10));
                    if (Number.isFinite(parsed.distance)) distNum = parsed.distance;
                  } catch {}
                } else {
                  const m = trimmed.match(/Jarak:\s*([0-9.]+)\s*cm/i);
                  if (m) distNum = parseFloat(m[1]);
                }

                if (distNum !== null) {
                  // Filter spike 999 cm agar tidak loncat pada tampilan jika hanya sesaat
                  if (distNum >= 999) {
                    consecutiveGlitch++;
                    if (consecutiveGlitch < 3 && lastValidSerialDist !== null) {
                      distNum = lastValidSerialDist;
                    }
                  } else {
                    consecutiveGlitch = 0;
                    lastValidSerialDist = distNum;
                  }

                  fetch('/api/telemetry/push', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      distanceCm: distNum,
                      sourceLabel: 'Kabel USB Langsung (0 ms)',
                    }),
                  }).catch(() => {});
                }
              }
            }
          }
        } catch {
          // Port serial ditutup
        } finally {
          setIsSerialConnected(false);
          try { reader.releaseLock(); } catch {}
          try { await readableStreamClosed.catch(() => {}); } catch {}
          try { await port.close().catch(() => {}); } catch {}
        }
      })();
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        alert(`Gagal membuka port serial: ${err.message}`);
      }
      setIsSerialConnected(false);
    }
  }

  useEffect(() => {
    alarmEngineRef.current.setDistanceContext(state?.reading?.criterion?.displayDistance);
  }, [state?.reading?.criterion?.displayDistance]);

  useEffect(() => {
    alarmEngineRef.current.setVolume(volumePercent / 100);
  }, [volumePercent]);

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
  ]);

  async function handleArmAudio() {
    const engine = alarmEngineRef.current;
    if (isCriticalLive && alarmEnabled && !episodeSilenced) {
      const started = await engine.startSiren({
        volume: volumePercent / 100,
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

    const started = await engine.startSiren({
      volume: volumePercent / 100,
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

  const hasTrueConnectionProblem = Boolean(
    fetchError ||
    (state && state.connectionState === 'error') ||
    (state && state.connectionState === 'offline' && !state.reading)
  );

  return (
    <div className={`app-shell theme-control-room status-theme--${(activeCode || 'aman').toLowerCase()}`}>
      <StatusHeader
        state={state}
        isSerialConnected={isSerialConnected}
        refreshing={refreshing}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onRefresh={handleManualRefresh}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main id="main-content" tabIndex={-1} className="main-content">
        {/* Banner Masalah Koneksi: Hanya muncul jika ada masalah nyata dan bisa ditutup */}
        {hasTrueConnectionProblem && !errorDismissed && (
          <section className="state-banner state-banner--error dismissible-banner" role="alert">
            <div className="banner-content">
              <h2 className="state-banner-title">
                {fetchError ? 'Koneksi ke Server Backend Terputus' : 'Koneksi Blynk / ESP32 Terkendala'}
              </h2>
              <p className="state-banner-desc">
                {fetchError || state?.errorMessage || 'Periksa koneksi ESP32 atau jalankan backend (`npm run dev`).'}
                {state?.lastAttemptAt && ` (Percobaan: ${formatWibTime(state.lastAttemptAt)})`}
              </p>
            </div>
            <div className="state-banner-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleManualRefresh}
                disabled={refreshing}
              >
                Coba Hubungkan Ulang
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setErrorDismissed(true)}
                aria-label="Tutup pemberitahuan"
              >
                Tutup
              </button>
            </div>
          </section>
        )}

        {!state && !fetchError && (
          <section className="state-banner" role="status" aria-live="polite">
            <h2 className="state-banner-title">Memuat Data Monitoring...</h2>
            <p className="state-banner-desc">
              Menghubungi backend untuk mengambil status sensor ultrasonik dan peta GPS.
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

        {/* BENTO GRID DASHBOARD */}
        {state && (
          <div className={`bento-dashboard-grid bento-mode--${activeTab}`}>
            {activeTab === 'monitoring' ? (
              <>
                {/* Kolom Kiri: Hero Status Air (~60% lebar pada desktop) */}
                <div className="bento-area-hero">
                  <WaterGauge state={state} nowMs={nowMs} />
                </div>

                {/* Kolom Kanan: Riwayat Grafik & Peta Lokasi */}
                <div className="bento-area-side">
                  <HistoryChart history={historyReadings} />
                  <SensorMap state={state} onSaveConfig={handleSaveConfig} />
                </div>

                {/* Baris Bawah: Panel Alarm Sirine & Akses Cepat Tantangan Expo */}
                <div className="bento-area-alarm">
                  <AlarmPanel
                    audioArmed={audioArmed}
                    alarmEnabled={alarmEnabled}
                    alarmSensitivity={alarmSensitivity}
                    volumePercent={volumePercent}
                    isCriticalLive={isCriticalLive}
                    isPlaying={isPlayingAudio}
                    episodeSilenced={episodeSilenced}
                    isTesting={isTestingAudio}
                    isSerialConnected={isSerialConnected}
                    onArmAudio={handleArmAudio}
                    onToggleAlarmEnabled={handleToggleAlarmEnabled}
                    onToggleAlarmSensitivity={setAlarmSensitivity}
                    onToggleSerial={handleToggleSerial}
                    onVolumeChange={setVolumePercent}
                    onSilenceEpisode={() => setEpisodeSilenced(true)}
                    onResumeEpisode={() => setEpisodeSilenced(false)}
                    onToggleTestSiren={handleToggleTestSiren}
                  />
                </div>

                <div className="bento-area-expo">
                  <ExpoGame state={state} onChallengeWin={handleChallengeWin} />
                </div>
              </>
            ) : (
              /* Mode Mini-Game Expo Khusus */
              <>
                <div className="bento-area-expo-primary">
                  <ExpoGame state={state} onChallengeWin={handleChallengeWin} />
                </div>
                <div className="bento-area-expo-side">
                  <WaterGauge state={state} nowMs={nowMs} />
                  <AlarmPanel
                    audioArmed={audioArmed}
                    alarmEnabled={alarmEnabled}
                    alarmSensitivity={alarmSensitivity}
                    volumePercent={volumePercent}
                    isCriticalLive={isCriticalLive}
                    isPlaying={isPlayingAudio}
                    episodeSilenced={episodeSilenced}
                    isTesting={isTestingAudio}
                    isSerialConnected={isSerialConnected}
                    onArmAudio={handleArmAudio}
                    onToggleAlarmEnabled={handleToggleAlarmEnabled}
                    onToggleAlarmSensitivity={setAlarmSensitivity}
                    onToggleSerial={handleToggleSerial}
                    onVolumeChange={setVolumePercent}
                    onSilenceEpisode={() => setEpisodeSilenced(true)}
                    onResumeEpisode={() => setEpisodeSilenced(false)}
                    onToggleTestSiren={handleToggleTestSiren}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </main>

      <footer className="app-footer">
        <div className="footer-thresholds">
          <span className="mono">Ambang Sensor: AMAN &gt; 12 cm, WASPADA &gt; 9 cm, BAHAYA &gt; 5 cm, KRITIS &lt;= 5 cm</span>
        </div>
        <div className="footer-sync">
          <span>Auto-refresh: <strong className="mono">Aktif tiap {Math.round(pollIntervalMs / 1000)} dtk</strong></span>
        </div>
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
