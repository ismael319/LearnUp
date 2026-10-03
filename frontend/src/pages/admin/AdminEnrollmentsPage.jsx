import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi, certificatesApi } from '../../api/client.js';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { DataTable, SearchField, FilterSelect } from '../../components/admin/DataTable.jsx';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog.jsx';
import { StatusTag, SummaryBar, Panel } from '../../components/admin/ui.jsx';
import { PageHead } from '../../components/admin/AdminLayout.jsx';
import { Icon } from '../../components/Icon.jsx';
import { formatNumber, formatDate } from '../../utils/format.js';

const ENROLLMENT_LABEL = { active: 'Ativa', canceled: 'Cancelada', refunded: 'Reembolsada' };
const COURSE_STATUS_LABEL = { draft: 'Rascunho', in_review: 'Em análise', published: 'Publicado', archived: 'Arquivado' };

const STATUS_OPTIONS = [
  { value: '', label: 'Todas as matrículas' },
  { value: 'active', label: 'Ativas' },
  { value: 'canceled', label: 'Canceladas' },
  { value: 'refunded', label: 'Reembolsadas' },
];

const ORDER_OPTIONS = [
  { value: 'recent', label: 'Mais recentes' },
  { value: 'progress', label: 'Maior progresso' },
  { value: 'course', label: 'Por curso' },
];

export default function AdminEnrollmentsPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'certificates' ? 'certificates' : 'enrollments');
  const [notice, setNotice] = useState(null);

  const setTabAndUrl = (next) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
    setTab(next);
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Matrículas e certificados"
        description="Cancelar nunca apaga o histórico: a linha fica e o acesso é retirado."
      />

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'enrollments'}
              className={`tab ${tab === 'enrollments' ? 'active' : ''}`}
          onClick={() => setTabAndUrl('enrollments')}
        >
          Matrículas
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'certificates'}
              className={`tab ${tab === 'certificates' ? 'active' : ''}`}
          onClick={() => setTabAndUrl('certificates')}
        >
          Certificados
        </button>
      </div>

      {tab === 'enrollments' ? (
        <EnrollmentsTab notice={notice} onNotice={setNotice} params={params} setParams={setParams} />
      ) : (
        <CertificatesTab notice={notice} onNotice={setNotice} params={params} setParams={setParams} />
      )}
    </div>
  );
}

