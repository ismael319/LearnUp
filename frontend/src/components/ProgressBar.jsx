export function ProgressBar({ value = 0, label, showLabel = true, success = false }) {
  const pct = Math.max(0, Math.min(100, Math.round(value || 0)));

  return (
    <div className="stack" style={{ gap: 6 }}>
      {showLabel && (
        <div className="row-between tiny muted">
          <span>{label}</span>
          <span className="strong">{pct}%</span>
        </div>
      )}
      <div
        className={`progress${success ? ' progress-success' : ''}`}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progresso'}
      >
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
