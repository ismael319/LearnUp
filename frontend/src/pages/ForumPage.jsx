import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { forumApi, gamificationApi } from '../api/client.js';
import { useApi, useSubmit, useDebounced } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert } from '../components/Alert.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { Spinner, EmptyState, ErrorState, LoadingBlock } from '../components/Feedback.jsx';
import { Icon } from '../components/Icon.jsx';
import { timeAgo } from '../utils/format.js';

const SORTS = [
  { value: 'recent', label: 'Recentes' },
  { value: 'top', label: 'Mais comentados' },
  { value: 'unanswered', label: 'Sem resposta' },
];

export function ForumPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const query = useDebounced(search, 350);

  const filters = {
    search: query || undefined,
    sort: params.get('sort') ?? 'recent',
    page: Number(params.get('page')) || 1,
    limit: 10,
  };

  const { data, loading, error, refetch } = useApi(() => forumApi.list(filters), [params.toString(), query]);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const posts = data?.posts ?? [];

  return (
    <div className="container page" style={{ maxWidth: 880 }}>
      <header className="page-head">
        <div>
          <h1 style={{ margin: 0 }}>Comunidade</h1>
          <p className="muted" style={{ margin: 0 }}>Tire dúvidas, compartilhe ideias e ajude outros alunos.</p>
        </div>
        <Link className="btn btn-primary" to="/forum/novo">+ Nova publicação</Link>
      </header>

      <div className="row wrap" style={{ gap: 10, marginBottom: 20 }}>
        <input
          className="input grow"
          style={{ minWidth: 200 }}
          type="search"
          placeholder="Buscar publicações..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Buscar publicações"
        />
        <select className="select" style={{ width: 'auto' }} value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)} aria-label="Ordenar">
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {error && <ErrorState error={error} onRetry={refetch} />}

      {loading ? (
        <LoadingBlock />
      ) : posts.length ? (
        <div className="stack">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
          {data.meta.totalPages > 1 && (
            <div className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm row"
                style={{ gap: 6 }}
                disabled={!data.meta.hasPrev}
                onClick={() => setFilter('page', String(filters.page - 1))}
              >
                <Icon name="caretLeft" size={14} /> Anterior
              </button>
              <span className="small muted" style={{ alignSelf: 'center' }}>
                Página {data.meta.page} de {data.meta.totalPages}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm row"
                style={{ gap: 6 }}
                disabled={!data.meta.hasNext}
                onClick={() => setFilter('page', String(filters.page + 1))}
              >
                Próxima <Icon name="caretRight" size={14} />
              </button>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          icon="message"
          title="Nenhuma publicação"
          description="Seja a primeira pessoa a iniciar uma conversa."
          action={<Link className="btn btn-primary" to="/forum/novo">Criar publicação</Link>}
        />
      )}
    </div>
  );
}

function PostCard({ post }) {
  return (
    <Link to={`/forum/${post.id}`} className="card card-pad stack" style={{ gap: 8, textDecoration: 'none', color: 'inherit' }}>
      <div className="row wrap" style={{ gap: 6 }}>
        {post.isPinned && <span className="badge badge-warning"><Icon name="pin" size={12} /> Fixado</span>}
        {post.isLocked && <span className="badge"><Icon name="lock" size={12} /> Trancado</span>}
        {post.courseId && <span className="badge badge-brand">Vinculado a um curso</span>}
      </div>

      <strong className="clamp-2">{post.title}</strong>
      <p className="small muted clamp-2" style={{ margin: 0 }}>{post.content}</p>

      <div className="row wrap small muted" style={{ gap: 12 }}>
        <span className="row" style={{ gap: 6 }}>
          <Avatar name={post.userName} src={post.avatarAvatarUrl} size="sm" />
          {post.userName}
        </span>
        <span>{timeAgo(post.createdAt)}</span>
        <span className="row" style={{ gap: 5 }}><Icon name="message" size={14} /> {post.commentsCount ?? 0}</span>
        <span className="row" style={{ gap: 5 }}><Icon name="eye" size={14} /> {post.viewsCount ?? 0}</span>
      </div>
    </Link>
  );
}

