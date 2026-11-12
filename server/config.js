import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_CONFIG_PATH = path.join(__dirname, 'config.local.json');

const ALLOWED_BLYNK_SERVERS = new Set([
  'blynk.cloud',
  'sgp1.blynk.cloud',
  'fra1.blynk.cloud',
  'ny3.blynk.cloud',
  'lon1.blynk.cloud',
  'blr1.blynk.cloud',
]);

function readLocalFile() {
  try {
    if (!fs.existsSync(LOCAL_CONFIG_PATH)) return {};
    const raw = fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadInitialConfig() {
  const saved = readLocalFile();
  const dataSource =
    saved.dataSource ||
    (process.env.DATA_SOURCE === 'simulator' ? 'simulator' : 'blynk');

  const blynkServer = ALLOWED_BLYNK_SERVERS.has(saved.blynkServer)
    ? saved.blynkServer
    : ALLOWED_BLYNK_SERVERS.has(process.env.BLYNK_SERVER)
      ? process.env.BLYNK_SERVER
      : 'sgp1.blynk.cloud';

  const pollIntervalMs = clampInt(
    saved.pollIntervalMs ?? process.env.POLL_INTERVAL_MS,
    2000,
    1000,
    30000
  );

  const telegramCooldownSec = clampInt(
    saved.telegramCooldownSec ?? process.env.TELEGRAM_COOLDOWN_SEC,
    60,
    15,
    3600
  );

  const telegramNotifyRecovery =
    typeof saved.telegramNotifyRecovery === 'boolean'
      ? saved.telegramNotifyRecovery
      : process.env.TELEGRAM_NOTIFY_RECOVERY !== 'false';

  const gpsFallbackEnabled =
    typeof saved.gpsFallbackEnabled === 'boolean'
      ? saved.gpsFallbackEnabled
      : process.env.GPS_FALLBACK_ENABLED === 'true';

  const campusLat = clampCoord(saved.campusLat ?? process.env.CAMPUS_LAT, -6.208763, -90, 90);
  const campusLng = clampCoord(saved.campusLng ?? process.env.CAMPUS_LNG, 106.845599, -180, 180);
  const campusLocationLabel = sanitizeLocationLabel(
    saved.campusLocationLabel ?? process.env.CAMPUS_LOCATION_LABEL,
    'Stand Expo IoT Kampus'
  );

  return {
    dataSource,
    blynkServer,
    blynkAuthToken: String(saved.blynkAuthToken ?? process.env.BLYNK_AUTH_TOKEN ?? '').trim(),
    pollIntervalMs,
    telegramBotToken: String(saved.telegramBotToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '').trim(),
    telegramChatId: String(saved.telegramChatId ?? process.env.TELEGRAM_CHAT_ID ?? '').trim(),
    telegramCooldownSec,
    telegramNotifyRecovery,
    gpsFallbackEnabled,
    campusLat,
    campusLng,
    campusLocationLabel,
  };
}

export function saveConfigToDisk(config) {
  fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

export function clampInt(value, fallback, min, max) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

export function clampCoord(value, fallback, min, max) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Number(Math.min(max, Math.max(min, num)).toFixed(6));
}

export function sanitizeLocationLabel(value, fallback = 'Stand Expo IoT Kampus') {
  const text = String(value ?? '').trim().slice(0, 60);
  return text || fallback;
}

export function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 6) return '******';
  return `${value.slice(0, 3)}••••••${value.slice(-4)}`;
}

export function sanitizeBlynkServer(server) {
  const normalized = String(server || '').trim().toLowerCase();
  return ALLOWED_BLYNK_SERVERS.has(normalized) ? normalized : 'sgp1.blynk.cloud';
}

export function toPublicConfig(config) {
  return {
    dataSource: config.dataSource,
    blynkServer: config.blynkServer,
    blynkConfigured: Boolean(config.blynkAuthToken),
    blynkTokenMasked: maskSecret(config.blynkAuthToken),
    pollIntervalMs: config.pollIntervalMs,
    telegramConfigured: Boolean(config.telegramBotToken && config.telegramChatId),
    telegramBotTokenMasked: maskSecret(config.telegramBotToken),
    telegramChatId: config.telegramChatId,
    telegramCooldownSec: config.telegramCooldownSec,
    telegramNotifyRecovery: config.telegramNotifyRecovery,
    gpsFallbackEnabled: Boolean(config.gpsFallbackEnabled),
    campusLat: config.campusLat,
    campusLng: config.campusLng,
    campusLocationLabel: config.campusLocationLabel,
  };
}

