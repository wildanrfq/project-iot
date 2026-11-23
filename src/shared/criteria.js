/**
 * Single source of truth untuk kriteria jarak, LED, dan buzzer dari main.ino.
 * Digunakan bersama oleh backend Node.js dan frontend React.
 */

export const CRITERIA_LEVELS = [
  {
    code: 'AMAN',
    label: 'AMAN',
    ruleText: 'Jarak > 12 cm',
    ledName: 'LED Hijau (GPIO 2)',
    ledColor: 'green',
    buzzerBehavior: 'Mati (noTone)',
    telegramPolicy: 'Tidak kirim notif alarm',
    description: 'Permukaan air masih berada di zona aman di bawah sensor.',
    matches: (distance) => distance > 12,
  },
  {
    code: 'WASPADA',
    label: 'WASPADA',
    ruleText: '9 cm < Jarak <= 12 cm',
    ledName: 'LED Kuning (GPIO 2+4)',
    ledColor: 'yellow',
    buzzerBehavior: 'Beep 2000 Hz (70 ms ON, 530 ms OFF)',
    telegramPolicy: 'Pantau (belum kirim notif)',
    description: 'Air mulai naik mendekati sensor, pengawasan aktif diperlukan.',
    matches: (distance) => distance > 9 && distance <= 12,
  },
  {
    code: 'BAHAYA',
    label: 'BAHAYA',
    ruleText: '5 cm < Jarak <= 9 cm',
    ledName: 'LED Merah / Oranye (GPIO 4)',
    ledColor: 'orange',
    buzzerBehavior: 'Beep cepat adaptif 2000 Hz (jeda 80-350 ms)',
    telegramPolicy: 'Siaga tinggi',
    description: 'Air semakin dekat ke sensor, buzzer berbunyi lebih cepat seiring jarak menyempit.',
    matches: (distance) => distance > 5 && distance <= 9,
  },
  {
    code: 'KRITIS',
    label: 'KRITIS',
    ruleText: 'Jarak <= 5 cm',
    ledName: 'LED Merah (GPIO 4)',
    ledColor: 'red',
    buzzerBehavior: 'Melodi alarm 8 nada (1000-1800 Hz)',
    telegramPolicy: 'Kirim notifikasi Telegram otomatis',
    description: 'Kondisi darurat! Permukaan air sangat dekat dengan sensor ultrasonik.',
    matches: (distance) => distance <= 5,
  },
];

export const GPS_STATES = {
  VALID: 'VALID',
  CARI_SATELIT: 'CARI_SATELIT',
  CEK_KABEL: 'CEK_KABEL',
};

/**
 * Menghitung interval buzzer adaptif persis seperti fungsi map() + constrain() di main.ino.
 * @param {number} distanceCm
 * @returns {number|null}
 */
export function computeDangerBeepIntervalMs(distanceCm) {
  if (!Number.isFinite(distanceCm) || distanceCm <= 5 || distanceCm > 9) {
    return null;
  }
  const mapped = Math.trunc(((distanceCm - 5) * (350 - 80)) / (9 - 5) + 80);
  return Math.min(350, Math.max(80, mapped));
}

/**
 * Mengevaluasi jarak ultrasonik (cm) menjadi objek kriteria lengkap sesuai main.ino.
 * @param {number|null|undefined} rawDistance
 */
export function evaluateDistanceCriterion(rawDistance) {
  const numeric = Number(rawDistance);
  if (rawDistance === null || rawDistance === undefined || !Number.isFinite(numeric)) {
    return null;
  }

  const isTimeout = numeric >= 999;
  const matched =
    CRITERIA_LEVELS.find((item) => item.matches(numeric)) || CRITERIA_LEVELS[0];

  const dangerIntervalMs =
    matched.code === 'BAHAYA' ? computeDangerBeepIntervalMs(numeric) : null;

  return {
    distanceCm: Number(numeric.toFixed(1)),
    displayDistance: isTimeout ? '--- cm' : `${numeric.toFixed(1)} cm`,
    isTimeout,
    code: matched.code,
    label: matched.label,
    ruleText: matched.ruleText,
    ledName: matched.ledName,
    ledColor: matched.ledColor,
    buzzerBehavior:
      dangerIntervalMs !== null
        ? `Beep cepat 2000 Hz (jeda ${dangerIntervalMs} ms)`
        : matched.buzzerBehavior,
    telegramPolicy: matched.telegramPolicy,
    description: matched.description,
    isCritical: matched.code === 'KRITIS',
  };
}

