import { useEffect, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../Feedback.jsx';
import { Alert } from '../Alert.jsx';

/**
 * Casca comum das listagens do painel: barra de filtros, estados de
 * carregamento/erro/vazio, tabela e paginação.
 *
 * Existe para as nove telas não repetirem a mesma estrutura — e, mais
 * importante, para elas errarem igual: hoje cada listagem decide sozinha quando
 * mostrar "carregando", e uma delas esqueceu.
 */
export function DataTable({
  // dados
  rows,
  columns,
  rowKey = (row) => row.id,
  rowClass = null,
  // carregamento / erro / vazio
  loading,
  error,
  onRetry,
  emptyTitle = 'Nada por aqui',
  emptyDescription,
  emptyIcon = 'file',
  emptyAction,
  // filtros
  filters = null,
  // paginação
  meta,
  onPageChange,
  // avisos e barra superior
  notice = null,
  onDismissNotice,
  actions = null,
  footer = null,
}) {
  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  const list = rows ?? [];
  const showPagination = meta && onPageChange && meta.totalPages > 1;

  return (
    <div className="stack" style={{ gap: 14 }}>
      {notice && (
        <Alert variant={notice.tone ?? 'success'} onClose={onDismissNotice}>
          {notice.message}
        </Alert>
      )}

      {(filters || actions) && (
        <div className="row-between wrap" style={{ gap: 12 }}>
          {filters ? <div className="row wrap" style={{ gap: 10 }}>{filters}</div> : <span />}
          {actions && <div className="row wrap" style={{ gap: 8 }}>{actions}</div>}
        </div>
      )}

      {!list.length ? (
        <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table table-admin">
              <thead>
                <tr>
                  {columns.map((col) => (
                    <th key={col.key} className={col.align === 'right' ? 'cell-tight' : undefined}>
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((row) => (
                  <tr key={rowKey(row)} className={rowClass?.(row) ?? undefined}>
                    {columns.map((col) => (
                      <td key={col.key} className={col.align === 'right' ? 'cell-tight' : undefined}>
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {showPagination && (
            <div className="row-between wrap" style={{ gap: 10 }}>
              <span className="small muted">
                {meta.total} {meta.total === 1 ? 'registro' : 'registros'} · página {meta.page} de {meta.totalPages}
              </span>
              <div className="row" style={{ gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!meta.hasPrev}
                  onClick={() => onPageChange(meta.page - 1)}
                >
                  <Icon name="caretLeft" size={14} /> Anterior
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={!meta.hasNext}
                  onClick={() => onPageChange(meta.page + 1)}
                >
                  Próxima <Icon name="caretRight" size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {footer}
    </div>
  );
}

/** Campo de busca com debounce, opcionalmente com botão de limpar. */
export function SearchField({ value, onChange, placeholder = 'Buscar', width = 240, label }) {
  return (
    <div className="search-field" style={{ width }}>
      <Icon name="search" size={16} aria-hidden="true" />
      <input
        type="search"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
      />
      {value && (
        <button type="button" className="icon-btn" onClick={() => onChange('')} aria-label="Limpar busca">
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}

/** Select de filtro com rótulo acessível. */
export function FilterSelect({ value, onChange, options, label, width }) {
  return (
    <select
      className="select"
      style={{ width: width ?? 'auto' }}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/** Caixa de diálogo para pedir o motivo de uma ação. */
export function ReasonDialog({
  open,
  title,
  description,
  label = 'Motivo',
  placeholder = 'Explique a decisão (aparece na auditoria)',
  confirmLabel = 'Confirmar',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const [reason, setReason] = useState('');

  // Reabrir o diálogo não pode vir com o texto da decisão anterior: o motivo
  // errado na auditoria é pior do que pedir de novo.
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <ReasonDialogFrame
      open={open}
      title={title}
      description={description}
      label={label}
      placeholder={placeholder}
      confirmLabel={confirmLabel}
      destructive={destructive}
      busy={busy}
      value={reason}
      onChange={setReason}
      onConfirm={() => onConfirm(reason.trim())}
      onCancel={onCancel}
    />
  );
}

function ReasonDialogFrame({
  open,
  title,
  description,
  label,
  placeholder,
  confirmLabel,
  destructive,
  busy,
  value,
  onChange,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div className="modal modal-sm" role="dialog" aria-modal="true" aria-labelledby="reason-title">
        <div className="modal-head">
          <h2 id="reason-title">{title}</h2>
        </div>
        <div className="modal-body">
          {description && <p className="muted" style={{ margin: 0 }}>{description}</p>}
          <label className="field">
            <span>{label}</span>
            <textarea
              className="input"
              rows={3}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              autoFocus
            />
          </label>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Voltar
          </button>
          <button
            type="button"
            className={`btn ${destructive ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
