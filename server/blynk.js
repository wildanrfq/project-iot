import { GPS_STATES } from '../src/shared/criteria.js';

function parseOptionalNumber(val) {
  if (val === null || val === undefined || val === '') return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function normalizeGpsState(rawState, lat, lng) {
  const upper = String(rawState || '').trim().toUpperCase();
  if (upper === GPS_STATES.CEK_KABEL) return GPS_STATES.CEK_KABEL;
  if (upper === GPS_STATES.VALID) return GPS_STATES.VALID;
  if (upper === GPS_STATES.CARI_SATELIT) return GPS_STATES.CARI_SATELIT;
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return GPS_STATES.VALID;
  }
  return GPS_STATES.CARI_SATELIT;
}

/**
 * Mengambil nilai datastream V0..V5 dan status hardware online dari Blynk Cloud HTTPS API.
 */
export async function fetchBlynkSnapshot(
  { server, authToken },
  fetchImpl = fetch
) {
  if (!authToken) {
    return {
      ok: false,
      reason: 'UNCONFIGURED',
      error: 'Auth Token Blynk belum diisi.',
    };
  }

  const encodedToken = encodeURIComponent(authToken);
  const pinsUrl = `https://${server}/external/api/get?token=${encodedToken}&V0&V1&V2&V3&V4&V5`;
  const onlineUrl = `https://${server}/external/api/isHardwareConnected?token=${encodedToken}`;

  try {
    const [pinsRes, onlineRes] = await Promise.all([
      fetchImpl(pinsUrl, { signal: AbortSignal.timeout(6000) }),
      fetchImpl(onlineUrl, { signal: AbortSignal.timeout(6000) }),
    ]);

    if (!pinsRes.ok) {
      const errorBody = await pinsRes.text().catch(() => '');
      return {
        ok: false,
        reason: pinsRes.status === 400 || pinsRes.status === 401 ? 'INVALID_TOKEN' : 'API_ERROR',
        error: `Blynk merespons HTTP ${pinsRes.status}${errorBody ? `: ${errorBody}` : ''}`,
      };
    }

    const pinsData = await pinsRes.json();
    const isOnlineRaw = onlineRes.ok ? await onlineRes.text() : 'false';
    const hardwareConnected = isOnlineRaw.trim().toLowerCase() === 'true';

    const distanceCm = parseOptionalNumber(pinsData?.V0);
    const lat = parseOptionalNumber(pinsData?.V2);
    const lng = parseOptionalNumber(pinsData?.V3);
    const satellites = parseOptionalNumber(pinsData?.V4) ?? 0;
    const gpsState = normalizeGpsState(pinsData?.V5, lat, lng);

    if (distanceCm === null) {
      return {
        ok: false,
        reason: 'NO_DATA',
        hardwareConnected,
        error: 'Datastream V0 (jarak) belum memiliki nilai di Blynk Cloud.',
      };
    }

    return {
      ok: true,
      hardwareConnected,
      distanceCm,
      reportedStatus: pinsData?.V1 ? String(pinsData.V1).trim().toUpperCase() : null,
      gps: {
        state: gpsState,
        lat: gpsState === GPS_STATES.VALID ? lat : null,
        lng: gpsState === GPS_STATES.VALID ? lng : null,
        satellites,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'NETWORK_ERROR',
      error: `Gagal menjangkau ${server}: ${err?.message || 'Network error'}`,
    };
  }
}

