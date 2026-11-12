export function formatWibTime(isoString) {
  if (!isoString) return 'Belum ada pembaruan';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Format waktu tidak valid';
  return `${new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(date)} WIB`;
}

export function formatShortClock(isoString) {
  if (!isoString) return '--:--:--';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return `${new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(date)} WIB`;
}

export function formatRelativeSeconds(isoString, nowMs) {
  if (!isoString) return 'Menunggu data';
  const targetMs = Date.parse(isoString);
  if (!Number.isFinite(targetMs)) return 'Menunggu data';
  const diffSec = Math.max(0, Math.floor((nowMs - targetMs) / 1000));
  if (diffSec < 2) return 'Baru saja';
  if (diffSec < 60) return `${diffSec} detik lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHours = Math.floor(diffMin / 60);
  return `${diffHours} jam lalu`;
}

export function isReadingStale(isoString, nowMs, pollIntervalMs = 2000) {
  if (!isoString) return false;
  const targetMs = Date.parse(isoString);
  if (!Number.isFinite(targetMs)) return false;
  const thresholdMs = Math.max(15000, pollIntervalMs * 4);
  return nowMs - targetMs > thresholdMs;
}