function EnrollmentsTab({ notice, onNotice, params, setParams }) {
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounced(search);
  const status = params.get('status') ?? '';
  const orderBy = params.get('orderBy') ?? 'recent';
  const page = Number(params.get('page') ?? 1);
  const [action, setAction] = useState(null);
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
    () => adminApi.enrollments({ search: debounced, status, orderBy, page, limit: 20 }),
    [debounced, status, orderBy, page],
  );

  const run = async (fn, message) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAction(null);
      onNotice({ message });
      refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      {error && <div className="alert alert-danger">{error.message}</div>}

      {data?.summary && (
        <Panel>
          <SummaryBar
            items={[
              { label: 'ativas', value: formatNumber(data.summary.active) },
              { label: 'canceladas', value: formatNumber(data.summary.canceled) },
              { label: 'reembolsadas', value: formatNumber(data.summary.refunded) },
              { label: 'concluídas', value: formatNumber(data.summary.completed) },
            ]}
          />
        </Panel>
      )}

      <DataTable
        rows={data?.enrollments}
        loading={loading}
        error={loadError}
        onRetry={refetch}
        notice={notice}
        onDismissNotice={() => onNotice(null)}
        meta={data?.meta}
        onPageChange={(p) => setParam({ page: p })}
        emptyIcon="cap"
        emptyTitle="Nenhuma matrícula encontrada"
        filters={
          <>
            <SearchField value={search} onChange={setSearch} placeholder="Buscar aluno ou curso" width={260} />
            <FilterSelect value={status} onChange={(v) => setParam({ status: v })} options={STATUS_OPTIONS} label="Filtrar por status" />
            <FilterSelect value={orderBy} onChange={(v) => setParam({ orderBy: v })} options={ORDER_OPTIONS} label="Ordenar" />
          </>
        }
        columns={[
          {
            key: 'student',
            header: 'Aluno',
            render: (e) => (
              <div className="stack" style={{ gap: 2 }}>
                <span>{e.userName}</span>
                <span className="tiny muted">{e.userEmail}</span>
              </div>
            ),
          },
          {
            key: 'course',
            header: 'Curso',
            render: (e) => (
              <div className="stack" style={{ gap: 2 }}>
                <span className="truncate">{e.courseTitle}</span>
                <StatusTag status={e.courseStatus} map={COURSE_STATUS_LABEL} />
              </div>
            ),
          },
          {
            key: 'progress',
            header: 'Progresso',
            render: (e) => (
              <div className="stack" style={{ gap: 4, minWidth: 120 }}>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${Math.min(100, e.progressPercent ?? 0)}%` }} />
                </div>
                <span className="tiny muted">
                  {formatNumber(e.completedLessons)}/{formatNumber(e.totalLessons)} aulas
                  {e.completedAt ? ' · concluído' : ''}
                </span>
              </div>
            ),
          },
          { key: 'status', header: 'Status', render: (e) => <StatusTag status={e.status} map={ENROLLMENT_LABEL} /> },
          {
            key: 'certificate',
            header: 'Certificado',
            render: (e) =>
              e.certificateCount > 0 ? (
                <span className="row" style={{ gap: 4 }}>
                  <Icon name="certificate" size={15} /> {e.certificateCount}
                </span>
              ) : (
                <span className="tiny muted">—</span>
              ),
          },
          {
            key: 'enrolled',
            header: 'Matrícula',
            render: (e) => <span className="small nowrap">{formatDate(e.enrolledAt)}</span>,
          },
          {
            key: 'actions',
            header: 'Ações',
            align: 'right',
            render: (e) => (
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                {e.status === 'active' ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAction({ type: 'cancel', enrollment: e })}>
                    Cancelar acesso
                  </button>
                ) : e.status === 'canceled' ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => run(() => adminApi.reactivateEnrollment(e.id), 'Matrícula reativada com o progresso preservado.')}
                    disabled={busy}
                  >
                    Reativar
                  </button>
                ) : (
                  // Reembolsada não volta: o aluno precisa comprar de novo.
                  <span className="tiny muted" title="Matrícula reembolsada não pode ser reativada">
                    exigir nova compra
                  </span>
                )}
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={action?.type === 'cancel'}
        title="Cancelar acesso do aluno"
        description={action ? `${action.enrollment.userName} — ${action.enrollment.courseTitle}` : ''}
        impact={[
          'O aluno perde o acesso ao conteúdo imediatamente',
          'A sessão aberta do aluno é encerrada',
          'O certificado do curso é revogado, se existir',
          'Progresso, aulas concluídas e quizzes são preservados',
          'Reativar depois devolve o acesso com o progresso intacto',
        ]}
        reason
        reasonLabel="Motivo do cancelamento"
        confirmLabel="Cancelar acesso"
        busy={busy}
        onCancel={() => setAction(null)}
        onConfirm={(reason) =>
          run(() => adminApi.cancelEnrollment(action.enrollment.id, reason), 'Acesso do aluno cancelado.')
        }
      />
    </div>
  );
}

function CertificatesTab({ notice, onNotice, params, setParams }) {
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounced(search);
  const revokedParam = params.get('revoked');
  // Sem o parâmetro, o backend recebe `undefined` e devolve todos. Se passasse
  // `false` por engano, a tela mostraria só certificados válidos e o admin
  // bateria na parede procurando o revogado que "sumiu".
  const revoked = revokedParam === null || revokedParam === '' ? undefined : revokedParam === 'true';
  const page = Number(params.get('page') ?? 1);
  const [action, setAction] = useState(null);
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
    () => adminApi.certificates({ search: debounced, revoked, page, limit: 20 }),
    [debounced, revokedParam, page],
  );

  const run = async (fn, message) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAction(null);
      onNotice({ message });
      refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      {error && <div className="alert alert-danger">{error.message}</div>}

      {data?.summary && (
        <Panel>
          <SummaryBar
            items={[
              { label: 'emitidos', value: formatNumber(data.summary.total) },
              { label: 'válidos', value: formatNumber(data.summary.total - data.summary.revoked) },
              { label: 'revogados', value: formatNumber(data.summary.revoked) },
            ]}
          />
        </Panel>
      )}

      <DataTable
        rows={data?.certificates}
        loading={loading}
        error={loadError}
        onRetry={refetch}
        notice={notice}
        onDismissNotice={() => onNotice(null)}
        meta={data?.meta}
        onPageChange={(p) => setParam({ page: p })}
        emptyIcon="certificate"
        emptyTitle="Nenhum certificado encontrado"
        filters={
          <>
            <SearchField value={search} onChange={setSearch} placeholder="Buscar por aluno ou código" width={260} />
            <FilterSelect
              value={revokedParam}
              onChange={(v) => setParam({ revoked: v })}
              options={[
                { value: '', label: 'Todos os certificados' },
                { value: 'false', label: 'Válidos' },
                { value: 'true', label: 'Revogados' },
              ]}
              label="Filtrar por situação"
            />
          </>
        }
        columns={[
          {
            key: 'code',
            header: 'Código',
            render: (c) => (
              <div className="stack" style={{ gap: 2 }}>
                <span className="mono small">{c.code}</span>
                <a
                  className="tiny"
                  href={certificatesApi.downloadUrl(c.code)}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  abrir PDF
                </a>
              </div>
            ),
          },
          {
            key: 'user',
            header: 'Aluno',
            render: (c) => (
              <div className="stack" style={{ gap: 2 }}>
                <span>{c.userName}</span>
                <span className="tiny muted">{c.userEmail}</span>
              </div>
            ),
          },
          { key: 'course', header: 'Curso', render: (c) => <span className="truncate">{c.courseTitle}</span> },
          {
            key: 'score',
            header: 'Nota',
            align: 'right',
            render: (c) => <span className="nowrap">{c.finalScore ?? '—'}</span>,
          },
          { key: 'issued', header: 'Emitido', render: (c) => <span className="small nowrap">{formatDate(c.issuedAt)}</span> },
          {
            key: 'status',
            header: 'Situação',
            render: (c) =>
              c.revokedAt ? (
                <span className="stack" style={{ gap: 2 }}>
                  <StatusTag status="revoked" />
                  {c.revokedReason && <span className="tiny muted">{c.revokedReason}</span>}
                </span>
              ) : (
                <StatusTag status="valid" />
              ),
          },
          {
            key: 'actions',
            header: 'Ações',
            align: 'right',
            render: (c) => (
              <button
                type="button"
                className={`btn btn-sm ${c.revokedAt ? 'btn-secondary' : 'btn-danger'}`}
                onClick={() => setAction(c)}
              >
                {c.revokedAt ? 'Restaurar' : 'Revogar'}
              </button>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={Boolean(action)}
        title={action?.revokedAt ? 'Restaurar certificado' : 'Revogar certificado'}
        description={action ? `${action.code} — ${action.userName} (${action.courseTitle})` : ''}
        impact={
          action?.revokedAt
            ? ['O certificado volta a valer', 'A verificação pública passa a considerá-lo válido']
            : ['A verificação pública passa a reprovar o código', 'O aluno perde o documento, mas a conclusão do curso continua registrada']
        }
        reason={action && !action.revokedAt}
        reasonLabel="Motivo da revogação"
        confirmLabel={action?.revokedAt ? 'Restaurar certificado' : 'Revogar certificado'}
        tone={action?.revokedAt ? 'primary' : 'danger'}
        busy={busy}
        onCancel={() => setAction(null)}
        onConfirm={(reason) =>
          run(
            () => adminApi.certificate(action.id, { revoked: !action.revokedAt, reason: reason || undefined }),
            action.revokedAt ? 'Certificado restaurado.' : 'Certificado revogado.',
          )
        }
      />
    </div>
  );
}