export function ForumPostPage() {
  const { postId } = useParams();
  const { isAuthenticated, user } = useAuth();
  const [comment, setComment] = useState('');
  const [actionError, setActionError] = useState(null);

  const { data, loading, error, refetch } = useApi(() => forumApi.detail(postId), [postId]);

  const { submit: postComment, loading: postingComment } = useSubmit(async () => {
    await forumApi.comment(postId, { content: comment });
    setComment('');
    refetch();
  });

  const remove = async () => {
    if (!window.confirm('Excluir esta publicação?')) return;
    try {
      await forumApi.remove(postId);
      window.location.href = '/forum';
    } catch (err) {
      setActionError(err.message);
    }
  };

  if (loading) return <LoadingBlock />;
  if (error) {
    return (
      <div className="container page">
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  const post = data?.post;
  if (!post) return null;

  const comments = post.comments ?? [];
  const canDelete = isAuthenticated && (post.userId === user?.id || user?.role === 'admin');

  return (
    <div className="container page" style={{ maxWidth: 880 }}>
          <Link to="/forum" className="small muted row" style={{ gap: 5 }}>
            <Icon name="caretLeft" size={13} /> Voltar à comunidade
          </Link>

      {actionError && (
        <div style={{ marginTop: 12 }}>
          <Alert variant="danger" onClose={() => setActionError(null)}>{actionError}</Alert>
        </div>
      )}

      <article className="card card-pad stack" style={{ gap: 16, marginTop: 16 }}>
        <div className="row wrap" style={{ gap: 6 }}>
          {post.isPinned && <span className="badge badge-warning"><Icon name="pin" size={12} /> Fixado</span>}
          {post.isLocked && <span className="badge"><Icon name="lock" size={12} /> Trancado</span>}
        </div>

        <h1 style={{ margin: 0, fontSize: '1.6rem' }}>{post.title}</h1>

        <div className="row wrap small muted" style={{ gap: 12 }}>
          <span className="row" style={{ gap: 6 }}>
            <Avatar name={post.userName} src={post.avatarAvatarUrl} size="sm" /> {post.userName}
          </span>
          <span>{timeAgo(post.createdAt)}</span>
          <span className="row" style={{ gap: 5 }}><Icon name="eye" size={14} /> {post.viewsCount}</span>
        </div>

        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{post.content}</p>

        {canDelete && (
          <button type="button" className="btn btn-danger btn-sm" style={{ alignSelf: 'flex-start' }} onClick={remove}>
            Excluir publicação
          </button>
        )}
      </article>

      <section className="stack" style={{ gap: 14, marginTop: 28 }}>
        <h2 style={{ margin: 0 }}>{comments.length} resposta(s)</h2>

        {comments.length ? (
          comments.map((c) => (
            <div key={c.id} className="card card-pad row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <Avatar name={c.userName} src={c.avatarUrl} size="sm" />
              <div className="stack grow" style={{ gap: 4 }}>
                <div className="row-between">
                  <strong className="small">{c.userName}</strong>
                  <span className="tiny muted">{timeAgo(c.createdAt)}</span>
                </div>
                <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{c.content}</p>
              </div>
            </div>
          ))
        ) : (
          <EmptyState icon="message" title="Nenhuma resposta ainda" description="Seja a primeira pessoa a ajudar." />
        )}

        {post.isLocked ? (
          <Alert variant="warning">Este tópico está trancado e não aceita novas respostas.</Alert>
        ) : isAuthenticated ? (
          <form
            className="card card-pad stack"
            onSubmit={(e) => {
              e.preventDefault();
              postComment();
            }}
          >
            <label className="label" htmlFor="comment">Sua resposta</label>
            <textarea
              id="comment"
              className="textarea"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              required
              minLength={2}
              placeholder="Escreva sua contribuição..."
            />
            <button type="submit" className="btn btn-primary" disabled={postingComment || comment.trim().length < 2} style={{ alignSelf: 'flex-start' }}>
              {postingComment && <Spinner />} Publicar resposta
            </button>
          </form>
        ) : (
          <Alert variant="info">
            <Link to="/entrar" state={{ from: `/forum/${postId}` }}>Entre</Link> para responder.
          </Alert>
        )}
      </section>
    </div>
  );
}

export function NewPostPage() {
  const [form, setForm] = useState({ title: '', content: '' });
  const [created, setCreated] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { post } = await forumApi.create(form);
      setCreated(post);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="container page" style={{ maxWidth: 700 }}>
        <EmptyState
          icon="sparkle"
          title="Publicação criada!"
          description={`"${created.title}" foi publicada. Cada post rende pontos de participação na comunidade.`}
          action={<Link className="btn btn-primary" to={`/forum/${created.id}`}>Ver publicação</Link>}
        />
      </div>
    );
  }

  return (
    <div className="container page" style={{ maxWidth: 700 }}>
      <h1>Nova publicação</h1>
      {error && (
        <div style={{ marginBottom: 16 }}>
          <Alert variant="danger">{error.message}</Alert>
        </div>
      )}

      <form className="card card-pad stack" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="title">Título</label>
          <input
            id="title"
            className="input"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            required
            minLength={3}
            maxLength={180}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor="content">Conteúdo</label>
          <textarea
            id="content"
            className="textarea"
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            required
            minLength={2}
            placeholder="Descreva sua dúvida ou compartilhe uma ideia..."
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy} style={{ alignSelf: 'flex-start' }}>
          {busy && <Spinner />} Publicar
        </button>
      </form>
    </div>
  );
}

