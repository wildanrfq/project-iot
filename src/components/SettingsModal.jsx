import { useEffect, useRef, useState } from 'react';
import { CloseGlyph, TelegramMark } from './Icons.jsx';

const BLYNK_SERVERS = [
  { value: 'sgp1.blynk.cloud', label: 'sgp1.blynk.cloud (Singapore - disarankan untuk Indonesia)' },
  { value: 'blynk.cloud', label: 'blynk.cloud (Global Auto-Route)' },
  { value: 'fra1.blynk.cloud', label: 'fra1.blynk.cloud (Frankfurt)' },
  { value: 'ny3.blynk.cloud', label: 'ny3.blynk.cloud (New York)' },
  { value: 'lon1.blynk.cloud', label: 'lon1.blynk.cloud (London)' },
  { value: 'blr1.blynk.cloud', label: 'blr1.blynk.cloud (Bangalore)' },
];

export function SettingsModal({
  isOpen,
  config,
  onClose,
  onSaveConfig,
  onTestTelegram,
}) {
  const dialogRef = useRef(null);
  const wasOpenRef = useRef(false);
  const [activeTab, setActiveTab] = useState('config');

  const [blynkServer, setBlynkServer] = useState(config.blynkServer || 'sgp1.blynk.cloud');
  const [blynkAuthToken, setBlynkAuthToken] = useState('');
  const [pollIntervalSec, setPollIntervalSec] = useState(
    String(Math.round((config.pollIntervalMs || 2000) / 1000))
  );
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState(config.telegramChatId || '');
  const [telegramCooldownSec, setTelegramCooldownSec] = useState(
    String(config.telegramCooldownSec || 60)
  );
  const [telegramNotifyRecovery, setTelegramNotifyRecovery] = useState(
    Boolean(config.telegramNotifyRecovery)
  );

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setBlynkServer(config.blynkServer || 'sgp1.blynk.cloud');
      setBlynkAuthToken('');
      setPollIntervalSec(String(Math.round((config.pollIntervalMs || 2000) / 1000)));
      setTelegramBotToken('');
      setTelegramChatId(config.telegramChatId || '');
      setTelegramCooldownSec(String(config.telegramCooldownSec || 60));
      setTelegramNotifyRecovery(Boolean(config.telegramNotifyRecovery));
      setFeedback(null);
    }
    wasOpenRef.current = isOpen;
  }, [isOpen, config]);

  // Modal focus trap + Escape handler (A11Y-PATTERNS.md / R-32)
  useEffect(() => {
    if (!isOpen) return undefined;
    const modal = dialogRef.current;
    if (!modal) return undefined;

    const previousFocus = document.activeElement;
    const focusable = modal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      focusable[0].focus();
    }

    function onKeydown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    modal.addEventListener('keydown', onKeydown);
    return () => {
      modal.removeEventListener('keydown', onKeydown);
      if (previousFocus && typeof previousFocus.focus === 'function') {
        previousFocus.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function handleTabKeyDown(e) {
    const order = ['config', 'guide'];
    const idx = order.indexOf(activeTab);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveTab(order[(idx + 1) % order.length]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveTab(order[(idx - 1 + order.length) % order.length]);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFeedback(null);

    const pollSecNum = Number.parseInt(pollIntervalSec, 10);
    const cooldownNum = Number.parseInt(telegramCooldownSec, 10);

    if (!Number.isFinite(pollSecNum) || pollSecNum < 1 || pollSecNum > 30) {
      setFeedback({ type: 'err', text: 'Interval auto-refresh harus antara 1 sampai 30 detik.' });
      return;
    }
    if (!Number.isFinite(cooldownNum) || cooldownNum < 15 || cooldownNum > 3600) {
      setFeedback({ type: 'err', text: 'Cooldown Telegram harus antara 15 sampai 3600 detik.' });
      return;
    }

    setBusy(true);
    try {
      await onSaveConfig({
        blynkServer,
        ...(blynkAuthToken.trim() ? { blynkAuthToken: blynkAuthToken.trim() } : {}),
        pollIntervalMs: pollSecNum * 1000,
        ...(telegramBotToken.trim() ? { telegramBotToken: telegramBotToken.trim() } : {}),
        telegramChatId: telegramChatId.trim(),
        telegramCooldownSec: cooldownNum,
        telegramNotifyRecovery,
      });
      setBlynkAuthToken('');
      setTelegramBotToken('');
      setFeedback({
        type: 'ok',
        text: 'Konfigurasi berhasil disimpan di server.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err?.message || 'Gagal menyimpan konfigurasi.',
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleTelegramTest() {
    setFeedback(null);
    setBusy(true);
    try {
      if (telegramBotToken.trim() || telegramChatId.trim() !== (config.telegramChatId || '')) {
        await onSaveConfig({
          ...(telegramBotToken.trim() ? { telegramBotToken: telegramBotToken.trim() } : {}),
          telegramChatId: telegramChatId.trim(),
        });
      }
      const res = await onTestTelegram();
      if (res.ok) {
        setFeedback({
          type: 'ok',
          text: 'Tes notifikasi Telegram berhasil terkirim! Cek chat Telegram Anda.',
        });
      } else {
        setFeedback({
          type: 'err',
          text: res.error || 'Gagal mengirim pesan tes ke Telegram.',
        });
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err?.message || 'Gagal menguji koneksi Telegram.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <div className="modal-head">
          <h2 id="settings-modal-title" className="modal-title">
            Pengaturan Integrasi Blynk &amp; Telegram
          </h2>
          <button
            type="button"
            className="btn btn-compact"
            onClick={onClose}
            aria-label="Tutup jendela pengaturan"
          >
            <CloseGlyph />
            <span>Tutup</span>
          </button>
        </div>

        <div className="tablist" role="tablist" aria-label="Menu pengaturan">
          <button
            type="button"
            role="tab"
            id="tab-config"
            aria-selected={activeTab === 'config'}
            aria-controls="panel-config"
            tabIndex={activeTab === 'config' ? 0 : -1}
            className="tab-btn"
            onClick={() => setActiveTab('config')}
            onKeyDown={handleTabKeyDown}
          >
            Koneksi &amp; Token
          </button>
          <button
            type="button"
            role="tab"
            id="tab-guide"
            aria-selected={activeTab === 'guide'}
            aria-controls="panel-guide"
            tabIndex={activeTab === 'guide' ? 0 : -1}
            className="tab-btn"
            onClick={() => setActiveTab('guide')}
            onKeyDown={handleTabKeyDown}
          >
            Ringkasan Pin &amp; Setup
          </button>
        </div>

        {activeTab === 'config' && (
          <div role="tabpanel" id="panel-config" aria-labelledby="tab-config">
            <form onSubmit={handleSubmit} className="form-grid" noValidate>
              <div className="field-group">
                <label htmlFor="blynk-server" className="field-label">
                  Server Regional Blynk Cloud
                </label>
                <select
                  id="blynk-server"
                  className="select-input"
                  value={blynkServer}
                  onChange={(e) => setBlynkServer(e.target.value)}
                >
                  {BLYNK_SERVERS.map((srv) => (
                    <option key={srv.value} value={srv.value}>
                      {srv.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-group">
                <label htmlFor="blynk-token" className="field-label">
                  Blynk Auth Token
                </label>
                <input
                  id="blynk-token"
                  type="password"
                  className="text-input mono"
                  autoComplete="off"
                  placeholder={
                    config.blynkConfigured
                      ? `Tersimpan (${config.blynkTokenMasked}) - isi untuk ganti`
                      : 'Tempel BLYNK_AUTH_TOKEN Anda'
                  }
                  value={blynkAuthToken}
                  onChange={(e) => setBlynkAuthToken(e.target.value)}
                />
                <p className="field-help">
                  Token disimpan di backend server lokal, tidak dikirim ke browser publik.
                </p>
              </div>

              <div className="field-group">
                <label htmlFor="poll-interval" className="field-label">
                  Interval Auto-Refresh (detik)
                </label>
                <input
                  id="poll-interval"
                  type="number"
                  min="1"
                  max="30"
                  className="text-input mono"
                  value={pollIntervalSec}
                  onChange={(e) => setPollIntervalSec(e.target.value)}
                />
              </div>

              <div className="field-group">
                <label htmlFor="tg-bot-token" className="field-label">
                  Telegram Bot Token (dari @BotFather)
                </label>
                <input
                  id="tg-bot-token"
                  type="password"
                  className="text-input mono"
                  autoComplete="off"
                  placeholder={
                    config.telegramConfigured
                      ? `Tersimpan (${config.telegramBotTokenMasked}) - isi untuk ganti`
                      : 'Contoh: 123456789:AAH...'
                  }
                  value={telegramBotToken}
                  onChange={(e) => setTelegramBotToken(e.target.value)}
                />
              </div>

              <div className="form-grid form-grid--2col">
                <div className="field-group">
                  <label htmlFor="tg-chat-id" className="field-label">
                    Telegram Chat ID
                  </label>
                  <input
                    id="tg-chat-id"
                    type="text"
                    className="text-input mono"
                    placeholder="Contoh: 987654321 atau -100..."
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                  />
                </div>

                <div className="field-group">
                  <label htmlFor="tg-cooldown" className="field-label">
                    Jeda Ulang Notif KRITIS (detik)
                  </label>
                  <input
                    id="tg-cooldown"
                    type="number"
                    min="15"
                    max="3600"
                    className="text-input mono"
                    value={telegramCooldownSec}
                    onChange={(e) => setTelegramCooldownSec(e.target.value)}
                  />
                </div>
              </div>

              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={telegramNotifyRecovery}
                  onChange={(e) => setTelegramNotifyRecovery(e.target.checked)}
                />
                <span>Kirim notifikasi pemulihan ke Telegram saat status kembali AMAN</span>
              </label>

              {feedback && (
                <div
                  className={`feedback-banner ${
                    feedback.type === 'ok' ? 'feedback-banner--ok' : 'feedback-banner--err'
                  }`}
                  role={feedback.type === 'err' ? 'alert' : 'status'}
                >
                  {feedback.text}
                </div>
              )}

              <div className="state-banner-actions">
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? 'Menyimpan...' : 'Simpan Konfigurasi'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleTelegramTest}
                  disabled={busy}
                >
                  <TelegramMark />
                  <span>Kirim Tes Telegram</span>
                </button>
              </div>
            </form>
          </div>
        )}

        {activeTab === 'guide' && (
          <div role="tabpanel" id="panel-guide" aria-labelledby="tab-guide" className="form-grid">
            <h3 className="section-title">1. Firmware ESP32 + Blynk</h3>
            <ol className="setup-steps">
              <li>
                Buka <span className="mono">firmware/esp32_blynk/esp32_blynk.ino</span> di Arduino IDE.
              </li>
              <li>
                Isi <span className="mono">BLYNK_TEMPLATE_ID</span>,{' '}
                <span className="mono">BLYNK_TEMPLATE_NAME</span>,{' '}
                <span className="mono">BLYNK_AUTH_TOKEN</span>, serta WiFi SSID dan Password Anda.
              </li>
              <li>
                Buat Datastreams di Blynk Template: <span className="mono">V0</span> (Double, Jarak cm),{' '}
                <span className="mono">V1</span> (String, Status), <span className="mono">V2</span> (Double, Lat),{' '}
                <span className="mono">V3</span> (Double, Lng), <span className="mono">V4</span> (Integer, Satelit),{' '}
                <span className="mono">V5</span> (String, Status GPS).
              </li>
            </ol>

            <h3 className="section-title">2. Bot Telegram (@BotFather)</h3>
            <ol className="setup-steps">
              <li>
                Buka <span className="mono">@BotFather</span> di Telegram, jalankan{' '}
                <span className="mono">/newbot</span>, lalu salin Bot Token.
              </li>
              <li>
                Kirim pesan apa saja ke bot baru Anda (tekan Start), lalu cek Chat ID via{' '}
                <span className="mono">@userinfobot</span> atau endpoint{' '}
                <span className="mono">getUpdates</span>.
              </li>
              <li>
                Masukkan kedua nilai di tab <strong>Koneksi &amp; Token</strong> dan tekan{' '}
                <strong>Kirim Tes Telegram</strong>.
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