/**
 * Menghitung laju kenaikan permukaan air (cm/detik) dan estimasi waktu menyentuh batas KRITIS (<= 3 cm)
 * menggunakan regresi linear sederhana pada sampel valid terbaru (tanpa angka fiktif saat data belum cukup).
 *
 * @param {Array<{timestampMs: number, distanceCm: number}>} history
 * @param {number|null|undefined} currentDistanceCm
 */
export function computeFloodPrediction(history, currentDistanceCm) {
  if (!Number.isFinite(currentDistanceCm)) {
    return {
      trend: 'UNKNOWN',
      riseRateCmPerSec: null,
      etaToCriticalSec: null,
      sampleCount: 0,
      statusText: 'Menunggu pembacaan sensor yang valid.',
    };
  }

  if (currentDistanceCm >= 999) {
    return {
      trend: 'UNKNOWN',
      riseRateCmPerSec: null,
      etaToCriticalSec: null,
      sampleCount: 0,
      statusText: 'Sensor dalam status timeout (>= 999 cm).',
    };
  }

  const validSamples = Array.isArray(history)
    ? history.filter(
        (item) =>
          item &&
          Number.isFinite(item.timestampMs) &&
          Number.isFinite(item.distanceCm) &&
          item.distanceCm < 999
      )
    : [];

  if (validSamples.length < 2) {
    return {
      trend: 'UNKNOWN',
      riseRateCmPerSec: null,
      etaToCriticalSec: null,
      sampleCount: validSamples.length,
      statusText: 'Mengumpulkan minimal 2 pembacaan beruntun untuk menghitung laju air.',
    };
  }

  const firstTime = validSamples[0].timestampMs;
  const lastTime = validSamples[validSamples.length - 1].timestampMs;
  const spanSec = (lastTime - firstTime) / 1000;

  if (spanSec < 0.8) {
    return {
      trend: 'UNKNOWN',
      riseRateCmPerSec: null,
      etaToCriticalSec: null,
      sampleCount: validSamples.length,
      statusText: 'Mengukur selisih waktu antar pembacaan sensor.',
    };
  }

  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  const n = validSamples.length;

  for (const point of validSamples) {
    const x = (point.timestampMs - firstTime) / 1000;
    const y = point.distanceCm;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator <= 0) {
    return {
      trend: 'STABIL',
      riseRateCmPerSec: 0,
      etaToCriticalSec: null,
      sampleCount: n,
      statusText: 'Permukaan air cenderung stabil.',
    };
  }

  // Jarak sensor berkurang berarti air naik (laju positif = air naik)
  const distanceSlope = (n * sumXY - sumX * sumY) / denominator;
  const riseRateCmPerSec = Number((-distanceSlope).toFixed(2));

  if (riseRateCmPerSec >= 0.03) {
    if (currentDistanceCm <= 5) {
      return {
        trend: 'NAIK',
        riseRateCmPerSec,
        etaToCriticalSec: 0,
        sampleCount: n,
        statusText: 'Batas KRITIS (<= 5.0 cm) sudah tercapai.',
      };
    }

    const rawEtaSec = (currentDistanceCm - 5) / riseRateCmPerSec;
    if (!Number.isFinite(rawEtaSec) || rawEtaSec > 1800) {
      return {
        trend: 'NAIK',
        riseRateCmPerSec,
        etaToCriticalSec: null,
        sampleCount: n,
        statusText: 'Permukaan air naik perlahan (> 30 menit menuju KRITIS).',
      };
    }

    const etaToCriticalSec = Math.max(1, Math.round(rawEtaSec));
    return {
      trend: 'NAIK',
      riseRateCmPerSec,
      etaToCriticalSec,
      sampleCount: n,
      statusText: `Estimasi menyentuh batas KRITIS dalam ~${etaToCriticalSec} detik lagi.`,
    };
  }

  if (riseRateCmPerSec <= -0.03) {
    return {
      trend: 'SURUT',
      riseRateCmPerSec,
      etaToCriticalSec: null,
      sampleCount: n,
      statusText: 'Permukaan air sedang surut menjauhi sensor.',
    };
  }

  return {
    trend: 'STABIL',
    riseRateCmPerSec,
    etaToCriticalSec: null,
    sampleCount: n,
    statusText: 'Permukaan air relatif stabil.',
  };
}

