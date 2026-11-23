export function HistoryChart({ history = [] }) {
  const validPoints = history.filter(
    (item) => Number.isFinite(item?.distanceCm) && item.distanceCm < 999
  );

  const maxPoints = 60;
  const displayPoints = validPoints.slice(-maxPoints);

  const width = 420;
  const height = 150;
  const padLeft = 32;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 24;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Skala sumbu Y: dari 0 cm (paling dekat / banjir) sampai 20 cm (aman)
  const minY = 0;
  const maxY = 22;

  function getY(val) {
    const clamped = Math.max(minY, Math.min(maxY, val));
    return padTop + ((clamped - minY) / (maxY - minY)) * chartH;
  }

  function getX(idx, total) {
    if (total <= 1) return padLeft + chartW / 2;
    return padLeft + (idx / (total - 1)) * chartW;
  }

  const n = displayPoints.length;
  let polylinePoints = '';
  let areaPath = '';

  if (n > 0) {
    const coords = displayPoints.map((pt, idx) => {
      const x = getX(idx, n);
      const y = getY(pt.distanceCm);
      return { x, y };
    });

    polylinePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');

    const firstX = coords[0].x.toFixed(1);
    const lastX = coords[coords.length - 1].x.toFixed(1);
    const bottomY = (padTop + chartH).toFixed(1);
    areaPath = `M ${firstX},${bottomY} L ${coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' L ')} L ${lastX},${bottomY} Z`;
  }

  const y5 = getY(5);
  const y9 = getY(9);
  const y12 = getY(12);

  const latestVal = n > 0 ? displayPoints[n - 1].distanceCm.toFixed(1) : '-';
  const minVal = n > 0 ? Math.min(...displayPoints.map((p) => p.distanceCm)).toFixed(1) : '-';
  const maxVal = n > 0 ? Math.max(...displayPoints.map((p) => p.distanceCm)).toFixed(1) : '-';

  return (
    <section className="card-panel history-chart-card" aria-label="Riwayat Pembacaan Sensor">
      <div className="card-header-row">
        <div>
          <h3 className="card-subtitle">Tren Sensor</h3>
          <h2 className="card-title">Riwayat Jarak ({n} Sampel Terakhir)</h2>
        </div>
        <div className="history-quick-stats mono">
          <span className="stat-chip">Terkini: <strong>{latestVal} cm</strong></span>
          <span className="stat-chip">Min: <strong>{minVal} cm</strong></span>
          <span className="stat-chip">Max: <strong>{maxVal} cm</strong></span>
        </div>
      </div>

      <div className="history-chart-canvas-wrap">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="history-chart-svg"
          preserveAspectRatio="none"
          role="img"
          aria-label="Grafik riwayat jarak sensor terhadap waktu"
        >
          <defs>
            <linearGradient id="historyGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0284c7" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Garis Grid Ambang Batas */}
          <line
            x1={padLeft}
            y1={y5}
            x2={width - padRight}
            y2={y5}
            className="grid-line grid-line--kritis"
            strokeDasharray="4 3"
          />
          <text x={padLeft - 4} y={y5 + 3} className="grid-label mono" textAnchor="end">
            5cm
          </text>

          <line
            x1={padLeft}
            y1={y9}
            x2={width - padRight}
            y2={y9}
            className="grid-line grid-line--bahaya"
            strokeDasharray="4 3"
          />
          <text x={padLeft - 4} y={y9 + 3} className="grid-label mono" textAnchor="end">
            9cm
          </text>

          <line
            x1={padLeft}
            y1={y12}
            x2={width - padRight}
            y2={y12}
            className="grid-line grid-line--waspada"
            strokeDasharray="4 3"
          />
          <text x={padLeft - 4} y={y12 + 3} className="grid-label mono" textAnchor="end">
            12cm
          </text>

          {/* Area & Garis Riwayat */}
          {areaPath && <path d={areaPath} fill="url(#historyGradient)" />}
          {polylinePoints && (
            <polyline
              points={polylinePoints}
              fill="none"
              className="history-polyline"
              strokeWidth="2"
            />
          )}

          {/* Titik Terkini */}
          {n > 0 && (
            <circle
              cx={getX(n - 1, n)}
              cy={getY(displayPoints[n - 1].distanceCm)}
              r="4"
              className="history-latest-dot"
            />
          )}
        </svg>
      </div>

      <div className="history-legend mono">
        <span className="legend-item"><span className="legend-bullet legend-bullet--kritis" /> Kritis &lt;= 5 cm</span>
        <span className="legend-item"><span className="legend-bullet legend-bullet--bahaya" /> Bahaya 5-9 cm</span>
        <span className="legend-item"><span className="legend-bullet legend-bullet--waspada" /> Waspada 9-12 cm</span>
        <span className="legend-item"><span className="legend-bullet legend-bullet--aman" /> Aman &gt; 12 cm</span>
      </div>
    </section>
  );
}