export function LeaderboardPage() {
  const { data, loading, error, refetch } = useApi(() => gamificationApi.leaderboard(30), []);

  if (loading) return <LoadingBlock />;
  if (error) {
    return (
      <div className="container page">
        <ErrorState error={error} onRetry={refetch} />
      </div>
    );
  }

  const top = data?.leaderboard ?? [];

  return (
    <div className="container page" style={{ maxWidth: 800 }}>
      <h1>Ranking de alunos</h1>
      <p className="muted">Quem mais acumula pontos estudando na LearnUp.</p>

      {top.length === 0 ? (
        <EmptyState icon="trophy" title="Ranking ainda vazio" description="Conclua aulas e responda quizzes para aparecer aqui." />
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {top.map((row, i) => (
            <div
              key={row.id}
              className="row"
              style={{ gap: 14, padding: '14px 20px', borderTop: i === 0 ? 0 : '1px solid var(--ink-200)', background: i < 3 ? 'var(--brand-50)' : undefined }}
            >
              <span
                className="row"
                style={{ width: 32, justifyContent: 'center', fontWeight: 800, color: i === 0 ? 'var(--gold-500)' : 'var(--ink-500)' }}
              >
                {i < 3 ? <Icon name="trophy" size={17} /> : `${i + 1}º`}
              </span>
              <Avatar name={row.name} src={row.avatarUrl} size="sm" />
              <div className="stack grow" style={{ gap: 0, minWidth: 0 }}>
                <strong className="truncate">{row.name}</strong>
                <span className="tiny muted row wrap" style={{ gap: 4 }}>
                  <Icon name="certificate" size={12} /> {row.certificatesCount ?? 0} certificados
                  <span aria-hidden="true">·</span>
                  <Icon name="sparkle" size={12} /> {row.streakDays ?? 0} dias
                </span>
              </div>
              <span className="badge badge-brand row" style={{ gap: 4 }}><Icon name="star" size={12} /> {row.points ?? 0}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
