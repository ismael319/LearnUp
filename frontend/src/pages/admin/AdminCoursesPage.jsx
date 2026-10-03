import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi, coursesApi } from '../../api/client.js';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { DataTable, SearchField, FilterSelect } from '../../components/admin/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../components/admin/ConfirmDialog.jsx';
import { Panel, StatusTag, SummaryBar } from '../../components/admin/ui.jsx';
import { PageHead } from '../../components/admin/AdminLayout.jsx';
import { Icon } from '../../components/Icon.jsx';
import { formatPrice, formatCurrency, formatNumber, formatDate, formatDuration } from '../../utils/format.js';

const STATUS_OPTIONS = [
  { value: '', label: 'Todos os status' },
  { value: 'in_review', label: 'Em análise' },
  { value: 'published', label: 'Publicados' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'archived', label: 'Arquivados' },
];

const ORDER_OPTIONS = [
  { value: 'recent', label: 'Mais recentes' },
  { value: 'students', label: 'Mais alunos' },
  { value: 'revenue', label: 'Maior receita' },
];

const STATUS_LABEL = {
  draft: 'Rascunho',
  in_review: 'Em análise',
  published: 'Publicado',
  archived: 'Arquivado',
};

/**
 * Ações permitidas por status.
 *
 * `approve` e `publish` resultam em `published` (aprovar já publica, não existe
 * um estado "aprovado" separado), e `restore` devolve o curso para `draft` — não
 * para publicado. A interface diz o que o backend realmente faz; prometer
 * "volta ao ar" no restore seria mentira.
 */
const ACTIONS = {
  draft: [
    { action: 'publish', label: 'Publicar', tone: 'primary', impact: ['O curso passa a aparecer na vitrine', 'Novos alunos podem se matricular'] },
    { action: 'archive', label: 'Arquivar', tone: 'ghost' },
  ],
  in_review: [
    { action: 'approve', label: 'Aprovar e publicar', tone: 'primary', impact: ['O curso passa a aparecer na vitrine', 'Novos alunos podem se matricular'] },
    { action: 'reject', label: 'Devolver', tone: 'ghost' },
  ],
  published: [{ action: 'unpublish', label: 'Despublicar', tone: 'ghost' }],
  archived: [{ action: 'restore', label: 'Restaurar', tone: 'primary', impact: ['O curso volta para rascunho', 'Ele ainda não aparece publicamente'] }],
};

/** Efeitos que o admin precisa conhecer antes de confirmar. */
const IMPACT = {
  unpublish: [
    'O curso sai das listagens públicas',
    'Alunos já matriculados continuam com acesso',
    'Novos alunos não conseguem se matricular',
  ],
  archive: [
    'O curso deixa de ser exibido publicamente',
    'Matrículas ativas continuam válidas',
    'Nenhum aluno perde o que pagou',
  ],
  reject: ['O instrutor recebe o motivo e pode reenviar para análise'],
};

const ACTION_LABEL = {
  publish: 'Publicar agora',
  approve: 'Aprovar e publicar',
  reject: 'Devolver ao instrutor',
  unpublish: 'Despublicar',
  archive: 'Arquivar',
  restore: 'Restaurar para rascunho',
};

const ACTION_PHRASE = {
  publish: 'publicar o curso',
  approve: 'aprovar e publicar o curso',
  reject: 'devolver o curso ao instrutor',
  unpublish: 'despublicar o curso',
  archive: 'arquivar o curso',
  restore: 'restaurar o curso',
};

