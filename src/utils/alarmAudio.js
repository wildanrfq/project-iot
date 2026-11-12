/**
 * Engine suara alarm darurat Web Audio API dengan kompresor RMS tinggi
 * agar volume sirine terdengar sangat keras dan jelas di lingkungan ramai (expo).
 * Mendukung voice alert opsional via SpeechSynthesis API.
 */

export function createFloodAlarmEngine() {
  let ctx = null;
  let masterGain = null;
  let limiterNode = null;
  let compressorNode = null;

  let isPlayingSiren = false;
  let activeNodes = null;
  let cycleTimer = null;
  let voiceStartTimer = null;
  let voiceTimer = null;
  let voiceRestoreTimer = null;
  let currentVolume = 1.0; // Default 100% maksimal
  let currentVoiceEnabled = true;
  let currentDistanceText = '<= 3 cm';

  function getAudioContextClass() {
    if (typeof window === 'undefined') return null;
    return window.AudioContext || window.webkitAudioContext || null;
  }

  function ensureContext() {
    const AudioCtx = getAudioContextClass();
    if (!AudioCtx) return null;

    if (!ctx || ctx.state === 'closed') {
      ctx = new AudioCtx();

      // Compressor pra-master untuk menaikkan loudness (RMS) tanpa kliping pecah
      compressorNode = ctx.createDynamicsCompressor();
      compressorNode.threshold.value = -16;
      compressorNode.knee.value = 4;
      compressorNode.ratio.value = 18;
      compressorNode.attack.value = 0.002;
      compressorNode.release.value = 0.06;

      masterGain = ctx.createGain();
      masterGain.gain.value = currentVolume;

      // Safety brickwall limiter pada -1 dBFS agar speaker tetap bersih pada gain tinggi
      limiterNode = ctx.createDynamicsCompressor();
      limiterNode.threshold.value = -1.5;
      limiterNode.knee.value = 0;
      limiterNode.ratio.value = 20;
      limiterNode.attack.value = 0.001;
      limiterNode.release.value = 0.05;

      compressorNode.connect(masterGain);
      masterGain.connect(limiterNode);
      limiterNode.connect(ctx.destination);
    }

    return ctx;
  }

  async function arm() {
    const audioCtx = ensureContext();
    if (!audioCtx) return false;

    try {
      // Panggil resume dan mainkan buffer senyap secara sinkron agar user gesture tidak kedaluwarsa
      const resumePromise = audioCtx.state !== 'running' ? audioCtx.resume() : null;
      const buffer = audioCtx.createBuffer(1, 1, 22050);
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      source.start(0);
      if (resumePromise) {
        await resumePromise;
      }
      return audioCtx.state === 'running';
    } catch {
      return false;
    }
  }

  function isArmed() {
    return Boolean(ctx && ctx.state === 'running');
  }

  function applySirenGain(fraction, rampSec = 0.08) {
    if (!ctx || !masterGain) return;
    const now = ctx.currentTime;
    const clamped = Math.max(0, Math.min(1, fraction));
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(clamped, now + rampSec);
  }

  function setVolume(volume01) {
    const clamped = Math.max(0.1, Math.min(1.0, Number(volume01) || 1.0));
    currentVolume = clamped;
    if (isPlayingSiren) {
      applySirenGain(clamped, 0.05);
    }
  }

  function clearVoiceTimers() {
    if (voiceStartTimer) {
      clearTimeout(voiceStartTimer);
      voiceStartTimer = null;
    }
    if (voiceTimer) {
      clearInterval(voiceTimer);
      voiceTimer = null;
    }
    if (voiceRestoreTimer) {
      clearTimeout(voiceRestoreTimer);
      voiceRestoreTimer = null;
    }
  }

  function startVoiceLoop() {
    clearVoiceTimers();
    if (!isPlayingSiren || !currentVoiceEnabled) return;
    voiceTimer = setInterval(speakParodyAlert, 13000);
    voiceStartTimer = setTimeout(() => {
      voiceStartTimer = null;
      if (isPlayingSiren && currentVoiceEnabled) {
        speakParodyAlert();
      }
    }, 1700);
  }

  function setVoiceEnabled(enabled) {
    currentVoiceEnabled = Boolean(enabled);
    if (!currentVoiceEnabled) {
      clearVoiceTimers();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (isPlayingSiren) applySirenGain(currentVolume, 0.12);
    } else if (isPlayingSiren) {
      startVoiceLoop();
    }
  }

  function setDistanceContext(distanceText) {
    if (distanceText) {
      currentDistanceText = String(distanceText);
    }
  }

  function scheduleSirenSweep() {
    if (!ctx || !activeNodes) return;
    const now = ctx.currentTime;
    const { oscMain, oscHarmonic } = activeNodes;

    // Pola sirine banjir naik-turun tegas (720 Hz <-> 1520 Hz) tiap 960 ms
    oscMain.frequency.cancelScheduledValues(now);
    oscMain.frequency.setValueAtTime(720, now);
    oscMain.frequency.exponentialRampToValueAtTime(1520, now + 0.45);
    oscMain.frequency.exponentialRampToValueAtTime(720, now + 0.92);

    oscHarmonic.frequency.cancelScheduledValues(now);
    oscHarmonic.frequency.setValueAtTime(727, now);
    oscHarmonic.frequency.exponentialRampToValueAtTime(1532, now + 0.45);
    oscHarmonic.frequency.exponentialRampToValueAtTime(727, now + 0.92);
  }

  function speakParodyAlert() {
    if (!isPlayingSiren || !currentVoiceEnabled) return;
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    try {
      const synth = window.speechSynthesis;
      synth.cancel();

      const cleanDistance = currentDistanceText.replace(/cm/i, '').trim();
      const spoken = cleanDistance && cleanDistance !== '---'
        ? `Perhatian! Status banjir kritis! Jarak air tinggal ${cleanDistance} sentimeter. Warga harap segera selamatkan barang berharga dan gorengan!`
        : 'Perhatian! Status banjir kritis! Harap segera selamatkan barang berharga dan gorengan!';

      const utterance = new SpeechSynthesisUtterance(spoken);
      const voices = synth.getVoices ? synth.getVoices() : [];
      const idVoice = voices.find((v) => v.lang?.toLowerCase().startsWith('id'));
      if (idVoice) {
        utterance.voice = idVoice;
      }
      utterance.lang = idVoice?.lang || 'id-ID';
      utterance.rate = 1.06;
      utterance.pitch = 1.04;
      utterance.volume = Math.min(1, currentVolume);

      // Duck sirine sementara agar pengumuman suara terdengar jernih
      applySirenGain(currentVolume * 0.16, 0.16);

      const restore = () => {
        if (voiceRestoreTimer) {
          clearTimeout(voiceRestoreTimer);
          voiceRestoreTimer = null;
        }
        if (isPlayingSiren) {
          applySirenGain(currentVolume, 0.18);
        }
      };

      utterance.onend = restore;
      utterance.onerror = restore;
      voiceRestoreTimer = setTimeout(restore, 5800);

      synth.speak(utterance);
    } catch {
      // Abaikan jika speechSynthesis diblokir browser
    }
  }

  async function startSiren({ volume = currentVolume, voiceEnabled = currentVoiceEnabled } = {}) {
    currentVolume = Math.max(0.1, Math.min(1.0, Number(volume) || 1.0));
    currentVoiceEnabled = Boolean(voiceEnabled);

    const audioCtx = ensureContext();
    if (!audioCtx) return false;

    const neededResume = audioCtx.state !== 'running';
    const resumePromise = neededResume ? audioCtx.resume().catch(() => {}) : null;

    if (isPlayingSiren && activeNodes) {
      applySirenGain(currentVolume, 0.05);
      if (resumePromise) {
        await resumePromise;
      }
      return audioCtx.state === 'running';
    }

    if (cycleTimer) {
      clearInterval(cycleTimer);
      cycleTimer = null;
    }

    const oscMain = audioCtx.createOscillator();
    oscMain.type = 'sawtooth';

    const oscHarmonic = audioCtx.createOscillator();
    oscHarmonic.type = 'square';

    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3200;
    filter.Q.value = 2.0;

    // Drive tinggi menuju kompresor untuk volume maksimal di speaker laptop/stand
    const driveGain = audioCtx.createGain();
    driveGain.gain.value = 2.2;

    const oscMixA = audioCtx.createGain();
    oscMixA.gain.value = 0.65;

    const oscMixB = audioCtx.createGain();
    oscMixB.gain.value = 0.45;

    oscMain.connect(oscMixA);
    oscHarmonic.connect(oscMixB);
    oscMixA.connect(filter);
    oscMixB.connect(filter);
    filter.connect(driveGain);
    driveGain.connect(compressorNode);

    activeNodes = { oscMain, oscHarmonic, filter, driveGain, oscMixA, oscMixB };
    isPlayingSiren = true;

    applySirenGain(currentVolume, 0.03);
    scheduleSirenSweep();

    oscMain.start();
    oscHarmonic.start();

    cycleTimer = setInterval(scheduleSirenSweep, 940);

    if (currentVoiceEnabled) {
      startVoiceLoop();
    }

    if (resumePromise) {
      await resumePromise;
      if (!isPlayingSiren || !activeNodes) {
        return false;
      }
      if (audioCtx.state === 'running') {
        applySirenGain(currentVolume, 0.03);
        scheduleSirenSweep();
      }
    }

    if (audioCtx.state !== 'running') {
      stopSiren();
      return false;
    }

    return true;
  }

  function stopSiren() {
    isPlayingSiren = false;
    if (cycleTimer) {
      clearInterval(cycleTimer);
      cycleTimer = null;
    }
    clearVoiceTimers();

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Abaikan error speechSynthesis
      }
    }

    if (activeNodes) {
      const { oscMain, oscHarmonic, filter, driveGain, oscMixA, oscMixB } = activeNodes;
      activeNodes = null;
      try {
        oscMain.stop();
      } catch {
        // Sudah berhenti
      }
      try {
        oscHarmonic.stop();
      } catch {
        // Sudah berhenti
      }
      oscMain.disconnect();
      oscHarmonic.disconnect();
      oscMixA.disconnect();
      oscMixB.disconnect();
      filter.disconnect();
      driveGain.disconnect();
    }
  }

  async function playChallengeWinChime() {
    const audioCtx = ensureContext();
    if (!audioCtx || audioCtx.state !== 'running') return;

    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const start = audioCtx.currentTime + idx * 0.09;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.32, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.24);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  }

  function destroy() {
    stopSiren();
    if (ctx && typeof ctx.close === 'function') {
      ctx.close().catch(() => {});
    }
    ctx = null;
    masterGain = null;
    limiterNode = null;
    compressorNode = null;
  }

  return {
    arm,
    isArmed,
    getContextState: () => (ctx ? ctx.state : 'uninitialized'),
    startSiren,
    stopSiren,
    setVolume,
    setVoiceEnabled,
    setDistanceContext,
    playChallengeWinChime,
    destroy,
  };
}
