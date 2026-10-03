import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../../api/client.js';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { DataTable, SearchField, FilterSelect } from '../../components/admin/DataTable.jsx';
import { Panel } from '../../components/admin/ui.jsx';
import { PageHead } from '../../components/admin/AdminLayout.jsx';
import { Icon } from '../../components/Icon.jsx';
import { formatDateTime, timeAgo } from '../../utils/format.js';

/** Cores por tipo de ação, para o log ser lido sem ler cada linha inteira. */
const TONE = {
  'user.block': 'danger',
  'user.unblock': 'success',
  'user.role.change': 'info',
  'user.password.reset': 'info',
  'order.refund': 'danger',
  'order.cancel': 'warn',
  'order.confirm': 'success',
  'course.publish': 'success',
  'course.approve': 'success',
  'course.reject': 'warn',
  'course.unpublish': 'warn',
  'course.archive': 'warn',
  'course.delete': 'danger',
  'enrollment.cancel': 'danger',
  'enrollment.reactivate': 'success',
  'certificate.revoke': 'danger',
  'certificate.restore': 'success',
  'settings.update': 'info',
};

/**
 * Auditoria é só leitura por definição: é o registro do que aconteceu, e uma
 * tela que permitisse apagar o histórico protectoria nada.
 */
export default function AdminAuditPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const action = params.get('action') ?? '';
  const entityType = params.get('entityType') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [expanded, setExpanded] = useState(null);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === '' || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const { data, loading, error, refetch } = useApi(
    () => adminApi.auditLogs({ search: debounced, action, entityType, page, limit: 25 }),
    [debounced, action, entityType, page],
  );

  // As opções de ação vêm do backend: uma ação nova aparece no filtro sem
  // tocar nesta tela, e nada é oferecido que o servidor não aceite.
  const actionOptions = [
    { value: '', label: 'Todas as ações' },
    ...(data?.actions ?? []).map((a) => ({ value: a.value, label: a.label })),
  ];

  const entityOptions = [
    { value: '', label: 'Todos os objetos' },
    ...['user', 'course', 'order', 'enrollment', 'certificate', 'category', 'badge', 'review', 'post', 'comment', 'settings'].map(
      (t) => ({ value: t, label: t }),
    ),
  ];

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Auditoria"
        description="Quem fez o quê, quando, e qual era o estado antes e depois. Registro imutável."
      />

      <DataTable
        rows={data?.logs}
        loading={loading}
        error={error}
        onRetry={refetch}
        meta={data?.meta}
        onPageChange={(p) => setParam({ page: p })}
        emptyIcon="list"
        emptyTitle="Nenhum registro encontrado"
        emptyDescription="As ações administrativas aparecem aqui assim que acontecem."
        rowKey={(log) => log.id}
        filters={
          <>
            <SearchField value={search} onChange={setSearch} placeholder="Buscar no resumo ou no autor" width={300} />
            <FilterSelect value={action} onChange={(v) => setParam({ action: v })} options={actionOptions} label="Filtrar por ação" />
            <FilterSelect value={entityType} onChange={(v) => setParam({ entityType: v })} options={entityOptions} label="Filtrar por objeto" />
          </>
        }
        columns={[
          {
            key: 'when',
            header: 'Quando',
            render: (log) => (
              <div className="stack" style={{ gap: 2 }}>
                <span className="small nowrap">{timeAgo(log.createdAt)}</span>
                <span className="tiny muted nowrap">{formatDateTime(log.createdAt)}</span>
              </div>
            ),
          },
          {
            key: 'action',
            header: 'Ação',
            render: (log) => (
              <span className={`pill pill-${TONE[log.action] ?? 'neutral'}`}>
                {data?.actions?.find((a) => a.value === log.action)?.label ?? log.action}
              </span>
            ),
          },
          {
            key: 'actor',
            header: 'Autor',
            render: (log) => (
              <div className="stack" style={{ gap: 2 }}>
                <span className="small">{log.actorName ?? 'sistema'}</span>
                {log.actorEmail && <span className="tiny muted">{log.actorEmail}</span>}
              </div>
            ),
          },
          {
            key: 'summary',
            header: 'Resumo',
            render: (log) => (
              <div className="stack" style={{ gap: 4 }}>
                <span className="small">{log.summary}</span>
                <span className="tiny muted mono">
                  {log.entityType}
                  {log.entityId ? ` · ${String(log.entityId).slice(0, 8)}` : ''}
                </span>
              </div>
            ),
          },
          {
            key: 'diff',
            header: '',
            align: 'right',
            render: (log) =>
              log.before || log.after ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                >
                  <Icon name={expanded === log.id ? 'caretDown' : 'caretRight'} size={14} />
                  {expanded === log.id ? 'Fechar' : 'Detalhes'}
                </button>
              ) : null,
          },
        ]}
        footer={
          expanded ? <DiffPanel log={data.logs.find((l) => l.id === expanded)} /> : null
        }
      />
    </div>
  );
}

/** O antes/depois é o que transforma o log em prova. */
function DiffPanel({ log }) {
  if (!log) return null;
  const before = log.before ?? {};
  const after = log.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];

  if (!keys.length) return null;

  return (
    <Panel title="O que mudou">
      <div className="table-wrap">
        <table className="table table-admin">
          <thead>
            <tr>
              <th>Campo</th>
              <th>Antes</th>
              <th>Depois</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key}>
                <td className="mono small">{key}</td>
                <td className="small muted">{renderValue(before[key])}</td>
                <td className="small strong">{renderValue(after[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const renderValue = (value) => {
  if (value === undefined) return '—';
  if (value === null) return 'vazio';
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};
