import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  computeDangerBeepIntervalMs,
  computeFloodPrediction,
  evaluateDistanceCriterion,
  GPS_STATES,
} from '../src/shared/criteria.js';
import { createMonitorService } from '../server/monitor.js';
import { createLeaderboardService } from '../server/leaderboard.js';
import { createApp } from '../server/index.js';
import {
  buildTelegramAlertMessage,
  buildTelegramAlertReplyMarkup,
  buildTelegramTestMessage,
} from '../server/telegram.js';

test('evaluateDistanceCriterion mengikuti ambang main.ino dengan tepat', () => {
  assert.equal(evaluateDistanceCriterion(12.1).code, 'AMAN');
  assert.equal(evaluateDistanceCriterion(999).code, 'AMAN');
  assert.equal(evaluateDistanceCriterion(999).displayDistance, '--- cm');
  assert.equal(evaluateDistanceCriterion(999).isTimeout, true);

  assert.equal(evaluateDistanceCriterion(12.0).code, 'WASPADA');
  assert.equal(evaluateDistanceCriterion(9.1).code, 'WASPADA');

  assert.equal(evaluateDistanceCriterion(9.0).code, 'BAHAYA');
  assert.equal(evaluateDistanceCriterion(5.1).code, 'BAHAYA');
  assert.equal(computeDangerBeepIntervalMs(7), 215);

  assert.equal(evaluateDistanceCriterion(5.0).code, 'KRITIS');
  assert.equal(evaluateDistanceCriterion(0.5).code, 'KRITIS');
  assert.equal(evaluateDistanceCriterion(5.0).isCritical, true);
});

