import { Icon } from '../Icon.jsx';
import { formatNumber, formatPrice } from '../../utils/format.js';

/** Cartão de número do topo do painel. */
export function StatCard({ label, value, note, icon, tone = 'default', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className={`stat-card stat-${tone}`} onClick={onClick}>
      {icon && (
        <span className="stat-icon" aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
      )}
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {note && <span className="stat-note">{note}</span>}
    </Tag>
  );
}

/** Estado enumerado com cor, usado em toda listagem do painel. */
export function Tag({ tone = 'neutral', children, title }) {
  return (
    <span className={`pill pill-${tone}`} title={title}>
      {children}
    </span>
  );
}

export const STATUS_TONE = {
  published: 'success',
  paid: 'success',
  active: 'success',
  valid: 'success',
  visible: 'success',
  draft: 'neutral',
  pending: 'warn',
  in_review: 'info',
  archived: 'neutral',
  canceled: 'neutral',
  refunded: 'danger',
  failed: 'danger',
  revoked: 'danger',
  hidden: 'danger',
  blocked: 'danger',
  admin: 'gold',
  instructor: 'brand',
  student: 'neutral',
};

export const StatusTag = ({ status, map, title }) => (
  <Tag tone={STATUS_TONE[status] ?? 'neutral'} title={title}>
    {map?.[status] ?? status}
  </Tag>
);

/** Contadores em linha para o cabeçalho de cada listagem. */
export function SummaryBar({ items }) {
  return (
    <div className="summary-bar">
      {items
        .filter(Boolean)
        .map((item) => (
          <div key={item.label} className="summary-item">
            <span className="summary-value">{item.value}</span>
            <span className="summary-label">{item.label}</span>
          </div>
        ))}
    </div>
  );
}

/** Barra horizontal proporcional — usada em rankings e no funil. */
export function BarList({ items, valueKey = 'value', labelKey = 'label', format = formatNumber, empty = 'Sem dados' }) {
  const max = Math.max(...items.map((i) => Number(i[valueKey]) || 0), 1);
  if (!items.length) return <p className="muted small">{empty}</p>;

  return (
    <ul className="bar-list">
      {items.map((item, i) => (
        <li key={item.id ?? `${labelKey}-${i}`}>
          <div className="row-between" style={{ gap: 8 }}>
            <span className="truncate" title={item[labelKey]}>
              {item[labelKey]}
            </span>
            <span className="small strong">{format(item[valueKey])}</span>
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${Math.round(((Number(item[valueKey]) || 0) / max) * 100)}%` }}
            />
          </div>
          {item.note && <span className="tiny muted">{item.note}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Gráfico de linha/área em SVG puro.
 *
 * Sem biblioteca de charts porque o projeto não tem dependência de gráfico e
 * adicionar uma só para duas séries seria desproporcional. O SVG dá o mesmo
 * resultado e continua acessível: a tabela alternativa fica no `title`.
 */
export function LineChart({ series, labels, height = 180, format = formatNumber, empty = 'Sem dados no período' }) {
  const width = 720;
  const padX = 8;
  const padY = 12;

  // Sem pontos ou com séries todas zeradas, o gráfico é só um retângulo vazio:
  // melhor dizer que não há dados do que desenhar um eixo sem informação.
  const isEmpty = !series.length || !labels?.length || series.every((s) => s.every((v) => !Number(v)));
  if (isEmpty) return <p className="muted small">{empty}</p>;

  const values = series.map((s) => s.map((v) => Number(v) || 0));
  const max = Math.max(...values.flat(), 1);
  const x = (i) => padX + (i * (width - padX * 2)) / Math.max(labels.length - 1, 1);
  const y = (v) => padY + (1 - v / max) * (height - padY * 2);

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Gráfico de série temporal">
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padX}
            x2={width - padX}
            y1={y(max * ratio)}
            y2={y(max * ratio)}
            className="chart-grid"
          />
        ))}

        {values.map((points, s) => {
          const path = points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
          const area = `${path} L${x(points.length - 1).toFixed(1)},${height - padY} L${x(0).toFixed(1)},${height - padY} Z`;
          return (
            <g key={s}>
              <path d={area} className={`chart-area chart-color-${s}`} />
              <path d={path} className={`chart-line chart-color-${s}`} />
            </g>
          );
        })}
      </svg>

      <div className="chart-axis">
        <span>{labels[0]}</span>
        <span>{labels[Math.floor(labels.length / 2)]}</span>
        <span>{labels[labels.length - 1]}</span>
      </div>

      <div className="chart-legend">
        {values.map((points, s) => (
          <span key={s} className="legend-item">
            <i className={`legend-dot chart-color-${s}`} aria-hidden="true" />
            {legendLabel(s, labels, points, format)}
          </span>
        ))}
      </div>
    </div>
  );
}

const SERIES_NAMES = ['Período atual', 'Período anterior'];
const legendLabel = (index, labels, values, format) => {
  const total = values.reduce((sum, v) => sum + (Number(v) || 0), 0);
  return `${SERIES_NAMES[index] ?? `Série ${index + 1}`}: ${format(total)} em ${labels.length} dias`;
};

/** Painel de configuração de uma tela. */
export function Panel({ title, description, actions, children, className = '' }) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || actions) && (
        <header className="panel-head">
          <div className="stack" style={{ gap: 2 }}>
            {title && <h2 className="panel-title">{title}</h2>}
            {description && <p className="muted small" style={{ margin: 0 }}>{description}</p>}
          </div>
          {actions && <div className="row wrap" style={{ gap: 8 }}>{actions}</div>}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}

export { formatPrice };
