import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../../api/client.js';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { DataTable, SearchField, FilterSelect } from '../../components/admin/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../components/admin/ConfirmDialog.jsx';
import { StatusTag, SummaryBar, Panel } from '../../components/admin/ui.jsx';
import { PageHead } from '../../components/admin/AdminLayout.jsx';
import { Icon } from '../../components/Icon.jsx';
import { formatCurrency, formatDate, formatDateTime } from '../../utils/format.js';

const STATUS_LABEL = {
  pending: 'Pendente',
  paid: 'Pago',
  failed: 'Falhou',
  refunded: 'Reembolsado',
  canceled: 'Cancelado',
};

const METHOD_LABEL = { pix: 'Pix', card: 'Cartão', paypal: 'PayPal', free: 'Gratuito' };

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'pending', label: 'Pendentes' },
  { value: 'paid', label: 'Pagos' },
  { value: 'refunded', label: 'Reembolsados' },
  { value: 'canceled', label: 'Cancelados' },
  { value: 'failed', label: 'Falharam' },
];

const METHOD_OPTIONS = [
  { value: '', label: 'Todos os meios' },
  { value: 'pix', label: 'Pix' },
  { value: 'card', label: 'Cartão' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'free', label: 'Gratuito' },
];

export default function AdminOrdersPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounced(search);
  const status = params.get('status') ?? '';
  const method = params.get('method') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? 1);

  const [action, setAction] = useState(null);
  const [detail, setDetail] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === '' || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const { data, loading, error: loadError, refetch } = useApi(
    () => adminApi.orders({ search: debounced, status, method, from, to, page, limit: 20 }),
    [debounced, status, method, from, to, page],
  );

  const run = async (fn, successMessage) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAction(null);
      setNotice({ message: successMessage });
      refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Pedidos" description="Conferir pagamentos pendentes, reembolsar e cancelar." />

      {error && (
        <div className="alert alert-danger" role="alert">
          <div className="grow">{error.message}</div>
        </div>
      )}

      {data?.summary && (
        <Panel>
          <SummaryBar
            items={[
              { label: 'total de pedidos', value: data.summary.total },
              { label: 'receita paga', value: formatCurrency(data.summary.paidCents) },
              { label: 'reembolsado', value: formatCurrency(data.summary.refundedCents) },
              { label: 'pendentes', value: data.summary.pending },
              ...(data.summary.byStatus ?? []).map((s) => ({ label: STATUS_LABEL[s.status] ?? s.status, value: s.total })),
            ]}
          />
        </Panel>
      )}

      <DataTable
        rows={data?.orders}
        loading={loading}
        error={loadError}
        onRetry={refetch}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        meta={data?.meta}
        onPageChange={(p) => setParam({ page: p })}
        emptyIcon="wallet"
        emptyTitle="Nenhum pedido encontrado"
        emptyDescription="Ajuste os filtros para ver outros pedidos."
        filters={
          <>
            <SearchField value={search} onChange={setSearch} placeholder="Buscar aluno ou curso" width={260} />
            <FilterSelect value={status} onChange={(v) => setParam({ status: v })} options={STATUS_OPTIONS} label="Filtrar por status" />
            <FilterSelect value={method} onChange={(v) => setParam({ method: v })} options={METHOD_OPTIONS} label="Filtrar por meio de pagamento" />
            <label className="row" style={{ gap: 6 }}>
              <span className="tiny muted nowrap">de</span>
              <input
                className="input"
                type="date"
                value={from}
                onChange={(e) => setParam({ from: e.target.value })}
                aria-label="Data inicial"
              />
            </label>
            <label className="row" style={{ gap: 6 }}>
              <span className="tiny muted nowrap">até</span>
              <input
                className="input"
                type="date"
                value={to}
                onChange={(e) => setParam({ to: e.target.value })}
                aria-label="Data final"
              />
            </label>
          </>
        }
        columns={[
          {
            key: 'order',
            header: 'Pedido',
            render: (o) => (
              <div className="stack" style={{ gap: 2 }}>
                <button type="button" className="link" onClick={() => setDetail(o)}>
                  {o.id.slice(0, 8)}
                </button>
                <span className="tiny muted">{formatDateTime(o.createdAt)}</span>
              </div>
            ),
          },
          {
            key: 'course',
            header: 'Curso',
            render: (o) => (
              <div className="stack" style={{ gap: 2 }}>
                <span className="truncate">{o.courseTitle}</span>
                <span className="tiny muted">{o.userName}</span>
              </div>
            ),
          },
          { key: 'method', header: 'Meio', render: (o) => <span className="small">{METHOD_LABEL[o.method] ?? o.method}</span> },
          {
            key: 'amount',
            header: 'Valor',
            align: 'right',
            render: (o) => <span className="nowrap strong">{formatCurrency(o.amountCents)}</span>,
          },
          { key: 'status', header: 'Status', render: (o) => <StatusTag status={o.status} map={STATUS_LABEL} /> },
          {
            key: 'enrollment',
            header: 'Matrícula',
            render: (o) => (o.enrollmentId ? <StatusTag status={o.enrollmentStatus} /> : <span className="tiny muted">—</span>),
          },
          {
            key: 'actions',
            header: 'Ações',
            align: 'right',
            render: (o) => (
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                {o.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setAction({ type: 'confirm', order: o })}
                      disabled={busy}
                      title="Marcar como pago manualmente (só no provedor mock)"
                    >
                      Confirmar
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAction({ type: 'cancel', order: o })}>
                      Cancelar
                    </button>
                  </>
                )}
                {o.status === 'paid' && (
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => setAction({ type: 'refund', order: o })}>
                    Reembolsar
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setDetail(o)}
                  aria-label={`Ver detalhes do pedido ${o.id.slice(0, 8)}`}
                  title="Detalhes"
                >
                  <Icon name="caretRight" size={16} />
                </button>
              </div>
            ),
          },
        ]}
      />

      <OrderActionDialog
        action={action}
        busy={busy}
        onCancel={() => setAction(null)}
        onConfirm={(reason) => {
          const { type, order } = action;
          const map = {
            refund: [() => adminApi.refundOrder(order.id, reason), `Pedido ${order.id.slice(0, 8)} reembolsado.`],
            cancel: [() => adminApi.cancelOrder(order.id, reason), `Pedido ${order.id.slice(0, 8)} cancelado.`],
            confirm: [() => adminApi.confirmOrder(order.id), `Pedido ${order.id.slice(0, 8)} confirmado.`],
          };
          const [fn, message] = map[type];
          return run(fn, message);
        }}
      />

      <OrderDetail order={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/**
 * Um diálogo por ação porque as três não são o mesmo gesto: reembolso destrói
 * acesso e certificado, cancelamento só fecha um pedido que nunca foi pago, e
 * confirmação é o caminho seguro para um pagamento que o gateway não avisou.
 */
function OrderActionDialog({ action, busy, onCancel, onConfirm }) {
  const copy = {
    refund: {
      title: 'Reembolsar pedido',
      description: 'O valor volta para o aluno. Nos pedidos de demonstração, o provedor é o mock: não há transferência real.',
      impact: [
        'A matrícula vira "reembolsada" e o aluno perde o acesso ao conteúdo',
        'O certificado do curso é revogado, se já tiver sido emitido',
        'O progresso e as aulas concluídas são preservados no histórico',
        'Os pontos de gamificação não são descontados',
        'O pedido não pode ser reembolsado de novo',
      ],
      confirm: 'Reembolsar',
      tone: 'danger',
      reason: true,
    },
    cancel: {
      title: 'Cancelar pedido',
      description: 'Use para pedidos que nunca foram pagos (o aluno abandonou o checkout, por exemplo).',
      impact: ['O pedido vira "cancelado"', 'Nenhuma matrícula é afetada, porque pagamento pendente não gera matrícula'],
      confirm: 'Cancelar pedido',
      tone: 'warn',
      reason: true,
    },
    confirm: {
      title: 'Confirmar pagamento manualmente',
      description:
        'Use quando o webhook do gateway não chegou. Só funciona com PAYMENT_PROVIDER=mock: em produção, o pagamento é confirmado pelo gateway.',
      impact: ['O pedido vira "pago"', 'A matrícula é criada e o aluno passa a ter acesso'],
      confirm: 'Confirmar como pago',
      tone: 'primary',
    },
  }[action?.type] ?? {};

  return (
    <ConfirmDialog
      open={Boolean(action)}
      title={copy.title}
      description={copy.description}
      impact={copy.impact}
      reason={copy.reason}
      confirmLabel={copy.confirm}
      tone={copy.tone}
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function OrderDetail({ order, onClose }) {
  const { data, loading, error } = useApi(() => (order ? adminApi.order(order.id) : null), [order?.id], {
    skip: !order,
  });

  return (
    <Modal open={Boolean(order)} title={order ? `Pedido ${order.id.slice(0, 8)}` : ''} onClose={onClose} submitLabel="Fechar" onSubmit={onClose}>
      {loading ? (
        <p className="muted small">Carregando...</p>
      ) : error ? (
        <p className="muted small">{error.message}</p>
      ) : data ? (
        <div className="stack" style={{ gap: 14 }}>
          <SummaryBar
            items={[
              { label: 'valor', value: formatCurrency(data.order.amountCents) },
              { label: 'meio', value: METHOD_LABEL[data.order.method] ?? data.order.method },
              { label: 'aulas concluídas', value: `${data.studentProgress.completed}/${data.studentProgress.total}` },
            ]}
          />
          <p className="small muted" style={{ margin: 0 }}>
            {data.order.userName} ({data.order.userEmail}) · {data.order.courseTitle}
          </p>
          <div className="row wrap" style={{ gap: 8 }}>
            <StatusTag status={data.order.status} map={STATUS_LABEL} />
            {data.order.enrollmentId && <StatusTag status={data.order.enrollmentStatus} />}
            {data.order.providerRef && <span className="tiny muted">ref. gateway: {data.order.providerRef}</span>}
          </div>
          {data.events.length > 0 && (
            <Panel title="Eventos do gateway">
              <ul className="stack small" style={{ gap: 6 }}>
                {data.events.map((e) => (
                  <li key={e.id} className="row-between">
                    <span>{e.eventType}</span>
                    <span className="muted nowrap">{formatDate(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
