import { GaugeMark, RefreshGlyph } from './Icons.jsx';

export function StatusHeader({
  state,
  isSerialConnected,
  refreshing,
  activeTab,
  onTabChange,
  onRefresh,
  onOpenSettings,
}) {
  let connectionState = 'connecting';
  let connectionLabel = 'Menghubungkan...';

  if (isSerialConnected) {
    connectionState = 'usb';
    connectionLabel = 'USB Langsung (0 ms)';
  } else if (state) {
    if (state.hardwareConnected) {
      connectionState = 'online';
      connectionLabel = 'ESP32 Online';
    } else if (state.connectionState === 'offline') {
      connectionState = 'offline';
      connectionLabel = 'ESP32 Offline';
    } else if (state.connectionState === 'unconfigured') {
      connectionState = 'unconfigured';
      connectionLabel = 'Blynk Belum Diatur';
    } else {
      connectionState = 'live';
      connectionLabel = 'Live Blynk';
    }
  }

  const activeCode = state?.reading?.criterion?.code || 'AMAN';

  return (
    <header className={`topbar topbar--status-${activeCode.toLowerCase()}`}>
      <div className="topbar-inner">
        <div className="brand-lockup">
          <div className={`brand-icon brand-icon--${activeCode.toLowerCase()}`}>
            <GaugeMark />
          </div>
          <div className="brand-text">
            <h1 className="brand-title">Pantau Banjir ESP32</h1>
            <p className="brand-subtitle">
              Early Warning Ketinggian Air, Prediksi Banjir &amp; Peta Lokasi
            </p>
          </div>
        </div>

        <nav className="header-nav-tabs" aria-label="Navigasi Tampilan">
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'monitoring' ? 'nav-tab-btn--active' : ''}`}
            onClick={() => onTabChange('monitoring')}
            aria-selected={activeTab === 'monitoring'}
            role="tab"
          >
            Dashboard Monitoring
          </button>
          <button
            type="button"
            className={`nav-tab-btn ${activeTab === 'expo' ? 'nav-tab-btn--active' : ''}`}
            onClick={() => onTabChange('expo')}
            aria-selected={activeTab === 'expo'}
            role="tab"
          >
            Mini-Game Expo
          </button>
        </nav>

        <div className="topbar-actions">
          <div
            className={`connection-indicator connection-indicator--${connectionState}`}
            title={`Status Koneksi: ${connectionLabel}`}
          >
            <span className="indicator-dot" aria-hidden="true" />
            <span className="indicator-text mono">{connectionLabel}</span>
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh data sensor"
          >
            <RefreshGlyph />
            <span>{refreshing ? 'Menyegarkan...' : 'Refresh'}</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onOpenSettings}
            aria-label="Buka Pengaturan Sistem"
          >
            Pengaturan
          </button>
        </div>
      </div>
    </header>
  );
}
