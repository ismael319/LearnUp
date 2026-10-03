import { Icon } from './Icon.jsx';

export function Spinner({ size = 18 }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label="Carregando" />;
}

export function LoadingBlock({ label = 'Carregando...' }) {
  return (
    <div className="loading-full">
      <Spinner size={22} />
      <span>{label}</span>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="card" aria-hidden="true">
      <div className="skeleton" style={{ borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', aspectRatio: '16 / 9' }} />
      <div className="card-pad stack">
        <div className="skeleton" style={{ height: 14, width: '35%' }} />
        <div className="skeleton" style={{ height: 20, width: '90%' }} />
        <div className="skeleton" style={{ height: 13, width: '60%' }} />
      </div>
    </div>
  );
}

export function EmptyState({ icon = 'file', title, description, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        <Icon name={icon} size={32} />
      </span>
      <h3>{title}</h3>
      {description && <p className="muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, title = 'Não foi possível carregar' }) {
  if (!error) return null;

  const isNetwork = error.retryable || error.name === 'NetworkError';
  const details = Array.isArray(error.details) ? error.details : null;

  return (
    <div className="alert alert-danger stack" role="alert">
      <div>
        <strong>{title}.</strong> {error.message}
        {isNetwork && <div className="small" style={{ marginTop: 4 }}>A API parece estar fora do ar. Ela está rodando?</div>}
        {details && (
          <ul>
            {details.map((d, i) => (
              <li key={i}>
                <strong>{d.field}</strong>: {d.message}
              </li>
            ))}
          </ul>
        )}
      </div>
      {onRetry && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}
