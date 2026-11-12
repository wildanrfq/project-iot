import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const LOCAL_LEADERBOARD_PATH = path.join(__dirname, 'leaderboard.local.json');

export const ALLOWED_ANGKATAN = ['23', '24', '25', '26'];
const MAX_ENTRIES = 100;

export function sortLeaderboardEntries(entries) {
  return [...entries].sort((a, b) => {
    const aWon = a.outcome === 'won' ? 1 : 0;
    const bWon = b.outcome === 'won' ? 1 : 0;
    if (aWon !== bWon) return bWon - aWon;

    if (a.holdSec !== b.holdSec) return b.holdSec - a.holdSec;

    const aTime = Date.parse(a.createdAt || '') || 0;
    const bTime = Date.parse(b.createdAt || '') || 0;
    return aTime - bTime;
  });
}

export function computeAngkatanStats(entries) {
  const byAngkatan = {};
  for (const ang of ALLOWED_ANGKATAN) {
    byAngkatan[ang] = { angkatan: ang, plays: 0, wins: 0, bestHoldSec: 0 };
  }

  for (const entry of entries) {
    const bucket = byAngkatan[entry.angkatan];
    if (!bucket) continue;
    bucket.plays += 1;
    if (entry.outcome === 'won') bucket.wins += 1;
    if (entry.holdSec > bucket.bestHoldSec) bucket.bestHoldSec = entry.holdSec;
  }

  return ALLOWED_ANGKATAN.map((ang) => byAngkatan[ang]);
}

function sanitizeEntryInput(payload = {}) {
  const rawName = String(payload.name ?? '').trim().replace(/\s+/g, ' ');
  if (!rawName) {
    throw new Error('Nama pemain wajib diisi.');
  }
  const name = rawName.slice(0, 32);

  const angkatan = String(payload.angkatan ?? '').trim();
  if (!ALLOWED_ANGKATAN.includes(angkatan)) {
    throw new Error('Angkatan harus dipilih dari 23, 24, 25, atau 26.');
  }

  const outcome = payload.outcome === 'won' ? 'won' : payload.outcome === 'failed' ? 'failed' : null;
  if (!outcome) {
    throw new Error('Hasil permainan harus berupa won atau failed.');
  }

  const parsedHold = Number(payload.holdSec);
  const holdSec = Number.isFinite(parsedHold)
    ? Number(Math.min(3, Math.max(0, parsedHold)).toFixed(1))
    : 0;

  const parsedDist = Number(payload.finalDistanceCm);
  const finalDistanceCm = Number.isFinite(parsedDist)
    ? Number(parsedDist.toFixed(1))
    : null;

  return {
    name,
    angkatan,
    outcome,
    holdSec,
    finalDistanceCm,
  };
}

export function createLeaderboardService(options = {}) {
  const persistPath =
    options.persistPath === undefined ? LOCAL_LEADERBOARD_PATH : options.persistPath;
  const maxEntries = options.maxEntries || MAX_ENTRIES;
  let seq = 1;

  let entries = [];
  if (Array.isArray(options.initialEntries)) {
    entries = sortLeaderboardEntries(options.initialEntries).slice(0, maxEntries);
  } else if (persistPath && fs.existsSync(persistPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
      if (Array.isArray(parsed)) {
        entries = sortLeaderboardEntries(parsed).slice(0, maxEntries);
      }
    } catch {
      entries = [];
    }
  }

  function saveToDisk() {
    if (!persistPath) return;
    try {
      fs.writeFileSync(persistPath, JSON.stringify(entries, null, 2), 'utf8');
    } catch {
      // Abaikan kegagalan tulis disk agar server tetap merespons
    }
  }

  function getSnapshot() {
    return {
      entries,
      stats: computeAngkatanStats(entries),
      totalEntries: entries.length,
    };
  }

  function addEntry(payload) {
    const clean = sanitizeEntryInput(payload);
    const entry = {
      id: `lb-${Date.now()}-${seq++}`,
      ...clean,
      createdAt: new Date().toISOString(),
    };

    entries = sortLeaderboardEntries([...entries, entry]).slice(0, maxEntries);
    saveToDisk();

    const rankIndex = entries.findIndex((item) => item.id === entry.id);
    return {
      entry,
      rank: rankIndex >= 0 ? rankIndex + 1 : null,
      ...getSnapshot(),
    };
  }

  function resetEntries() {
    entries = [];
    saveToDisk();
    return getSnapshot();
  }

  return {
    getSnapshot,
    addEntry,
    resetEntries,
  };
}

