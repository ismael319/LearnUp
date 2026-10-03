import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../../api/client.js';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { DataTable, SearchField, FilterSelect } from '../../components/admin/DataTable.jsx';
import { ConfirmDialog } from '../../components/admin/ConfirmDialog.jsx';
import { StatusTag, SummaryBar, Panel, BarList } from '../../components/admin/ui.jsx';
import { PageHead } from '../../components/admin/AdminLayout.jsx';
import { Icon } from '../../components/Icon.jsx';
import { formatNumber, formatDate } from '../../utils/format.js';

/**
 * A tela de moderação abre com a fila de occludedos, não com tudo: a primeira
 * pergunta de quem entra aqui é "o que está errado agora".
 *
 * Ocultar é o padrão e aparece primeiro em todo botão. Excluir fica escondido
 * atrás de um segundo clique porque é irreversível e leva as respostas junto.
 */
export default function AdminModerationPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'hidden';
  const [notice, setNotice] = useState(null);
  const [action, setAction] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Contadores e resumos dependem da ação recién-feita: sem recarregar a lista,
  // o item que o admin acabou de ocultar continuaria na fila.
  const [reloadKey, setReloadKey] = useState(0);

  const setTab = (next) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
  };

  const run = async (fn, message) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setAction(null);
      if (message) setNotice({ message });
      setReloadKey((k) => k + 1);
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Moderação"
        description="Ocultar tira do público e é reversível. Excluir é definitivo — use só em último caso."
      />

      {error && <div className="alert alert-danger">{error.message}</div>}

      <div className="tabs" role="tablist">
        {[
          { id: 'hidden', label: 'Fila de ocultos' },
          { id: 'reviews', label: 'Avaliações' },
          { id: 'posts', label: 'Discussões' },
          { id: 'comments', label: 'Comentários' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
                className={`tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'hidden' ? (
        <HiddenQueue notice={notice} onNotice={setNotice} onAction={setAction} reloadKey={reloadKey} />
      ) : tab === 'reviews' ? (
        <ReviewsTab
          notice={notice}
          onNotice={setNotice}
          onAction={setAction}
          params={params}
          setParams={setParams}
          reloadKey={reloadKey}
        />
      ) : tab === 'posts' ? (
        <PostsTab
          notice={notice}
          onNotice={setNotice}
          onAction={setAction}
          params={params}
          setParams={setParams}
          reloadKey={reloadKey}
        />
      ) : (
        <CommentsTab
          notice={notice}
          onNotice={setNotice}
          onAction={setAction}
          params={params}
          setParams={setParams}
          reloadKey={reloadKey}
        />
      )}

      <ModerationActionDialog action={action} busy={busy} run={run} onClose={() => setAction(null)} />
    </div>
  );
}

/** Tudo que está oculto, numa fila só, porque é a fila que precisa de decisão. */
function HiddenQueue({ notice, onNotice, onAction, reloadKey }) {
  const { data: reviews } = useApi(
    () => adminApi.reviews({ visibility: 'hidden', orderBy: 'recent', limit: 20 }),
    [reloadKey],
  );
  const { data: posts } = useApi(() => adminApi.posts({ visibility: 'hidden', limit: 20 }), [reloadKey]);
  const { data: comments } = useApi(() => adminApi.comments({ visibility: 'hidden', limit: 20 }), [reloadKey]);

  const reviewList = reviews?.reviews ?? [];
  const postList = posts?.posts ?? [];
  const commentList = comments?.comments ?? [];
  const total = reviewList.length + postList.length + commentList.length;

  if (!total) {
    return (
      <Panel title="Fila de moderação">
        <div className="empty-state">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="check" size={32} />
          </span>
          <h3>Nada oculto no momento</h3>
          <p className="muted">Avaliações e conteúdo sinalizado aparecem aqui para decisão.</p>
        </div>
      </Panel>
    );
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {notice && (
        <div className="alert alert-success">
          <div className="grow">{notice.message}</div>
          <button type="button" className="alert-close" onClick={() => onNotice(null)} aria-label="Fechar">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      <Panel title={`${formatNumber(total)} item(ns) ocultos`} description="Restaurar devolve ao público na hora.">
        <div className="stack" style={{ gap: 18 }}>
          {reviewList.length > 0 && (
            <QueueGroup
              title="Avaliações"
              items={reviewList.map((r) => ({
                id: r.id,
                kind: 'review',
                author: r.userName,
                text: r.comment || '(sem comentário)',
                extra: `${r.rating} estrelas · ${r.courseTitle}`,
                reason: r.hiddenReason,
                date: r.createdAt,
              }))}
              onRestore={(item) => onAction({ type: 'restore', kind: 'review', item })}
              onDelete={(item) => onAction({ type: 'delete', kind: 'review', item })}
            />
          )}

          {postList.length > 0 && (
            <QueueGroup
              title="Discussões"
              items={postList.map((p) => ({
                id: p.id,
                kind: 'post',
                author: p.userName,
                text: p.title,
                extra: `${p.commentCount} comentário(s) · ${p.viewsCount} visualizações`,
                reason: p.hiddenReason,
                date: p.createdAt,
              }))}
              onRestore={(item) => onAction({ type: 'restore', kind: 'post', item })}
              onDelete={(item) => onAction({ type: 'delete', kind: 'post', item })}
            />
          )}

          {commentList.length > 0 && (
            <QueueGroup
              title="Comentários"
              items={commentList.map((c) => ({
                id: c.id,
                kind: 'comment',
                author: c.userName,
                text: c.content,
                extra: `em "${c.postTitle}"`,
                reason: c.hiddenReason,
                date: c.createdAt,
              }))}
              onRestore={(item) => onAction({ type: 'restore', kind: 'comment', item })}
              onDelete={(item) => onAction({ type: 'delete', kind: 'comment', item })}
            />
          )}
        </div>
      </Panel>
    </div>
  );
}

function QueueGroup({ title, items, onRestore, onDelete }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <h3 className="section-title">{title}</h3>
      {items.map((item) => (
        <article key={`${item.kind}-${item.id}`} className="queue-item">
          <div className="stack" style={{ gap: 4 }}>
            <div className="row wrap" style={{ gap: 8 }}>
              <strong>{item.author}</strong>
              <span className="tiny muted">{item.extra}</span>
              <span className="tiny muted">{formatDate(item.date)}</span>
            </div>
            <p className="queue-text">{item.text}</p>
            {item.reason && <span className="tiny muted">Motivo da ocultação: {item.reason}</span>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onRestore(item)}>
              Restaurar
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDelete(item)}>
              Excluir
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

const VISIBILITY_OPTIONS = [
  { value: 'visible', label: 'Visíveis' },
  { value: 'hidden', label: 'Ocultos' },
  { value: 'all', label: 'Todos' },
];

function ReviewsTab({ notice, onNotice, onAction, params, setParams, reloadKey }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const visibility = params.get('visibility') ?? 'all';
  const page = Number(params.get('page') ?? 1);

  const { data, loading, error, refetch } = useApi(
    () => adminApi.reviews({ search: debounced, visibility, page, limit: 20 }),
    [debounced, visibility, page, reloadKey],
  );

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === '' || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      {data?.summary && (
        <Panel>
          <div className="stack" style={{ gap: 12 }}>
            <SummaryBar
              items={[
                { label: 'no filtro', value: formatNumber(data.summary.total) },
                { label: 'ocultas', value: formatNumber(data.summary.hidden) },
                { label: 'nota média visível', value: Number(data.summary.ratingAvg ?? 0).toFixed(2).replace('.', ',') },
              ]}
            />
            {data.byRating?.length > 0 && (
              <BarList
                items={data.byRating.map((b) => ({ id: b.rating, label: `${b.rating} estrela(s)`, value: b.total }))}
              />
            )}
          </div>
        </Panel>
      )}

      <DataTable
        rows={data?.reviews}
        loading={loading}
        error={error}
        onRetry={refetch}
        notice={notice}
        onDismissNotice={() => onNotice(null)}
        meta={data?.meta}
        onPageChange={(p) => setParam({ page: p })}
        emptyIcon="star"
        emptyTitle="Nenhuma avaliação encontrada"
        filters={
          <>
            <SearchField value={search} onChange={setSearch} placeholder="Buscar no comentário" width={260} />
            <FilterSelect value={visibility} onChange={(v) => setParam({ visibility: v })} options={VISIBILITY_OPTIONS} label="Filtrar por visibilidade" />
          </>
        }
        columns={[
          {
            key: 'review',
            header: 'Avaliação',
            render: (r) => (
              <div className="stack" style={{ gap: 4 }}>
                <span className="row" style={{ gap: 4 }}>
                  <Icon name="starFill" size={15} />
                  <span className="small strong">{r.rating}</span>
                  <span className="tiny muted">{r.courseTitle}</span>
                </span>
                <span className="queue-text">{r.comment || '(sem comentário)'}</span>
              </div>
            ),
          },
          {
            key: 'user',
            header: 'Autor',
            render: (r) => (
              <div className="stack" style={{ gap: 2 }}>
                <span className="small">{r.userName}</span>
                <span className="tiny muted">{formatDate(r.createdAt)}</span>
              </div>
            ),
          },
          {
            key: 'status',
            header: 'Situação',
            render: (r) => (
              <div className="stack" style={{ gap: 2 }}>
                {r.hiddenAt ? <StatusTag status="hidden" /> : <StatusTag status="visible" />}
                {r.hiddenByName && <span className="tiny muted">por {r.hiddenByName}</span>}
              </div>
            ),
          },
          {
            key: 'actions',
            header: 'Ações',
            align: 'right',
            render: (r) => (
              <VisibilityButtons
                hidden={Boolean(r.hiddenAt)}
                onHide={() => onAction({ type: 'hide', kind: 'review', item: r })}
                onRestore={() => onAction({ type: 'restore', kind: 'review', item: r })}
                onDelete={() => onAction({ type: 'delete', kind: 'review', item: r })}
              />
            ),
          },
        ]}
      />
    </div>
  );
}

function PostsTab({ notice, onNotice, onAction, params, setParams, reloadKey }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const visibility = params.get('visibility') ?? 'visible';
  const page = Number(params.get('page') ?? 1);

  const { data, loading, error, refetch } = useApi(
    () => adminApi.posts({ search: debounced, visibility, page, limit: 20 }),
    [debounced, visibility, page, reloadKey],
  );

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === '' || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <DataTable
      rows={data?.posts}
      loading={loading}
      error={error}
      onRetry={refetch}
      notice={notice}
      onDismissNotice={() => onNotice(null)}
      meta={data?.meta}
      onPageChange={(p) => setParam({ page: p })}
      emptyIcon="message"
      emptyTitle="Nenhuma discussão encontrada"
      filters={
        <>
          <SearchField value={search} onChange={setSearch} placeholder="Buscar no título ou conteúdo" width={280} />
          <FilterSelect value={visibility} onChange={(v) => setParam({ visibility: v })} options={VISIBILITY_OPTIONS} label="Filtrar por visibilidade" />
        </>
      }
      columns={[
        {
          key: 'post',
          header: 'Discussão',
          render: (p) => (
            <div className="stack" style={{ gap: 4 }}>
              <strong>{p.title}</strong>
              <span className="queue-text">{p.excerpt}</span>
            </div>
          ),
        },
        {
          key: 'user',
          header: 'Autor',
          render: (p) => (
            <div className="stack" style={{ gap: 2 }}>
              <span className="small">{p.userName}</span>
              <span className="tiny muted">{formatDate(p.createdAt)}</span>
            </div>
          ),
        },
        {
          key: 'meta',
          header: 'Engajamento',
          render: (p) => (
            <div className="stack" style={{ gap: 2 }}>
              <span className="small">{formatNumber(p.commentCount)} comentários</span>
              <span className="tiny muted">
                {formatNumber(p.viewsCount)} views
                {p.isPinned ? ' · fixada' : ''}
                {p.isLocked ? ' · fechada' : ''}
              </span>
              {p.hiddenCommentCount > 0 && <span className="tiny muted">{p.hiddenCommentCount} ocultos</span>}
            </div>
          ),
        },
        {
          key: 'status',
          header: 'Situação',
          render: (p) => (p.hiddenAt ? <StatusTag status="hidden" /> : <StatusTag status="visible" />),
        },
        {
          key: 'actions',
          header: 'Ações',
          align: 'right',
          render: (p) => (
            <VisibilityButtons
              hidden={Boolean(p.hiddenAt)}
              onHide={() => onAction({ type: 'hide', kind: 'post', item: p })}
              onRestore={() => onAction({ type: 'restore', kind: 'post', item: p })}
              onDelete={() => onAction({ type: 'delete', kind: 'post', item: p })}
            />
          ),
        },
      ]}
    />
  );
}

function CommentsTab({ notice, onNotice, onAction, params, setParams, reloadKey }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const visibility = params.get('visibility') ?? 'all';
  const page = Number(params.get('page') ?? 1);

  const { data, loading, error, refetch } = useApi(
    () => adminApi.comments({ search: debounced, visibility, page, limit: 20 }),
    [debounced, visibility, page, reloadKey],
  );

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === '' || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <DataTable
      rows={data?.comments}
      loading={loading}
      error={error}
      onRetry={refetch}
      notice={notice}
      onDismissNotice={() => onNotice(null)}
      meta={data?.meta}
      onPageChange={(p) => setParam({ page: p })}
      emptyIcon="message"
      emptyTitle="Nenhum comentário encontrado"
      filters={
        <>
          <SearchField value={search} onChange={setSearch} placeholder="Buscar no comentário" width={260} />
          <FilterSelect value={visibility} onChange={(v) => setParam({ visibility: v })} options={VISIBILITY_OPTIONS} label="Filtrar por visibilidade" />
        </>
      }
      columns={[
        {
          key: 'comment',
          header: 'Comentário',
          render: (c) => (
            <div className="stack" style={{ gap: 4 }}>
              <span className="queue-text">{c.content}</span>
              <span className="tiny muted">em "{c.postTitle}"</span>
            </div>
          ),
        },
        {
          key: 'user',
          header: 'Autor',
          render: (c) => (
            <div className="stack" style={{ gap: 2 }}>
              <span className="small">{c.userName}</span>
              <span className="tiny muted">{formatDate(c.createdAt)}</span>
            </div>
          ),
        },
        {
          key: 'status',
          header: 'Situação',
          render: (c) => (c.hiddenAt ? <StatusTag status="hidden" /> : <StatusTag status="visible" />),
        },
        {
          key: 'actions',
          header: 'Ações',
          align: 'right',
          render: (c) => (
            <VisibilityButtons
              hidden={Boolean(c.hiddenAt)}
              onHide={() => onAction({ type: 'hide', kind: 'comment', item: c })}
              onRestore={() => onAction({ type: 'restore', kind: 'comment', item: c })}
              onDelete={() => onAction({ type: 'delete', kind: 'comment', item: c })}
            />
          ),
        },
      ]}
    />
  );
}

function VisibilityButtons({ hidden, onHide, onRestore, onDelete }) {
  return (
    <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
      {hidden ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRestore}>
          Restaurar
        </button>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onHide}>
          Ocultar
        </button>
      )}
      <button type="button" className="icon-btn icon-btn-danger" onClick={onDelete} aria-label="Excluir definitivamente" title="Excluir definitivamente">
        <Icon name="trash" size={16} />
      </button>
    </div>
  );
}

const KIND_LABEL = { review: 'avaliação', post: 'discussão', comment: 'comentário' };

const ENDPOINTS = {
  review: {
    hide: (id, reason) => adminApi.setReviewVisibility(id, true, reason),
    restore: (id) => adminApi.setReviewVisibility(id, false),
    remove: (id) => adminApi.deleteReview(id),
    title: (i) => `Ocultar avaliação de ${i.userName}`,
    deleteTitle: (i) => `Excluir avaliação de ${i.userName}`,
  },
  post: {
    hide: (id, reason) => adminApi.setPostVisibility(id, true, reason),
    restore: (id) => adminApi.setPostVisibility(id, false),
    remove: (id) => adminApi.deletePost(id),
    title: (i) => `Ocultar discussão "${i.title}"`,
    deleteTitle: (i) => `Excluir discussão "${i.title}"`,
  },
  comment: {
    hide: (id, reason) => adminApi.setCommentVisibility(id, true, reason),
    restore: (id) => adminApi.setCommentVisibility(id, false),
    remove: (id) => adminApi.deleteComment(id),
    title: (i) => `Ocultar comentário de ${i.userName}`,
    deleteTitle: (i) => `Excluir comentário de ${i.userName}`,
  },
};

/** Um diálogo para as três operações, porque elas diferem só no efeito. */
function ModerationActionDialog({ action, busy, run, onClose }) {
  if (!action) return null;
  const api = ENDPOINTS[action.kind];

  if (action.type === 'hide') {
    return (
      <ConfirmDialog
        open
        title={api.title(action.item)}
        description="O item some do público, mas continua no banco e pode ser restaurado."
        impact={[
          'Some das listagens e do detalhe público',
          'A média do curso é recalculada sem esta avaliação',
          'O histórico de discussão é preservado',
          'Restaurar devolve ao público na hora',
        ]}
        reason
        reasonLabel="Motivo da ocultação"
        confirmLabel="Ocultar"
        tone="warn"
        busy={busy}
        onCancel={onClose}
        onConfirm={(reason) => run(() => api.hide(action.item.id, reason), `${KIND_LABEL[action.kind]} ocultado.`)}
      />
    );
  }

  if (action.type === 'restore') {
    return (
      <ConfirmDialog
        open
        title={`Restaurar ${KIND_LABEL[action.kind]}`}
        description="O item volta a aparecer para o público imediatamente."
        confirmLabel="Restaurar"
        tone="primary"
        busy={busy}
        onCancel={onClose}
        onConfirm={() => run(() => api.restore(action.item.id), `${KIND_LABEL[action.kind]} restaurado.`)}
      />
    );
  }

  return (
    <ConfirmDialog
      open
      title={api.deleteTitle(action.item)}
      description="Excluir é definitivo e não pode ser desfeito pelo painel."
      impact={
        action.kind === 'post'
          ? ['A discussão e todos os comentários dela são apagados', 'O histórico da turma é perdido', 'Prefira ocultar se o problema é o conteúdo']
          : ['O item é apagado do banco', 'Não há como recuperar pela interface', 'A média do curso é recalculada sem esta avaliação']
      }
      confirmLabel="Excluir definitivamente"
      busy={busy}
      onCancel={onClose}
      onConfirm={() => run(() => api.remove(action.item.id), `${KIND_LABEL[action.kind]} excluído.`)}
    />
  );
}
