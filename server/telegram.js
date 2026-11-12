import https from 'node:https';
import { GPS_STATES } from '../src/shared/criteria.js';

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatWibDateTime(isoString) {
  const date = isoString ? new Date(isoString) : new Date();
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  }).format(date);
}

function getValidCoordinates(gps) {
  if (!gps || gps.state !== GPS_STATES.VALID) {
    return null;
  }
  if (!Number.isFinite(gps.lat) || !Number.isFinite(gps.lng)) {
    return null;
  }
  return {
    lat: gps.lat.toFixed(6),
    lng: gps.lng.toFixed(6),
  };
}

function formatGpsLine(gps) {
  if (!gps) return 'Tidak tersedia';
  const coords = getValidCoordinates(gps);
  if (coords) {
    const mapLink = `<a href="https://maps.google.com/?q=${coords.lat},${coords.lng}">Peta</a>`;
    if (gps.isFallback) {
      const label = escapeHtml(gps.locationLabel || 'Kampus');
      return `<code>${coords.lat}, ${coords.lng}</code> (${mapLink} | Pin Indoor: ${label})`;
    }
    return `<code>${coords.lat}, ${coords.lng}</code> (${mapLink})`;
  }
  if (gps.state === GPS_STATES.CEK_KABEL) {
    return 'Cek kabel sensor';
  }
  return `Mencari satelit (${gps.satellites ?? 0} satelit)`;
}

/**
 * Membangun tombol inline URL Google Maps ketika koordinat GPS valid.
 */
export function buildTelegramAlertReplyMarkup(gps) {
  const coords = getValidCoordinates(gps);
  if (!coords) {
    return null;
  }

  return {
    inline_keyboard: [
      [
        {
          text: '📍 Buka Lokasi di Google Maps',
          url: `https://maps.google.com/?q=${coords.lat},${coords.lng}`,
        },
      ],
    ],
  };
}

/**
 * Memformat pesan alert status banjir bergaya embed card Telegram HTML.
 */
export function buildTelegramAlertMessage({ type, reading, sourceLabel, prediction = null }) {
  const isRecovery = type === 'recovery';
  const header = isRecovery
    ? '✅ <b>PEMULIHAN | STATUS KEMBALI AMAN</b>'
    : '🚨 <b>PERINGATAN KRITIS | KETINGGIAN AIR</b>';

  const distanceText = reading.criterion?.displayDistance || `${reading.distanceCm} cm`;
  const statusText = reading.criterion?.code || 'KRITIS';
  const hardwareNote = isRecovery
    ? 'LED Hijau (GPIO 27) aktif, buzzer mati (&gt; 10 cm)'
    : 'LED Merah (GPIO 32) &amp; buzzer alarm aktif (&lt;= 3 cm)';
  const footer = isRecovery
    ? '🟢 <i>Kondisi air sudah kembali normal di atas ambang aman 10 cm.</i>'
    : '⚠️ <i>Segera cek ketinggian air di lokasi atau pantau dashboard.</i>';

  const embedLines = [
    `📏 <b>Jarak Terbaca:</b> <code>${escapeHtml(distanceText)}</code>`,
    `🚦 <b>Status:</b> <code>${escapeHtml(statusText)}</code>`,
    `🔧 <b>Hardware:</b> ${hardwareNote}`,
    `📡 <b>Sumber Data:</b> ${escapeHtml(sourceLabel)}`,
    `📍 <b>Lokasi GPS:</b> ${formatGpsLine(reading.gps)}`,
    `🕒 <b>Waktu Update:</b> <code>${escapeHtml(formatWibDateTime(reading.updatedAt))} WIB</code>`,
  ];

  if (prediction && Number.isFinite(prediction.riseRateCmPerSec)) {
    const sign = prediction.riseRateCmPerSec > 0 ? '+' : '';
    embedLines.splice(
      2,
      0,
      `📈 <b>Laju Air:</b> <code>${sign}${prediction.riseRateCmPerSec.toFixed(2)} cm/dtk (${escapeHtml(prediction.trend)})</code>`
    );
  }

  return [
    header,
    `<blockquote>${embedLines.join('\n')}</blockquote>`,
    footer,
  ].join('\n');
}

/**
 * Memformat pesan tes koneksi Telegram bergaya embed card HTML.
 */
export function buildTelegramTestMessage({
  modeLabel,
  blynkServer,
  chatId,
  updatedAt,
}) {
  const embedLines = [
    'Bot Telegram aktif dan siap mengirim notifikasi ketinggian air.',
    `📡 <b>Mode Sumber:</b> <code>${escapeHtml(modeLabel)}</code>`,
    `☁️ <b>Server Blynk:</b> <code>${escapeHtml(blynkServer || '-')}</code>`,
    `💬 <b>Target Chat ID:</b> <code>${escapeHtml(chatId || '-')}</code>`,
    `🕒 <b>Waktu Tes:</b> <code>${escapeHtml(formatWibDateTime(updatedAt))} WIB</code>`,
  ];

  return [
    '✅ <b>TES KONEKSI | PANTAU BANJIR ESP32</b>',
    `<blockquote>${embedLines.join('\n')}</blockquote>`,
    '🔔 <i>Alert otomatis akan dikirim saat status mencapai KRITIS (&lt;= 3 cm).</i>',
  ].join('\n');
}

function postJsonHttps(urlString, bodyString, { family = 4, timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      urlString,
      {
        method: 'POST',
        family,
        agent: false,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyString),
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode || 0,
            async json() {
              return JSON.parse(text);
            },
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout setelah ${timeoutMs} ms`));
    });
    req.on('error', reject);
    req.write(bodyString);
    req.end();
  });
}

async function postTelegramWithFallback(urlString, bodyString) {
  try {
    return await postJsonHttps(urlString, bodyString, { family: 4, timeoutMs: 8000 });
  } catch (ipv4Err) {
    try {
      return await postJsonHttps(urlString, bodyString, { family: 0, timeoutMs: 8000 });
    } catch {
      throw ipv4Err;
    }
  }
}

export async function sendTelegramMessage(
  { botToken, chatId, text, replyMarkup = null },
  fetchImpl = null
) {
  if (!botToken || !chatId) {
    return {
      ok: false,
      skipped: true,
      error: 'Bot Token atau Chat ID Telegram belum dikonfigurasi.',
    };
  }

  const endpoint = `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`;
  const requestBody = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (replyMarkup) {
    requestBody.reply_markup = replyMarkup;
  }
  const bodyString = JSON.stringify(requestBody);

  try {
    const response = fetchImpl
      ? await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyString,
          signal: AbortSignal.timeout(15000),
        })
      : await postTelegramWithFallback(endpoint, bodyString);

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload.ok) {
      return {
        ok: false,
        skipped: false,
        error: payload.description || `HTTP ${response.status} dari Telegram API`,
      };
    }

    return {
      ok: true,
      skipped: false,
      messageId: payload.result?.message_id ?? null,
    };
  } catch (err) {
    const causeDetail = err?.cause?.code || err?.cause?.message;
    const message = err?.code || err?.message || 'Gagal terhubung ke Telegram API';
    return {
      ok: false,
      skipped: false,
      error: causeDetail ? `${message} (${causeDetail})` : message,
    };
  }
}

