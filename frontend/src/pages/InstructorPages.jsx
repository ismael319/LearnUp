import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { coursesApi } from '../api/client.js';
import { useApi, useSubmit, errorMessage } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert } from '../components/Alert.jsx';
import { Icon } from '../components/Icon.jsx';
import { EmptyState, ErrorState, LoadingBlock, Spinner } from '../components/Feedback.jsx';
import { formatPrice, priceNumber, parsePriceToCents, formatNumber, formatDuration, formatTime, LEVEL_LABEL, LESSON_TYPE } from '../utils/format.js';

const STATUS = {
  draft: { label: 'Rascunho', className: 'badge-warning' },
  published: { label: 'Publicado', className: 'badge-success' },
  archived: { label: 'Arquivado', className: 'badge-danger' },
};

export function InstructorPage() {
  const { isAdmin } = useAuth();
  const [creating, setCreating] = useState(false);

  return (
    <div className="container page">
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Área do instrutor</span>
          <h1 style={{ margin: 0 }}>Meus cursos</h1>
          <p className="muted" style={{ margin: 0 }}>
            {isAdmin
              ? 'Como administrador, você vê todos os cursos da plataforma.'
              : 'Crie, edite e publique seus cursos.'}
          </p>
        </div>
        {!creating && (
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={16} /> Novo curso
          </button>
        )}
      </div>

      {creating && <CreateCourse onDone={() => setCreating(false)} />}

      <CourseList />
    </div>
  );
}