export default function AdminCoursesPage() {
  // O filtro vive na URL: o link "4 curso(s) aguardando aprovação" da visão
  // geral precisa abrir esta tela já filtrada, e recarregar a página não pode
  // perder a busca em andamento.
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounced(search);
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);
  const orderBy = params.get('orderBy') ?? 'recent';

  const [pending, setPending] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [detail, setDetail] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === '' || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    }
    // Qualquer filtro novo volta para a primeira página: a página 7 do filtro
    // anterior não tem nada a ver com o filtro novo.
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const { data, loading, error, refetch } = useApi(
    () => adminApi.courses({ search: debounced, status, page, limit: 20, orderBy }),
    [debounced, status, page, orderBy],
  );
  const { data: categoryData } = useApi(() => coursesApi.categories(), []);
  const { data: instructorData } = useApi(() => coursesApi.instructors(), []);

  const run = async (fn, successMessage) => {
    setBusy(true);
    try {
      await fn();
      setPending(null);
      setDeleting(null);
      if (successMessage) setNotice({ message: successMessage });
      refetch();
    } finally {
      setBusy(false);
    }
  };

  const categories = [{ id: '', name: 'Todas as categorias' }, ...(categoryData?.categories ?? [])];
  const instructors = [{ id: '', name: 'Todos os instrutores' }, ...(instructorData?.instructors ?? [])];

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Cursos"
        description="Aprovar, publicar e arquivar. Alunos só enxergam o que está publicado."
        actions={
          <button type="button" className="btn btn-ghost btn-sm" onClick={refetch}>
            <Icon name="search" size={15} /> Atualizar
          </button>
        }
      />

      <DataTable
        rows={data?.courses}
        loading={loading}
        error={error}
        onRetry={refetch}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        meta={data?.meta}
        onPageChange={(p) => setParam({ page: p })}
        emptyIcon="book"
        emptyTitle="Nenhum curso encontrado"
        emptyDescription="Ajuste os filtros ou a busca para ver outros cursos."
        rowKey={(c) => c.id}
        filters={
          <>
            <SearchField value={search} onChange={setSearch} placeholder="Buscar por título ou instrutor" width={280} />
            <FilterSelect
              value={status}
              onChange={(v) => setParam({ status: v })}
              options={STATUS_OPTIONS}
              label="Filtrar por status"
            />
            <FilterSelect
              value={params.get('categoryId') ?? ''}
              onChange={(v) => setParam({ categoryId: v })}
              options={categories.map((c) => ({ value: c.id, label: c.name }))}
              label="Filtrar por categoria"
            />
            <FilterSelect
              value={params.get('instructorId') ?? ''}
              onChange={(v) => setParam({ instructorId: v })}
              options={instructors.map((i) => ({ value: i.id, label: i.name }))}
              label="Filtrar por instrutor"
            />
            <FilterSelect
              value={orderBy}
              onChange={(v) => setParam({ orderBy: v })}
              options={ORDER_OPTIONS}
              label="Ordenar"
            />
          </>
        }
        columns={[
          {
            key: 'title',
            header: 'Curso',
            render: (c) => (
              <div className="stack" style={{ gap: 2 }}>
                <button type="button" className="link" onClick={() => setDetail(c)}>
                  {c.title}
                </button>
                <span className="tiny muted">
                  {c.instructorName} · {c.categoryName ?? 'Sem categoria'}
                </span>
              </div>
            ),
          },
          { key: 'status', header: 'Status', render: (c) => <StatusTag status={c.status} map={STATUS_LABEL} /> },
          {
            key: 'price',
            header: 'Preço',
            align: 'right',
            render: (c) => <span className="nowrap">{formatPrice(c.priceCents)}</span>,
          },
          {
            key: 'students',
            header: 'Alunos',
            align: 'right',
            render: (c) => <span className="nowrap">{formatNumber(c.studentsCount ?? 0)}</span>,
          },
          {
            key: 'rating',
            header: 'Nota',
            align: 'right',
            render: (c) => (
              <span className="nowrap">
                {c.ratingAvg ? Number(c.ratingAvg).toFixed(1).replace('.', ',') : '—'}
                <span className="tiny muted"> ({formatNumber(c.reviewCount ?? 0)})</span>
              </span>
            ),
          },
          {
            key: 'actions',
            header: 'Ações',
            align: 'right',
            render: (c) => (
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                {ACTIONS[c.status]?.map((a) => (
                  <button
                    key={a.action}
                    type="button"
                    className={`btn btn-sm ${a.tone === 'primary' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setPending({ course: c, action: a.action })}
                  >
                    {a.label}
                  </button>
                ))}
                {/*
                  * O backend recusa exclusão quando há matrícula **ou** pedido,
                  * porque qualquer um dos dois já levaria junto o histórico do
                  * aluno. Esconder o botão evita oferecer um caminho que só
                  * devolve 409.
                 */}
                {c.studentsCount > 0 || c.orderCount > 0 ? (
                  <span
                    className="icon-btn icon-btn-muted"
                    title={
                      c.studentsCount > 0
                        ? 'Curso com matrículas: arquive em vez de excluir'
                        : 'Curso com pedidos: arquive em vez de excluir'
                    }
                    aria-label="Exclusão indisponível: o curso tem matrículas ou pedidos"
                  >
                    <Icon name="trash" size={16} />
                  </span>
                ) : (
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    title="Excluir curso"
                    aria-label={`Excluir ${c.title}`}
                    onClick={() => setDeleting(c)}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      <ConfirmDialog
        open={Boolean(pending)}
        title={pending ? `Confirmar: ${ACTION_PHRASE[pending.action]}` : ''}
        description={pending ? `"${pending.course.title}" — a ação fica registrada na auditoria.` : ''}
        impact={pending ? pending.impact ?? IMPACT[pending.action] : null}
        reason={pending?.action === 'publish' || pending?.action === 'approve' ? undefined : true}
        reasonLabel={pending?.action === 'reject' ? 'Por que devolver?' : 'Motivo'}
        confirmLabel={pending ? ACTION_LABEL[pending.action] : 'Confirmar'}
        tone={pending && ['unpublish', 'archive'].includes(pending.action) ? 'warn' : 'primary'}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(reason) =>
          run(
            () => adminApi.transitionCourse(pending.course.id, pending.action, reason || undefined),
            `Curso: ${ACTION_PHRASE[pending.action]}.`,
          )
        }
      />

      <DeleteCourseDialog
        course={deleting}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={(reason) => run(() => adminApi.deleteCourse(deleting.id, reason), 'Curso excluído.')}
      />

      <CourseDetail course={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/** Exclusão é definitiva: exige motivo e avisa o que some junto. */
function DeleteCourseDialog({ course, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');

  return (
    <Modal
      open={Boolean(course)}
      title="Excluir curso"
      description={
        course
          ? 'Excluir é definitivo e remove módulos, aulas, avaliações e pedidos vinculados. Para preservar o histórico do aluno, prefira arquivar.'
          : ''
      }
      onClose={onCancel}
      onSubmit={() => onConfirm(reason)}
      submitLabel="Excluir definitivamente"
      busy={busy}
    >
      {course && (
        <>
          <div className="callout callout-danger">
            <strong>{course.title}</strong>
            <div className="small">
              {formatNumber(course.moduleCount ?? 0)} módulo(s) · {formatNumber(course.lessonCount ?? 0)} aula(s) ·{' '}
              {formatCurrency(course.revenueCents)} já arrecadados
            </div>
          </div>
          <label className="field">
            <span>Motivo (vai para a auditoria)</span>
            <textarea
              className="input"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ex.: conteúdo duplicado enviado por engano"
            />
          </label>
        </>
      )}
    </Modal>
  );
}

/** Ficha rápida do curso, sem sair da listagem. */
function CourseDetail({ course, onClose }) {
  const { data, loading } = useApi(() => (course ? adminApi.course(course.id) : null), [course?.id], {
    skip: !course,
  });

  return (
    <Modal open={Boolean(course)} title={course?.title ?? ''} onClose={onClose} submitLabel="Fechar" onSubmit={onClose}>
      {loading ? (
        <p className="muted small">Carregando...</p>
      ) : data ? (
        <div className="stack" style={{ gap: 12 }}>
          <SummaryBar
            items={[
              { label: 'preço', value: formatPrice(data.course.priceCents) },
              { label: 'receita paga', value: formatCurrency(data.revenue.paidCents) },
              { label: 'pedidos pagos', value: formatNumber(data.revenue.paidOrders) },
              { label: 'reembolsados', value: formatNumber(data.revenue.refundedOrders) },
            ]}
          />
          <p className="small muted" style={{ margin: 0 }}>
            {data.course.instructorName} · {data.course.categoryName ?? 'Sem categoria'} ·{' '}
            {formatDuration(data.course.durationMinutes)}
          </p>
          {data.course.description && (
            <p className="muted small" style={{ margin: 0 }}>
              {data.course.description}
            </p>
          )}
          <div className="row wrap" style={{ gap: 8 }}>
            <StatusTag status={data.course.status} map={STATUS_LABEL} />
            {data.course.publishedAt && <span className="small muted">publicado em {formatDate(data.course.publishedAt)}</span>}
            {data.course.approvedAt && (
              <span className="small muted">
                aprovado em {formatDate(data.course.approvedAt)}
                {data.course.approvedByName ? ` por ${data.course.approvedByName}` : ''}
              </span>
            )}
          </div>
          {data.enrollments?.length > 0 && (
            <details>
              <summary className="small">Últimas matrículas ({data.enrollments.length})</summary>
              <ul className="stack small" style={{ gap: 4, marginTop: 8 }}>
                {data.enrollments.slice(0, 10).map((e) => (
                  <li key={e.id} className="row-between">
                    <span>{e.userName}</span>
                    <span className="muted">{formatDate(e.enrolledAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
