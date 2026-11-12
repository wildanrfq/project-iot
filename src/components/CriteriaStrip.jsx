import { CRITERIA_LEVELS } from '../shared/criteria.js';

export function CriteriaStrip({ activeCode }) {
  return (
    <section aria-labelledby="criteria-heading">
      <div className="section-head">
        <h2 id="criteria-heading" className="section-title">
          Kriteria Status Sesuai main.ino
        </h2>
        <p className="section-caption">
          Evaluasi langsung berdasarkan jarak pantulan ultrasonik (TRIG GPIO 5, ECHO GPIO 18).
        </p>
      </div>

      <div className="criteria-grid">
        {CRITERIA_LEVELS.map((item) => {
          const isActive = activeCode === item.code;
          return (
            <article
              key={item.code}
              className="criterion-card"
              data-active={isActive}
              data-code={item.code}
            >
              <div className="criterion-top">
                <span className={`status-pill status-pill--${item.code}`}>
                  {item.label}
                </span>
                {isActive && <span className="active-marker">AKTIF</span>}
              </div>

              <p className="criterion-rule mono">{item.ruleText}</p>

              <ul className="criterion-meta">
                <li>
                  <strong>LED:</strong> {item.ledName}
                </li>
                <li>
                  <strong>Buzzer:</strong> {item.buzzerBehavior}
                </li>
                <li>
                  <strong>Telegram:</strong> {item.telegramPolicy}
                </li>
              </ul>
            </article>
          );
        })}
      </div>
    </section>
  );
}