function CreateCourse({ onDone }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', subtitle: '', level: 'beginner', status: 'draft' });
  const { submit, loading, error, setError } = useSubmit(async () => {
    const { course } = await coursesApi.create(form);
    onDone();
    navigate(`/instructor/curso/${course.id}`);
  });

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  return (
    <div className="card card-pad stack" style={{ gap: 16, marginBottom: 28 }}>
      <div className="row-between">
        <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Novo curso</h2>
        <button type="button" className="icon-button" onClick={onDone} aria-label="Cancelar">
          <Icon name="x" size={18} />
        </button>
      </div>

      {error && <Alert variant="danger" onClose={() => setError(null)}>{errorMessage(error)}</Alert>}

      <div className="field">
        <label className="label" htmlFor="new-course-title">Título</label>
        <input
          id="new-course-title"
          className="input"
          value={form.title}
          onChange={set('title')}
          placeholder="NR 33 - Espaços confinados (4h)"
          autoFocus
        />
        <span className="hint">O endereço do curso é gerado a partir do título e pode ser ajustado depois.</span>
      </div>

      <div className="field">
        <label className="label" htmlFor="new-course-subtitle">Subtítulo</label>
        <input
          id="new-course-subtitle"
          className="input"
          value={form.subtitle}
          onChange={set('subtitle')}
          placeholder="Resuma em uma linha o que o aluno vai aprender"
        />
      </div>

      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field grow">
          <label className="label" htmlFor="new-course-level">Nível</label>
          <select id="new-course-level" className="select" value={form.level} onChange={set('level')}>
            {Object.entries(LEVEL_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="field grow">
          <label className="label" htmlFor="new-course-status">Publicação</label>
          <select id="new-course-status" className="select" value={form.status} onChange={set('status')}>
            <option value="draft">Rascunho (não aparece no catálogo)</option>
            <option value="published">Publicado</option>
          </select>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 10 }}>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={loading || form.title.trim().length < 3}>
          {loading ? <Spinner /> : 'Criar e montar o currículo'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onDone} disabled={loading}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

function CourseList() {
  const { data, loading, error, refetch } = useApi(() => coursesApi.managed(), []);

  if (loading) return <LoadingBlock label="Carregando seus cursos..." />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const courses = data?.courses ?? [];
  if (!courses.length) {
    return (
      <EmptyState
        icon="book"
        title="Você ainda não criou nenhum curso"
        description="Comece com o título e a estrutura. O conteúdo pode ser preenchido depois."
        action={
          <button type="button" className="btn btn-primary" onClick={() => window.scrollTo({ top: 0 })}>
            <Icon name="plus" size={16} /> Criar o primeiro curso
          </button>
        }
      />
    );
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {courses.map((course) => (
        <CourseRow key={course.id} course={course} />
      ))}
    </div>
  );
}

function CourseRow({ course }) {
  const status = STATUS[course.status] ?? STATUS.draft;

  return (
    <div className="card card-pad">
      <div className="row wrap" style={{ gap: 16, alignItems: 'flex-start' }}>
        {course.coverUrl && (
          <img
            src={course.coverUrl}
            alt=""
            style={{ width: 132, aspectRatio: '16 / 9', objectFit: 'cover', borderRadius: 'var(--radius)', flex: '0 0 auto' }}
          />
        )}

        <div className="stack grow" style={{ gap: 6, minWidth: 220 }}>
          <div className="row wrap" style={{ gap: 8 }}>
            <span className={`badge ${status.className}`}>{status.label}</span>
            <span className="badge">{LEVEL_LABEL[course.level]}</span>
            {!course.ownedByMe && <span className="badge badge-gold">de {course.instructorName}</span>}
          </div>

          <strong className="truncate">{course.title}</strong>
          {course.subtitle && <span className="small muted clamp-2">{course.subtitle}</span>}

          <div className="row wrap small muted" style={{ gap: 14 }}>
            <span><Icon name="book" size={13} /> {course.moduleCount} módulos · {course.lessonCount} aulas</span>
            <span><Icon name="users" size={13} /> {formatNumber(course.studentsCount)} matriculados</span>
            <span><Icon name="wallet" size={13} /> {formatPrice(course.priceCents)}</span>
            {course.revenueCents > 0 && <span><Icon name="chart" size={13} /> {formatPrice(course.revenueCents)} recebido</span>}
            {course.durationMinutes > 0 && <span><Icon name="clock" size={13} /> {formatDuration(course.durationMinutes)}</span>}
          </div>
        </div>

        <div className="row wrap" style={{ gap: 8 }}>
          {course.status === 'published' && (
            <Link className="btn btn-ghost btn-sm" to={`/cursos/${course.slug}`}>
              <Icon name="eye" size={15} /> Ver
            </Link>
          )}
          <Link className="btn btn-primary btn-sm" to={`/instructor/curso/${course.id}`}>
            <Icon name="edit" size={15} /> Editar
          </Link>
        </div>
      </div>
    </div>
  );
}


const emptyLesson = () => ({ title: '', type: 'video', durationSeconds: 0, videoUrl: '', content: '', isPreview: false });
const emptyModule = () => ({ title: '', description: '', lessons: [emptyLesson()] });

/** Converte o currículo da API no estado editável (strings, sem `position`). */
const toDraft = (course) => ({
  modules: course.modules.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description ?? '',
    lessons: m.lessons.map((l) => ({
      id: l.id,
      title: l.title,
      description: l.description ?? '',
      type: l.type,
      durationSeconds: l.durationSeconds,
      videoUrl: l.videoUrl ?? '',
      content: l.content ?? '',
      isPreview: l.isPreview,
    })),
  })),
});

