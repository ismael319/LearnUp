import { Icon } from './Icon.jsx';

/**
 * Cabeçalho de seção no padrão da referência: eyebrow em uppercase,
 * título, descrição e uma ação que vira linha ao lado no desktop.
 */
export function SectionHeader({ eyebrow, title, description, action, actionTo, actionLabel }) {
  return (
    <div className="section-head">
      <div className="section-head-text">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 style={{ margin: 0 }}>{title}</h2>
        {description && <p className="muted" style={{ margin: 0 }}>{description}</p>}
      </div>

      {action ?? (
        actionTo && (
          <a className="btn btn-secondary btn-arrow" href={actionTo}>
            {actionLabel}
            <Icon name="caretRight" size={16} className="icon-caret" />
          </a>
        )
      )}
    </div>
  );
}