test('monitor service mengirim notifikasi Telegram saat masuk KRITIS dan menahan spam dengan cooldown', async () => {
  const telegramRequests = [];
  const fakeFetch = async (url, init) => {
    telegramRequests.push({ url, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: telegramRequests.length } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const service = createMonitorService({
    fetchImpl: fakeFetch,
    persistConfig: false,
    initialConfig: {
      dataSource: 'simulator',
      blynkServer: 'sgp1.blynk.cloud',
      blynkAuthToken: '',
      pollIntervalMs: 2000,
      telegramBotToken: '123:TEST_TOKEN',
      telegramChatId: '999999',
      telegramCooldownSec: 60,
      telegramNotifyRecovery: true,
    },
  });

  // Awal aman: tidak kirim Telegram
  await service.setSimulatorValues({ distanceCm: 15.0, gpsState: GPS_STATES.VALID });
  assert.equal(telegramRequests.length, 0);

  // Masuk KRITIS: langsung kirim Telegram 1x
  await service.setSimulatorValues({ distanceCm: 2.5 });
  assert.equal(telegramRequests.length, 1);
  assert.match(telegramRequests[0].body.text, /PERINGATAN KRITIS/);
  assert.match(telegramRequests[0].body.text, /2\.5 cm/);

  // Masih KRITIS dalam cooldown: tidak spam
  await service.setSimulatorValues({ distanceCm: 1.8 });
  assert.equal(telegramRequests.length, 1);

  // Kembali AMAN: kirim notifikasi pemulihan 1x
  await service.setSimulatorValues({ distanceCm: 14.0 });
  assert.equal(telegramRequests.length, 2);
  assert.match(telegramRequests[1].body.text, /PEMULIHAN/);
});

test('monitor service membaca data Blynk Cloud dan mengevaluasi status + lastUpdatedAt', async () => {
  const fakeFetch = async (url) => {
    if (url.includes('/external/api/get')) {
      return new Response(
        JSON.stringify({
          V0: 2.2,
          V1: 'KRITIS',
          V2: -6.2,
          V3: 106.8,
          V4: 8,
          V5: 'VALID',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/external/api/isHardwareConnected')) {
      return new Response('true', { status: 200 });
    }
    if (url.includes('api.telegram.org')) {
      return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const service = createMonitorService({
    fetchImpl: fakeFetch,
    persistConfig: false,
    initialConfig: {
      dataSource: 'blynk',
      blynkServer: 'sgp1.blynk.cloud',
      blynkAuthToken: 'BLYNK_SECRET',
      pollIntervalMs: 2000,
      telegramBotToken: '123:TG',
      telegramChatId: '555',
      telegramCooldownSec: 60,
      telegramNotifyRecovery: true,
    },
  });

  const state = await service.refreshNow();
  assert.equal(state.connectionState, 'connected');
  assert.equal(state.hardwareConnected, true);
  assert.equal(state.reading.criterion.code, 'KRITIS');
  assert.equal(state.reading.gps.state, 'VALID');
  assert.ok(state.lastUpdatedAt);
  assert.equal(state.telegramState.lastResult, 'sent');
});

test('monitor service tidak memicu spam Telegram dan tidak memajukan lastUpdatedAt saat ESP32 offline', async () => {
  let telegramCalls = 0;
  const fakeFetch = async (url) => {
    if (url.includes('/external/api/get')) {
      return new Response(
        JSON.stringify({ V0: 0, V1: '', V2: 0, V3: 0, V4: 0, V5: '' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/external/api/isHardwareConnected')) {
      return new Response('false', { status: 200 });
    }
    if (url.includes('api.telegram.org')) {
      telegramCalls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const service = createMonitorService({
    fetchImpl: fakeFetch,
    persistConfig: false,
    initialConfig: {
      dataSource: 'blynk',
      blynkServer: 'sgp1.blynk.cloud',
      blynkAuthToken: 'BLYNK_SECRET',
      pollIntervalMs: 2000,
      telegramBotToken: '123:TG',
      telegramChatId: '555',
      telegramCooldownSec: 60,
      telegramNotifyRecovery: true,
    },
  });

  const s1 = await service.refreshNow();
  assert.equal(s1.connectionState, 'offline');
  assert.equal(s1.hardwareConnected, false);
  assert.equal(s1.lastUpdatedAt, null);
  assert.equal(telegramCalls, 0);

  const s2 = await service.refreshNow();
  assert.equal(s2.lastUpdatedAt, null);
  assert.equal(telegramCalls, 0);
});

test('monitor service tidak mengunci cooldown 60 detik saat pengiriman Telegram gagal jaringan', async () => {
  const fakeFetch = async () => {
    throw new Error('fetch failed');
  };

  const service = createMonitorService({
    fetchImpl: fakeFetch,
    persistConfig: false,
    initialConfig: {
      dataSource: 'simulator',
      blynkServer: 'sgp1.blynk.cloud',
      blynkAuthToken: '',
      pollIntervalMs: 2000,
      telegramBotToken: '123:TG',
      telegramChatId: '555',
      telegramCooldownSec: 60,
      telegramNotifyRecovery: true,
    },
  });

  const beforeMs = Date.now();
  const state = await service.setSimulatorValues({ distanceCm: 2.0 });
  assert.equal(state.telegramState.lastResult, 'error');
  assert.match(state.telegramState.lastError, /fetch failed/);
  const cooldownDeltaMs = Date.parse(state.telegramState.cooldownUntil) - beforeMs;
  assert.ok(cooldownDeltaMs <= 7000, `Expected <= 7s retry backoff, got ${cooldownDeltaMs}ms`);
});

test('API Express melayani /api/status, /api/refresh, dan menyembunyikan token rahasia', async () => {
  const mockBlynkFetch = async (url) => {
    const u = String(url);
    if (u.includes('/external/api/get')) {
      return new Response(
        JSON.stringify({ V0: 6.0, V1: 'BAHAYA', V2: -7.782197, V3: 110.414625, V4: 7, V5: 'VALID' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (u.includes('/external/api/isHardwareConnected')) {
      return new Response('true', { status: 200 });
    }
    throw new Error('Unexpected URL: ' + u);
  };

  const service = createMonitorService({
    fetchImpl: mockBlynkFetch,
    persistConfig: false,
    initialConfig: {
      dataSource: 'blynk',
      blynkServer: 'sgp1.blynk.cloud',
      blynkAuthToken: 'MY_SUPER_SECRET_BLYNK_TOKEN',
      pollIntervalMs: 2000,
      telegramBotToken: 'MY_SUPER_SECRET_TG_TOKEN',
      telegramChatId: '12345',
      telegramCooldownSec: 60,
      telegramNotifyRecovery: true,
    },
  });

  const app = createApp(service);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const { port } = server.address();
    const baseUrl = `http://127.0.0.1:${port}`;

    const statusRes = await fetch(`${baseUrl}/api/status`);
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.config.blynkConfigured, true);
    assert.ok(!JSON.stringify(statusJson).includes('MY_SUPER_SECRET_BLYNK_TOKEN'));
    assert.ok(!JSON.stringify(statusJson).includes('MY_SUPER_SECRET_TG_TOKEN'));

    const refreshRes = await fetch(`${baseUrl}/api/refresh`, { method: 'POST' });
    assert.equal(refreshRes.status, 200);
    const refreshJson = await refreshRes.json();
    assert.equal(refreshJson.reading.criterion.code, 'BAHAYA');
    assert.equal(refreshJson.config.dataSource, 'blynk');
  } finally {
    service.stopPollingLoop();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('formatter Telegram membentuk embed blockquote HTML, chip code, dan tombol peta kondisional', () => {
  const validGps = {
    state: GPS_STATES.VALID,
    lat: -6.208763,
    lng: 106.845599,
    satellites: 8,
  };
  const htmlAlert = buildTelegramAlertMessage({
    type: 'critical',
    reading: {
      distanceCm: 2.4,
      criterion: evaluateDistanceCriterion(2.4),
      gps: validGps,
      updatedAt: '2026-11-11T17:00:00.000Z',
    },
    sourceLabel: 'Blynk & <ESP32>',
  });

  assert.match(htmlAlert, /<blockquote>[\s\S]*<\/blockquote>/);
  assert.match(htmlAlert, /<code>2\.4 cm<\/code>/);
  assert.match(htmlAlert, /<code>KRITIS<\/code>/);
  assert.match(htmlAlert, /Blynk &amp; &lt;ESP32&gt;/);

  const markupValid = buildTelegramAlertReplyMarkup(validGps);
  assert.equal(
    markupValid.inline_keyboard[0][0].url,
    'https://maps.google.com/?q=-6.208763,106.845599'
  );

  const markupSearching = buildTelegramAlertReplyMarkup({
    state: GPS_STATES.SEARCHING,
    satellites: 0,
  });
  assert.equal(markupSearching, null);

  const testHtml = buildTelegramTestMessage({
    modeLabel: 'Live Blynk',
    blynkServer: 'sgp1.blynk.cloud',
    chatId: '999999',
    updatedAt: '2026-11-11T17:00:00.000Z',
  });
  assert.match(testHtml, /TES KONEKSI/);
  assert.match(testHtml, /<blockquote>[\s\S]*<\/blockquote>/);
  assert.match(testHtml, /<code>sgp1\.blynk\.cloud<\/code>/);
});

test('monitor service menyertakan tombol inline Google Maps hanya saat GPS VALID dan mengirim embed tes', async () => {
  const telegramRequests = [];
  const fakeFetch = async (url, init) => {
    telegramRequests.push({ url, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: telegramRequests.length } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const service = createMonitorService({
    fetchImpl: fakeFetch,
    persistConfig: false,
    initialConfig: {
      dataSource: 'simulator',
      blynkServer: 'sgp1.blynk.cloud',
      blynkAuthToken: '',
      pollIntervalMs: 2000,
      telegramBotToken: '123:TEST_TOKEN',
      telegramChatId: '999999',
      telegramCooldownSec: 60,
      telegramNotifyRecovery: false,
    },
  });

  await service.setSimulatorValues({
    distanceCm: 2.0,
    gpsState: GPS_STATES.VALID,
    lat: -6.2,
    lng: 106.8,
  });
  assert.equal(telegramRequests.length, 1);
  assert.equal(telegramRequests[0].body.parse_mode, 'HTML');
  assert.match(telegramRequests[0].body.text, /<blockquote>[\s\S]*<\/blockquote>/);
  assert.equal(
    telegramRequests[0].body.reply_markup.inline_keyboard[0][0].url,
    'https://maps.google.com/?q=-6.200000,106.800000'
  );

  await service.setSimulatorValues({
    distanceCm: 15.0,
    gpsState: GPS_STATES.CEK_KABEL,
  });
  await service.setSimulatorValues({
    distanceCm: 2.1,
    gpsState: GPS_STATES.CEK_KABEL,
  });
  assert.equal(telegramRequests.length, 2);
  assert.equal(telegramRequests[1].body.reply_markup, undefined);

  const testResult = await service.sendTestTelegram();
  assert.equal(testResult.ok, true);
  assert.equal(telegramRequests.length, 3);
  assert.match(telegramRequests[2].body.text, /TES KONEKSI/);
  assert.match(telegramRequests[2].body.text, /<blockquote>[\s\S]*<\/blockquote>/);
  assert.equal(telegramRequests[2].body.reply_markup, undefined);
});

test('computeFloodPrediction menghitung laju kenaikan air dan ETA menuju KRITIS dengan akurat', () => {
  const insufficient = computeFloodPrediction([{ timestampMs: 1000, distanceCm: 10 }], 10);
  assert.equal(insufficient.trend, 'UNKNOWN');
  assert.equal(insufficient.etaToCriticalSec, null);

  const timeoutState = computeFloodPrediction(
    [
      { timestampMs: 1000, distanceCm: 12 },
      { timestampMs: 3000, distanceCm: 10 },
    ],
    999
  );
  assert.equal(timeoutState.trend, 'UNKNOWN');

  // Air naik 6 cm dalam 4 detik -> laju 1.5 cm/dtk; dari 8 cm menuju 5 cm butuh 2 detik
  const rising = computeFloodPrediction(
    [
      { timestampMs: 0, distanceCm: 14.0 },
      { timestampMs: 2000, distanceCm: 11.0 },
      { timestampMs: 4000, distanceCm: 8.0 },
    ],
    8.0
  );
  assert.equal(rising.trend, 'NAIK');
  assert.equal(rising.riseRateCmPerSec, 1.5);
  assert.equal(rising.etaToCriticalSec, 2);

  // Air surut
  const receding = computeFloodPrediction(
    [
      { timestampMs: 0, distanceCm: 6.0 },
      { timestampMs: 2000, distanceCm: 12.0 },
    ],
    12.0
  );
  assert.equal(receding.trend, 'SURUT');
  assert.equal(receding.etaToCriticalSec, null);
});

test('fallback pin GPS kampus aktif saat mode indoor dinyalakan dan menghormati GPS satelit asli saat VALID', async () => {
  const telegramRequests = [];
  const fakeFetch = async (url, init) => {
    telegramRequests.push({ url, body: JSON.parse(init.body) });
    return new Response(
      JSON.stringify({ ok: true, result: { message_id: telegramRequests.length } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const service = createMonitorService({
    fetchImpl: fakeFetch,
    persistConfig: false,
    initialConfig: {
      dataSource: 'simulator',
      blynkServer: 'sgp1.blynk.cloud',
      blynkAuthToken: '',
      pollIntervalMs: 2000,
      telegramBotToken: '123:TEST_TOKEN',
      telegramChatId: '999999',
      telegramCooldownSec: 60,
      telegramNotifyRecovery: false,
      gpsFallbackEnabled: true,
      campusLat: -6.973007,
      campusLng: 107.630348,
      campusLocationLabel: 'Aula Expo Teknik',
    },
  });

  // Saat GPS simulasi CARI_SATELIT namun fallback indoor aktif -> gunakan titik kampus
  const fallbackState = await service.setSimulatorValues({
    distanceCm: 2.2,
    gpsState: GPS_STATES.CARI_SATELIT,
  });
  assert.equal(fallbackState.reading.gps.state, GPS_STATES.VALID);
  assert.equal(fallbackState.reading.gps.isFallback, true);
  assert.equal(fallbackState.reading.gps.lat, -6.973007);
  assert.equal(fallbackState.reading.gps.lng, 107.630348);
  assert.equal(telegramRequests.length, 1);
  assert.match(telegramRequests[0].body.text, /Pin Indoor: Aula Expo Teknik/);
  assert.equal(
    telegramRequests[0].body.reply_markup.inline_keyboard[0][0].url,
    'https://maps.google.com/?q=-6.973007,107.630348'
  );

  // Jika GPS asli terkunci VALID -> koordinat satelit asli mengungguli fallback
  const realGpsState = await service.setSimulatorValues({
    distanceCm: 15.0,
    gpsState: GPS_STATES.VALID,
    lat: -6.2088,
    lng: 106.8456,
  });
  assert.equal(realGpsState.reading.gps.isFallback, false);
  assert.equal(realGpsState.reading.gps.lat, -6.2088);
});

test('leaderboard service dan API mengurutkan skor serta memvalidasi angkatan 23-26', async () => {
  const monitor = createMonitorService({ persistConfig: false });
  const leaderboard = createLeaderboardService({ persistPath: null });
  const app = createApp(monitor, leaderboard);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    // Angkatan di luar 23-26 harus ditolak
    const invalidRes = await fetch(`http://127.0.0.1:${port}/api/leaderboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Budi',
        angkatan: '22',
        outcome: 'won',
        holdSec: 3.0,
        finalDistanceCm: 5.0,
      }),
    });
    assert.equal(invalidRes.status, 400);

    // Tambah peserta gagal dulu (1.8 dtk) lalu peserta menang (3.0 dtk)
    await fetch(`http://127.0.0.1:${port}/api/leaderboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Andi',
        angkatan: '24',
        outcome: 'failed',
        holdSec: 1.8,
        finalDistanceCm: 2.1,
      }),
    });

    const winRes = await fetch(`http://127.0.0.1:${port}/api/leaderboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Citra',
        angkatan: '26',
        outcome: 'won',
        holdSec: 3.0,
        finalDistanceCm: 5.2,
      }),
    });
    assert.equal(winRes.status, 201);
    const winJson = await winRes.json();

    assert.equal(winJson.rank, 1);
    assert.equal(winJson.entries.length, 2);
    assert.equal(winJson.entries[0].name, 'Citra');
    assert.equal(winJson.entries[0].angkatan, '26');
    assert.equal(winJson.entries[1].name, 'Andi');
    assert.equal(winJson.entries[1].holdSec, 1.8);

    const angkatan26 = winJson.stats.find((s) => s.angkatan === '26');
    assert.equal(angkatan26.wins, 1);
    assert.equal(angkatan26.plays, 1);

    const resetRes = await fetch(`http://127.0.0.1:${port}/api/leaderboard`, {
      method: 'DELETE',
    });
    assert.equal(resetRes.status, 200);
    const resetJson = await resetRes.json();
    assert.equal(resetJson.totalEntries, 0);
  } finally {
    monitor.stopPollingLoop();
    await new Promise((resolve) => server.close(resolve));
  }
});



