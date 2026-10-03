import { useEffect, useState } from 'react';
import { Icon } from '../Icon.jsx';
import { Spinner } from '../Feedback.jsx';

/**
 * Confirmação para ação destrutiva ou irreversível.
 *
 * Existe porque "excluir curso" e "reembolsar pedido" não são reversíveis pelo
 * painel: um clique acidental não pode custar um curso inteiro. O diálogo
 * recebe `impact` para dizer o que acontece junto (o que é revogado, o que é
 * cancelado), porque a decisão depende de saber o estrago, não só o nome da
 * ação.
 *
 * `requireText` exige digitar o nome do alvo nas ações que apagam de vez. É
 * irritante de propósito e é o que separa "clique na linha" de intenção.
 *
 * `reason` exibe um motivo obrigatório e o entrega em `onConfirm(reason)`: o
 * backend grava isso na auditoria e o instrutor lê. Aprovação e devolução sem
 * motivo não têm utilidade para ninguém.
 *
 * `onConfirm` pode ser assíncrono: o botão fica em carregamento e a tela não
 * fecha sozinha se a chamada falhar, para o admin poder ler o erro.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  impact,
  reason,
  reasonLabel = 'Motivo',
  reasonPlaceholder = 'Explique a decisão (fica na auditoria)',
  confirmLabel = 'Confirmar',
  cancelLabel = 'Voltar',
  tone = 'danger',
  requireText,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const [typed, setTyped] = useState('');
  const [why, setWhy] = useState('');

  useEffect(() => {
    if (!open) {
      setTyped('');
      setWhy('');
      return undefined;
    }
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onCancel?.();
    };
    document.addEventListener('keydown', onKey);
    // Trava a rolagem de fundo enquanto o modal está aberto.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  const blocked = (Boolean(requireText) && typed.trim() !== requireText) || (Boolean(reason) && !why.trim());
  const icon = tone === 'danger' ? 'alert' : 'info';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel?.()}>
      <div className="modal modal-sm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className="modal-head">
          <span className={`modal-icon modal-icon-${tone}`} aria-hidden="true">
            <Icon name={icon} size={20} />
          </span>
          <h2 id="confirm-title">{title}</h2>
        </div>

        <div className="stack" style={{ gap: 12 }}>
          {description && <p className="muted" style={{ margin: 0 }}>{description}</p>}

          {impact && (
            <ul className="impact-list">
              {impact.map((item) => (
                <li key={item}>
                  <Icon name="check" size={15} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          )}

          {reason && (
            <label className="field">
              <span>{reasonLabel}</span>
              <textarea
                className="input"
                rows={2}
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder={reasonPlaceholder}
              />
              <span className="tiny muted">Obrigatório: fica registrado na auditoria e é visto pelo instrutor.</span>
            </label>
          )}

          {requireText && (
            <label className="field">
              <span>
                Digite <strong>{requireText}</strong> para confirmar
              </span>
              <input
                className="input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck="false"
              />
            </label>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => onConfirm(why.trim())}
            disabled={busy || blocked}
          >
            {busy && <Spinner size={15} />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Diálogo genérico para formulário (categoria, badge, senha).
 * `children` recebe o conteúdo; o formulário é submetido pelo botão do rodapé.
 */
export function Modal({
  open,
  title,
  description,
  onClose,
  onSubmit,
  submitLabel = 'Salvar',
  busy = false,
  children,
  footerExtra,
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !busy) onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose?.()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar" disabled={busy}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {description && <p className="muted" style={{ margin: 0 }}>{description}</p>}

        <form
          className="stack"
          style={{ gap: 14 }}
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit?.();
          }}
        >
          {children}
          <div className="modal-foot">
            {footerExtra}
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy && <Spinner size={15} />}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