export function CourseEditorPage() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useApi(() => coursesApi.forEditing(courseId), [courseId]);
  const [tab, setTab] = useState('detalhes');

  if (loading) return <LoadingBlock label="Carregando o curso..." />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  // Quem não é dono (e não é admin) recebe 403 do backend, tratado acima pelo
  // ErrorState — não é preciso duplicar a regra de permissão aqui.
  const course = data.course;

  return (
    <div className="container page">
      <div className="page-head">
        <div className="stack" style={{ gap: 4, minWidth: 0 }}>
          <Link to="/instructor" className="small muted">← Meus cursos</Link>
          <h1 style={{ margin: 0 }} className="truncate">{course.title}</h1>
          <span className="small muted">
            /cursos/{course.slug} · dono: {course.instructorName}
          </span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          {course.status === 'published' && (
            <Link className="btn btn-ghost btn-sm" to={`/cursos/${course.slug}`}>
              <Icon name="eye" size={15} /> Ver publicado
            </Link>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={refetch}>
            <Icon name="spark" size={15} /> Recarregar
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist" style={{ marginBottom: 24 }}>
        {[
          { id: 'detalhes', label: 'Detalhes' },
          { id: 'curriculo', label: 'Currículo' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'detalhes' ? <CourseDetails course={course} /> : <Curriculum course={course} onSaved={refetch} />}
    </div>
  );
}

function CourseDetails({ course }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: course.title,
    slug: course.slug,
    subtitle: course.subtitle ?? '',
    description: course.description ?? '',
    coverUrl: course.coverUrl ?? '',
    categoryId: course.categoryId ?? '',
    level: course.level,
    status: course.status,
    price: priceNumber(course.priceCents),
    originalPrice: course.originalPriceCents ? priceNumber(course.originalPriceCents) : '',
    durationMinutes: course.durationMinutes,
  });
  const [done, setDone] = useState(false);

  const { data: categories } = useApi(() => coursesApi.categories(), []);
  const { submit, loading, error, setError } = useSubmit(async () => {
    const { course: updated } = await coursesApi.update(course.id, {
      title: form.title,
      slug: form.slug,
      subtitle: form.subtitle || null,
      description: form.description || null,
      coverUrl: form.coverUrl || null,
      categoryId: form.categoryId || null,
      level: form.level,
      status: form.status,
      priceCents: parsePriceToCents(form.price) ?? 0,
      originalPriceCents: form.originalPrice ? parsePriceToCents(form.originalPrice) : null,
      durationMinutes: form.durationMinutes,
    });
    setDone(true);
    if (updated.slug !== course.slug) navigate(`/instructor/curso/${course.id}`, { replace: true });
  });

  const set = (key) => (event) => {
    setDone(false);
    setForm((f) => ({ ...f, [key]: event.target.value }));
  };

  return (
    <div className="card card-pad stack" style={{ gap: 18, maxWidth: 860 }}>
      {error && <Alert variant="danger" onClose={() => setError(null)}>{errorMessage(error)}</Alert>}
      {done && <Alert variant="success" onClose={() => setDone(false)}>Alterações salvas.</Alert>}

      <div className="field">
        <label className="label" htmlFor="f-title">Título</label>
        <input id="f-title" className="input" value={form.title} onChange={set('title')} />
      </div>

      <div className="field">
        <label className="label" htmlFor="f-slug">Endereço</label>
        <input id="f-slug" className="input" value={form.slug} onChange={set('slug')} />
        <span className="hint">É o que aparece depois de /cursos/. Não pode repetir o de outro curso.</span>
      </div>

      <div className="field">
        <label className="label" htmlFor="f-subtitle">Subtítulo</label>
        <input id="f-subtitle" className="input" value={form.subtitle} onChange={set('subtitle')} />
      </div>

      <div className="field">
        <label className="label" htmlFor="f-description">Descrição</label>
        <textarea id="f-description" className="textarea" value={form.description} onChange={set('description')} rows={8} />
        <span className="hint">Aceita Markdown simples.</span>
      </div>

      <div className="field">
        <label className="label" htmlFor="f-cover">URL da capa</label>
        <input id="f-cover" className="input" value={form.coverUrl} onChange={set('coverUrl')} placeholder="https://..." />
        <span className="hint">Deixe vazio para usar a capa gerada automaticamente.</span>
      </div>

      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field grow">
          <label className="label" htmlFor="f-category">Categoria</label>
          <select id="f-category" className="select" value={form.categoryId} onChange={set('categoryId')}>
            <option value="">Sem categoria</option>
            {(categories?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field grow">
          <label className="label" htmlFor="f-level">Nível</label>
          <select id="f-level" className="select" value={form.level} onChange={set('level')}>
            {Object.entries(LEVEL_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="field grow">
          <label className="label" htmlFor="f-status">Publicação</label>
          <select id="f-status" className="select" value={form.status} onChange={set('status')}>
            <option value="draft">Rascunho</option>
            <option value="published">Publicado</option>
            <option value="archived">Arquivado</option>
          </select>
        </div>
      </div>

      <div className="row wrap" style={{ gap: 12 }}>
        <div className="field grow">
          <label className="label" htmlFor="f-price">Preço</label>
          <input id="f-price" className="input" value={form.price} onChange={set('price')} inputMode="decimal" placeholder="0,00" />
          <span className="hint">Vazio ou 0 = gratuito. Valor atual: {formatPrice(course.priceCents)}.</span>
        </div>
        <div className="field grow">
          <label className="label" htmlFor="f-original">Preço "de" (riscado)</label>
          <input id="f-original" className="input" value={form.originalPrice} onChange={set('originalPrice')} inputMode="decimal" placeholder="0,00" />
          <span className="hint">Mostra o desconto. Deixe vazio se não houver.</span>
        </div>
        <div className="field grow">
          <label className="label" htmlFor="f-duration">Duração (minutos)</label>
          <input id="f-duration" className="input" type="number" min="0" value={form.durationMinutes} onChange={set('durationMinutes')} />
          <span className="hint">Soma automática ao salvar o currículo.</span>
        </div>
      </div>

      <div className="row" style={{ gap: 10 }}>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={loading}>
          {loading ? <Spinner /> : 'Salvar detalhes'}
        </button>
      </div>
    </div>
  );
}

function Curriculum({ course, onSaved }) {
  const [modules, setModules] = useState(() => toDraft(course));
  const [done, setDone] = useState(null);

  // O currículo do servidor muda depois de salvar; recarrega o rascunho.
  useEffect(() => {
    setModules(toDraft(course));
  }, [course]);

  const { submit, loading, error, setError } = useSubmit(async () => {
    const summary = await coursesApi.saveCurriculum(
      course.id,
      modules.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description || null,
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          description: l.description || null,
          type: l.type,
          durationSeconds: Number(l.durationSeconds) || 0,
          videoUrl: l.videoUrl || null,
          content: l.content || null,
          isPreview: Boolean(l.isPreview),
        })),
      })),
    );
    setDone(summary);
  });

  const totalLessons = modules.reduce((sum, m) => sum + m.lessons.length, 0);
  const totalSeconds = modules.reduce(
    (sum, m) => sum + m.lessons.reduce((s, l) => s + (Number(l.durationSeconds) || 0), 0),
    0,
  );

  /** Move um item dentro de uma lista, trocando com o vizinho. */
  const move = (list, index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const copy = [...list];
    [copy[index], copy[target]] = [copy[target], copy[index]];
    return copy;
  };

  const patchModule = (index, patch) =>
    setModules((list) => list.map((m, i) => (i === index ? { ...m, ...patch } : m)));

  const removeModule = (index) => setModules((list) => list.filter((_, i) => i !== index));

  const patchLesson = (mi, li, patch) =>
    setModules((list) =>
      list.map((m, i) =>
        i === mi ? { ...m, lessons: m.lessons.map((l, j) => (j === li ? { ...l, ...patch } : l)) } : m,
      ),
    );

  const removeLesson = (mi, li) =>
    setModules((list) => list.map((m, i) => (i === mi ? { ...m, lessons: m.lessons.filter((_, j) => j !== li) } : m)));

  const moveLesson = (mi, li, delta) =>
    setModules((list) => {
      const lessons = move(list[mi].lessons, li, delta);
      return lessons ? list.map((m, i) => (i === mi ? { ...m, lessons } : m)) : list;
    });

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 980 }}>
      {error && <Alert variant="danger" onClose={() => setError(null)}>{errorMessage(error)}</Alert>}
      {done && (
        <Alert variant="success" onClose={() => setDone(null)}>
          Currículo salvo: {done.moduleCount} módulo(s), {done.lessonCount} aula(s), {formatTime(done.totalSeconds)} no total.
        </Alert>
      )}

      <div className="card card-pad row-between wrap" style={{ gap: 12 }}>
        <div className="small muted">
          {modules.length} módulo(s) · {totalLessons} aula(s) · {formatTime(totalSeconds)} de conteúdo
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setModules((list) => [...list, emptyModule()])}
        >
          <Icon name="plus" size={15} /> Adicionar módulo
        </button>
      </div>

      {modules.length === 0 && (
        <Alert variant="info">Nenhum módulo ainda. Um curso precisa de pelo menos um módulo com uma aula.</Alert>
      )}

      {modules.map((mod, mi) => (
        <div key={mod.id ?? `novo-${mi}`} className="builder-item">
          <div className="builder-head">
            <div className="row grow" style={{ gap: 10, minWidth: 0 }}>
              <span className="builder-index">{mi + 1}</span>
              <input
                className="input"
                value={mod.title}
                onChange={(e) => patchModule(mi, { title: e.target.value })}
                placeholder="Título do módulo"
                aria-label={`Título do módulo ${mi + 1}`}
              />
            </div>
            <div className="row" style={{ gap: 4 }}>
              <button
                type="button"
                className="icon-button"
                onClick={() => setModules((list) => move(list, mi, -1) ?? list)}
                disabled={mi === 0}
                aria-label="Mover módulo para cima"
              >
                <Icon name="caretDown" size={16} style={{ transform: 'rotate(180deg)' }} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setModules((list) => move(list, mi, 1) ?? list)}
                disabled={mi === modules.length - 1}
                aria-label="Mover módulo para baixo"
              >
                <Icon name="caretDown" size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => removeModule(mi)}
                aria-label="Remover módulo"
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          </div>

          <div className="builder-body">
            <input
              className="input"
              value={mod.description}
              onChange={(e) => patchModule(mi, { description: e.target.value })}
              placeholder="Descrição do módulo (opcional)"
              aria-label={`Descrição do módulo ${mi + 1}`}
            />

            {mod.lessons.map((lesson, li) => (
              <div key={lesson.id ?? `nova-${mi}-${li}`} className="builder-lesson">
                <div className="row wrap" style={{ gap: 8 }}>
                  <input
                    className="input grow"
                    value={lesson.title}
                    onChange={(e) => patchLesson(mi, li, { title: e.target.value })}
                    placeholder="Título da aula"
                    aria-label={`Título da aula ${li + 1}`}
                  />
                  <select
                    className="select"
                    style={{ width: 'auto' }}
                    value={lesson.type}
                    onChange={(e) => patchLesson(mi, li, { type: e.target.value })}
                    aria-label="Tipo da aula"
                  >
                    {Object.entries(LESSON_TYPE).map(([value, meta]) => (
                      <option key={value} value={value}>{meta.label}</option>
                    ))}
                  </select>
                  <input
                    className="input"
                    style={{ width: 110 }}
                    type="number"
                    min="0"
                    value={lesson.durationSeconds}
                    onChange={(e) => patchLesson(mi, li, { durationSeconds: e.target.value })}
                    aria-label="Duração em segundos"
                    title="Duração em segundos"
                  />
                </div>

                {lesson.type === 'video' && (
                  <input
                    className="input"
                    value={lesson.videoUrl}
                    onChange={(e) => patchLesson(mi, li, { videoUrl: e.target.value })}
                    placeholder="URL do vídeo (opcional)"
                    aria-label="URL do vídeo"
                  />
                )}

                {lesson.type === 'text' && (
                  <textarea
                    className="textarea"
                    style={{ minHeight: 140 }}
                    value={lesson.content}
                    onChange={(e) => patchLesson(mi, li, { content: e.target.value })}
                    placeholder="Conteúdo da leitura, em Markdown"
                    aria-label="Conteúdo da leitura"
                  />
                )}

                {lesson.type === 'quiz' && (
                  <p className="hint">As perguntas do quiz são criadas à parte, no banco, após a aula existir.</p>
                )}

                <div className="row-between wrap" style={{ gap: 8 }}>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(lesson.isPreview)}
                      onChange={(e) => patchLesson(mi, li, { isPreview: e.target.checked })}
                    />
                    Aula gratuita (aparece como prévia para quem não matriculou)
                  </label>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => moveLesson(mi, li, -1)}
                      disabled={li === 0}
                      aria-label="Mover aula para cima"
                    >
                      <Icon name="caretDown" size={16} style={{ transform: 'rotate(180deg)' }} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => moveLesson(mi, li, 1)}
                      disabled={li === mod.lessons.length - 1}
                      aria-label="Mover aula para baixo"
                    >
                      <Icon name="caretDown" size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => removeLesson(mi, li)}
                      aria-label="Remover aula"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => patchModule(mi, { lessons: [...mod.lessons, emptyLesson()] })}
            >
              <Icon name="plus" size={15} /> Adicionar aula
            </button>
          </div>
        </div>
      ))}

      <div className="row wrap" style={{ gap: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={submit}
          disabled={loading || modules.length === 0 || modules.some((m) => !m.title.trim() || m.lessons.some((l) => !l.title.trim()))}
        >
          {loading ? <Spinner /> : 'Salvar currículo'}
        </button>
        <span className="hint">
          Aulas e módulos que já existiam são atualizados no lugar: o progresso dos alunos é preservado.
        </span>
      </div>
    </div>
  );
}
