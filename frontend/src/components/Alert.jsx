import { Icon } from './Icon.jsx';

const VARIANT_ICON = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  danger: 'alert',
};

export function Alert({ variant = 'info', title, children, onClose }) {
  return (
    <div className={`alert alert-${variant}`} role={variant === 'danger' ? 'alert' : 'status'}>
      <Icon name={VARIANT_ICON[variant] ?? 'info'} size={18} className="alert-icon" />
      <div className="grow">
        {title && <strong>{title}</strong>}
        {title && children ? ' ' : null}
        {children}
      </div>
      {onClose && (
        <button type="button" className="alert-close" onClick={onClose} aria-label="Fechar">
          <Icon name="x" size={16} />
        </button>
      )}
    </div>
  );
}
