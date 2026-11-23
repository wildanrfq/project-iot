import {
  computeFloodPrediction,
  evaluateDistanceCriterion,
  GPS_STATES,
} from '../src/shared/criteria.js';
import {
  loadInitialConfig,
  saveConfigToDisk,
  clampInt,
  clampCoord,
  sanitizeLocationLabel,
  sanitizeBlynkServer,
  toPublicConfig,
} from './config.js';
import { fetchBlynkSnapshot } from './blynk.js';
import {
  buildTelegramAlertMessage,
  buildTelegramAlertReplyMarkup,
  buildTelegramTestMessage,
  sendTelegramMessage,
} from './telegram.js';

const MAX_LOGS = 30;

export function createMonitorService(options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const telegramFetchImpl = options.fetchImpl || null;
  const persistConfig = options.persistConfig ?? true;
  let config = {
    gpsFallbackEnabled: false,
    campusLat: -7.782196920093637,
    campusLng: 110.4146253,
    campusLocationLabel: 'Stand Expo IoT Kampus',
    ...(options.initialConfig || loadInitialConfig()),
  };

  let reading = null;
  let readingHistory = [];
  let prediction = computeFloodPrediction([], null);
  let lastUpdatedAt = null;
  let lastStatusChangeAt = null;
  let lastAttemptAt = null;
  let connectionState =
    config.dataSource === 'simulator'
      ? 'simulator'
      : config.blynkAuthToken
        ? 'loading'
        : 'unconfigured';
  let errorMessage = null;
  let hardwareConnected = null;

  let simulatorState = {
    distanceCm: 15.0,
    gpsState: GPS_STATES.VALID,
    lat: -7.782196920093637,
    lng: 110.4146253,
    satellites: 7,
  };

  const telegramState = {
    lastSentAt: null,
    lastResult: null,
    lastError: null,
    cooldownUntil: null,
    lastAlertType: null,
  };

  let logs = [];
  let pollTimer = null;
  let isPolling = false;
  let isSendingTelegram = false;
  let logSeq = 1;

  const subscribers = new Set();
  function subscribe(fn) {
    if (typeof fn === 'function') {
      subscribers.add(fn);
    }
    return () => subscribers.delete(fn);
  }

  function notifySubscribers(state) {
    for (const fn of subscribers) {
      try {
        fn(state);
      } catch {}
    }
  }

  function addLog(entry) {
    logs = [
      {
        id: `log-${Date.now()}-${logSeq++}`,
        timestamp: new Date().toISOString(),
        ...entry,
      },
      ...logs,
    ].slice(0, MAX_LOGS);
  }

  function resolveEffectiveGps(rawGps) {
    if (
      rawGps &&
      rawGps.state === GPS_STATES.VALID &&
      Number.isFinite(rawGps.lat) &&
      Number.isFinite(rawGps.lng)
    ) {
      return { ...rawGps, isFallback: false };
    }

    if (config.gpsFallbackEnabled) {
      return {
        state: GPS_STATES.VALID,
        lat: clampCoord(config.campusLat, -7.782196920093637, -90, 90),
        lng: clampCoord(config.campusLng, 110.4146253, -180, 180),
        satellites: rawGps?.satellites ?? 0,
        isFallback: true,
        rawState: rawGps?.state || GPS_STATES.CARI_SATELIT,
        locationLabel: sanitizeLocationLabel(config.campusLocationLabel),
      };
    }

    return rawGps ? { ...rawGps, isFallback: false } : rawGps;
  }

  async function maybeSendTelegramAlert({
    previousCode,
    currentReading,
    sourceLabel,
    currentPrediction = null,
  }) {
    if (isSendingTelegram) return;

    const currentCode = currentReading.criterion.code;
    const nowMs = Date.now();
    const cooldownMs = config.telegramCooldownSec * 1000;

    let alertType = null;
    if (currentCode === 'KRITIS') {
      const enteredCritical = previousCode !== 'KRITIS';
      const cooldownPassed =
        !telegramState.cooldownUntil || nowMs >= Date.parse(telegramState.cooldownUntil);
      if (enteredCritical || cooldownPassed) {
        alertType = 'critical';
      }
    } else if (
      previousCode === 'KRITIS' &&
      currentCode === 'AMAN' &&
      config.telegramNotifyRecovery
    ) {
      alertType = 'recovery';
    }

    if (!alertType) return;

    if (!config.telegramBotToken || !config.telegramChatId) {
      telegramState.lastResult = 'skipped';
      telegramState.lastError = 'Bot Token atau Chat ID Telegram belum dikonfigurasi.';
      if (previousCode !== currentCode || alertType === 'critical') {
        addLog({
          type: 'telegram_skipped',
          level: currentCode,
          message: `Status ${currentCode}: notifikasi Telegram dilewati (Bot belum diatur).`,
        });
      }
      return;
    }

    isSendingTelegram = true;
    try {
      if (alertType === 'critical') {
        telegramState.cooldownUntil = new Date(nowMs + cooldownMs).toISOString();
      }

      const text = buildTelegramAlertMessage({
        type: alertType,
        reading: currentReading,
        sourceLabel,
        prediction: currentPrediction,
      });
      const replyMarkup = buildTelegramAlertReplyMarkup(currentReading.gps);

      const result = await sendTelegramMessage(
        {
          botToken: config.telegramBotToken,
          chatId: config.telegramChatId,
          text,
          replyMarkup,
        },
        telegramFetchImpl
      );

      if (result.ok) {
        telegramState.lastSentAt = new Date().toISOString();
        telegramState.lastResult = 'sent';
        telegramState.lastError = null;
        telegramState.lastAlertType = alertType;
        addLog({
          type: 'telegram_sent',
          level: currentCode,
          message:
            alertType === 'recovery'
              ? `Notif pemulihan AMAN (${currentReading.criterion.displayDistance}) terkirim ke Telegram.`
              : `Notif darurat KRITIS (${currentReading.criterion.displayDistance}) terkirim ke Telegram.`,
        });
      } else {
        if (alertType === 'critical') {
          telegramState.cooldownUntil = new Date(Date.now() + 5000).toISOString();
        }
        telegramState.lastResult = 'error';
        telegramState.lastError = result.error;
        addLog({
          type: 'telegram_error',
          level: currentCode,
          message: `Gagal kirim Telegram (${currentCode}): ${result.error}`,
        });
      }
    } finally {
      isSendingTelegram = false;
    }
  }

  async function applyReading({
    distanceCm,
    gps,
    sourceLabel,
    isSimulated,
    nextHardwareConnected,
    advanceTimestamp = true,
  }) {
    const criterion = evaluateDistanceCriterion(distanceCm);
    if (!criterion) return;

    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const previousCode = reading?.criterion?.code ?? null;
    const isLiveData = isSimulated || nextHardwareConnected === true;
    const effectiveGps = resolveEffectiveGps(gps);

    if (isLiveData && advanceTimestamp && criterion.distanceCm < 999) {
      const windowCutoff = nowMs - 18000;
      readingHistory = [
        ...readingHistory.filter((item) => item.timestampMs >= windowCutoff),
        { timestampMs: nowMs, distanceCm: criterion.distanceCm },
      ].slice(-15);
    }
    prediction = computeFloodPrediction(readingHistory, criterion.distanceCm);

    const nextUpdatedAt = advanceTimestamp
      ? nowIso
      : reading?.updatedAt || null;

    const nextReading = {
      distanceCm: criterion.distanceCm,
      criterion,
      gps: effectiveGps,
      isSimulated,
      updatedAt: nextUpdatedAt,
    };

    reading = nextReading;
    if (advanceTimestamp) {
      lastUpdatedAt = nextUpdatedAt;
    }
    hardwareConnected = nextHardwareConnected;

    if (previousCode !== criterion.code) {
      lastStatusChangeAt = nowIso;
      addLog({
        type: 'status_change',
        level: criterion.code,
        from: previousCode,
        to: criterion.code,
        distance: criterion.displayDistance,
        message: previousCode
          ? `Status berubah: ${previousCode} -> ${criterion.code} (${criterion.displayDistance})`
          : isLiveData
            ? `Status awal terbaca: ${criterion.code} (${criterion.displayDistance})`
            : `Nilai cloud tersimpan terbaca saat ESP32 offline: ${criterion.code} (${criterion.displayDistance})`,
      });
    }

    if (isLiveData) {
      await maybeSendTelegramAlert({
        previousCode,
        currentReading: nextReading,
        sourceLabel,
        currentPrediction: prediction,
      });
    }
  }

  async function refreshNow() {
    if (isPolling) return getState();
    isPolling = true;
    lastAttemptAt = new Date().toISOString();

    let snap;
    try {
      if (config.dataSource === 'simulator') {
        connectionState = 'simulator';
        errorMessage = null;
        isPolling = false;
        await applyReading({
          distanceCm: simulatorState.distanceCm,
          gps: {
            state: simulatorState.gpsState,
            lat: simulatorState.gpsState === GPS_STATES.VALID ? simulatorState.lat : null,
            lng: simulatorState.gpsState === GPS_STATES.VALID ? simulatorState.lng : null,
            satellites: simulatorState.satellites,
          },
          sourceLabel: 'Simulasi Uji Web',
          isSimulated: true,
          nextHardwareConnected: null,
        });
        return getState();
      }

      if (!config.blynkAuthToken) {
        connectionState = 'unconfigured';
        errorMessage = 'Auth Token Blynk belum diatur.';
        hardwareConnected = null;
        return getState();
      }

      snap = await fetchBlynkSnapshot(
        { server: config.blynkServer, authToken: config.blynkAuthToken },
        fetchImpl
      );
    } finally {
      isPolling = false;
    }

    if (!snap.ok) {
      connectionState = snap.reason === 'NO_DATA' ? 'offline' : 'error';
      errorMessage = snap.error;
      hardwareConnected = snap.hardwareConnected ?? false;
      const state = getState();
      notifySubscribers(state);
      return state;
    }

    connectionState = snap.hardwareConnected ? 'connected' : 'offline';
    errorMessage = snap.hardwareConnected
      ? null
      : 'ESP32 sedang offline di Blynk; menampilkan nilai terakhir yang tersimpan di cloud (notif Telegram dijeda sampai ESP32 online).';

    await applyReading({
      distanceCm: snap.distanceCm,
      gps: snap.gps,
      sourceLabel: `Blynk Cloud (${config.blynkServer})`,
      isSimulated: false,
      nextHardwareConnected: snap.hardwareConnected,
      advanceTimestamp: snap.hardwareConnected,
    });

    const state = getState();
    notifySubscribers(state);
    return state;
  }

  async function updateConfig(patch = {}) {
    const prevSource = config.dataSource;

    if (patch.dataSource === 'blynk') {
      config.dataSource = 'blynk';
    }
    if (patch.blynkServer !== undefined) {
      config.blynkServer = sanitizeBlynkServer(patch.blynkServer);
    }
    if (typeof patch.blynkAuthToken === 'string' && patch.blynkAuthToken.trim() !== '') {
      config.blynkAuthToken = patch.blynkAuthToken.trim();
    } else if (patch.clearBlynkToken === true) {
      config.blynkAuthToken = '';
    }
    if (patch.pollIntervalMs !== undefined) {
      config.pollIntervalMs = clampInt(patch.pollIntervalMs, config.pollIntervalMs, 300, 30000);
    }
    if (typeof patch.telegramBotToken === 'string' && patch.telegramBotToken.trim() !== '') {
      config.telegramBotToken = patch.telegramBotToken.trim();
    } else if (patch.clearTelegramToken === true) {
      config.telegramBotToken = '';
    }
    if (typeof patch.telegramChatId === 'string') {
      config.telegramChatId = patch.telegramChatId.trim();
    }
    if (patch.telegramCooldownSec !== undefined) {
      config.telegramCooldownSec = clampInt(
        patch.telegramCooldownSec,
        config.telegramCooldownSec,
        15,
        3600
      );
    }
    if (typeof patch.telegramNotifyRecovery === 'boolean') {
      config.telegramNotifyRecovery = patch.telegramNotifyRecovery;
    }
    if (typeof patch.gpsFallbackEnabled === 'boolean') {
      config.gpsFallbackEnabled = patch.gpsFallbackEnabled;
    }
    if (patch.campusLat !== undefined) {
      const lat = Number(patch.campusLat);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        throw new Error('Latitude kampus harus di antara -90 dan 90.');
      }
      config.campusLat = clampCoord(lat, config.campusLat, -90, 90);
    }
    if (patch.campusLng !== undefined) {
      const lng = Number(patch.campusLng);
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new Error('Longitude kampus harus di antara -180 dan 180.');
      }
      config.campusLng = clampCoord(lng, config.campusLng, -180, 180);
    }
    if (typeof patch.campusLocationLabel === 'string') {
      config.campusLocationLabel = sanitizeLocationLabel(
        patch.campusLocationLabel,
        'Stand Expo IoT Kampus'
      );
    }

    if (persistConfig) {
      saveConfigToDisk(config);
    }

    if (prevSource !== config.dataSource) {
      reading = null;
      readingHistory = [];
      prediction = computeFloodPrediction([], null);
      lastUpdatedAt = null;
      lastStatusChangeAt = null;
      errorMessage = null;
      telegramState.cooldownUntil = null;
      connectionState =
        config.dataSource === 'simulator'
          ? 'simulator'
          : config.blynkAuthToken
            ? 'loading'
            : 'unconfigured';
      addLog({
        type: 'source_switch',
        level: 'INFO',
        message:
          config.dataSource === 'simulator'
            ? 'Beralih ke Mode Simulasi Uji.'
            : 'Beralih ke Mode Live Blynk Cloud.',
      });
    }

    restartPollingLoop();
    await refreshNow();
    return getState();
  }

  async function setSimulatorValues(input = {}) {
    if (input.distanceCm !== undefined) {
      const dist = Number(input.distanceCm);
      if (!Number.isFinite(dist) || dist < 0 || dist > 999) {
        throw new Error('Jarak simulasi harus di antara 0 dan 999 cm.');
      }
      simulatorState.distanceCm = dist;
    }
    if (
      input.gpsState === GPS_STATES.VALID ||
      input.gpsState === GPS_STATES.CARI_SATELIT ||
      input.gpsState === GPS_STATES.CEK_KABEL
    ) {
      simulatorState.gpsState = input.gpsState;
    }
    if (input.lat !== undefined && Number.isFinite(Number(input.lat))) {
      simulatorState.lat = Number(input.lat);
    }
    if (input.lng !== undefined && Number.isFinite(Number(input.lng))) {
      simulatorState.lng = Number(input.lng);
    }
    if (input.satellites !== undefined) {
      simulatorState.satellites = clampInt(input.satellites, simulatorState.satellites, 0, 32);
    }

    if (config.dataSource !== 'simulator') {
      config.dataSource = 'simulator';
      readingHistory = [];
      prediction = computeFloodPrediction([], null);
      if (persistConfig) saveConfigToDisk(config);
    }

    return refreshNow();
  }

  async function sendTestTelegram() {
    const nowIso = new Date().toISOString();
    const testText = buildTelegramTestMessage({
      modeLabel: config.dataSource === 'simulator' ? 'Simulasi Uji' : 'Live Blynk',
      blynkServer: config.blynkServer,
      chatId: config.telegramChatId,
      updatedAt: nowIso,
    });

    const result = await sendTelegramMessage(
      {
        botToken: config.telegramBotToken,
        chatId: config.telegramChatId,
        text: testText,
      },
      telegramFetchImpl
    );

    if (result.ok) {
      telegramState.lastSentAt = nowIso;
      telegramState.lastResult = 'sent';
      telegramState.lastError = null;
      telegramState.lastAlertType = 'test';
      addLog({
        type: 'telegram_test',
        level: 'INFO',
        message: 'Tes notifikasi Telegram berhasil dikirim.',
      });
    } else {
      telegramState.lastResult = 'error';
      telegramState.lastError = result.error;
      addLog({
        type: 'telegram_error',
        level: 'INFO',
        message: `Tes Telegram gagal: ${result.error}`,
      });
    }

    return { ok: result.ok, error: result.error || null, state: getState() };
  }

  function startPollingLoop() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (config.dataSource === 'blynk' && config.blynkAuthToken) {
        refreshNow().catch(() => {});
      }
    }, config.pollIntervalMs);
  }

  function restartPollingLoop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    startPollingLoop();
  }

  function stopPollingLoop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pushDirectReading({
    distanceCm,
    reportedStatus = null,
    gps = null,
    sourceLabel = 'USB Langsung (0 ms)',
  }) {
    await applyReading({
      distanceCm: Number(distanceCm),
      gps: gps || {
        state: GPS_STATES.VALID,
        lat: config.campusLat,
        lng: config.campusLng,
        satellites: 7,
      },
      sourceLabel,
      isSimulated: false,
      nextHardwareConnected: true,
      advanceTimestamp: true,
    });
    connectionState = 'connected';
    errorMessage = null;
    hardwareConnected = true;
    const state = getState();
    notifySubscribers(state);
    return state;
  }

  function getState() {
    return {
      serverTime: new Date().toISOString(),
      connectionState,
      errorMessage,
      hardwareConnected,
      lastUpdatedAt,
      lastStatusChangeAt,
      lastAttemptAt,
      reading,
      prediction,
      simulatorState: { ...simulatorState },
      telegramState: { ...telegramState },
      config: toPublicConfig(config),
      logs,
    };
  }

  return {
    getState,
    refreshNow,
    updateConfig,
    setSimulatorValues,
    sendTestTelegram,
    startPollingLoop,
    stopPollingLoop,
    subscribe,
    pushDirectReading,
  };
}

