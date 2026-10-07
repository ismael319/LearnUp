import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { coursesApi, learningApi, platformApi } from '../api/client.js';
import { useApi, useSubmit } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert } from '../components/Alert.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { CourseCard } from '../components/CourseCard.jsx';
import { ProgressBar } from '../components/ProgressBar.jsx';
import { EmptyState, ErrorState, LoadingBlock, Spinner } from '../components/Feedback.jsx';
import { Icon } from '../components/Icon.jsx';
import { useCart } from '../context/CartContext.jsx';
import { formatDuration, formatPrice, formatRating, formatNumber, timeAgo, LEVEL_LABEL } from '../utils/format.js';

const TABS = [
  { id: 'sobre', label: 'Sobre' },
  { id: 'conteudo', label: 'Conteúdo' },
  { id: 'avaliacoes', label: 'Avaliações' },
];

const formatWorkload = (minutes) => {
  const total = Math.max(0, Math.round(minutes || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const hourLabel = hours === 1 ? 'hora' : 'horas';
  const minuteLabel = rest === 1 ? 'minuto' : 'minutos';
  if (hours && rest) return `${hours} ${hourLabel} e ${rest} ${minuteLabel}`;
  if (hours) return `${hours} ${hourLabel}`;
  return `${rest} ${minuteLabel}`;
};

const joinInPortuguese = (items) => {
  if (items.length < 2) return items[0] ?? '';
  if (items.length === 2) return items.join(' e ');
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
};

export function CourseDetailPage() {
  const { slug } = useParams();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const { add } = useCart();

  const [tab, setTab] = useState('sobre');
  const [enrolled, setEnrolled] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [actionError, setActionError] = useState(null);
  const [review, setReview] = useState({ rating: '5', comment: '' });

  // A API responde no envelope `{ course: {...} }`; desembrulhamos aqui para
  // o resto da página usar `course.id`, `course.title` etc. direto.
  const { data: coursePayload, loading, error, refetch } = useApi(() => coursesApi.detail(slug), [slug]);
  const course = coursePayload?.course ?? null;
  const { data: publicSettings } = useApi(() => platformApi.settings(), []);
  // `/reviews` do backend só aceita UUID (o `detail` resolve slug, o reviews
  // não), então passamos `course.id` e não o slug da URL.
  const { data: reviewsData, refetch: refetchReviews } = useApi(() => coursesApi.reviews(course.id), [course?.id], { skip: !course });
  const { data: related } = useApi(
    () => coursesApi.list({ category: course.categorySlug, limit: 4, sort: 'relevance' }),
    [course?.id],
    { skip: !course },
  );

  const { submit: doEnroll, loading: enrolling } = useSubmit(async () => {
    const { enrollment } = await learningApi.enrollFree(course.id);
    setEnrolled(true);
    return enrollment;
  });
  const { submit: submitReview, loading: savingReview } = useSubmit(async () => {
    await coursesApi.addReview(course.id, { rating: Number(review.rating), comment: review.comment });
    setReview({ rating: '5', comment: '' });
    return refetchReviews();
  });

  // O detalhe não traz o progresso: buscamos na lista de matrículas.
  useEffect(() => {
    if (!isAuthenticated || !course) return;
    let cancelled = false;

    (async () => {
      try {
        const { enrollments } = await learningApi.list();
        if (cancelled) return;
        const match = enrollments.find((e) => e.courseId === course.id);
        if (match) {
          setEnrolled(true);
          setProgressPct(match.progressPercent ?? 0);
        }
      } catch {
        // Sem matrícula ou API fora: a ação "matricular" continua visível.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, course?.id]);

  const goToLearn = async () => {
    if (!isAuthenticated) {
      navigate('/entrar', { state: { from: `/cursos/${slug}` } });
      return;
    }
    if (!enrolled && course.priceCents === 0) {
      setActionError(null);
      try {
        await doEnroll();
      } catch (err) {
        setActionError(err.message);
        return;
      }
    }
    navigate(`/aprender/${course.id}`);
  };

  const buy = () => {
    if (!isAuthenticated) {
      navigate('/entrar', { state: { from: `/cursos/${slug}` } });
      return;
    }
    add(course);
    navigate('/carrinho');
  };

  if (loading) return <LoadingBlock label="Carregando curso..." />;
  if (error) {
    return (
      <div className="container page">
        <ErrorState error={error} onRetry={refetch} title="Curso não encontrado" />
      </div>
    );
  }
  if (!course) return null;

  const free = course.priceCents === 0;
  const reviews = reviewsData?.reviews ?? [];
  const moduleCount = course.modules?.length ?? 0;
  const totalLessons = course.modules?.reduce((sum, m) => sum + (m.lessonCount ?? 0), 0) ?? 0;
  const highlights = [
    'Acesso vitalício, inclusive atualizações',
    `${formatNumber(totalLessons)} aulas em vídeo e leitura`,
    'Progresso salvo automaticamente',
    ...(course.certificateEnabled ? ['Certificado de conclusão verificável'] : []),
    'Acesso à comunidade de alunos',
  ];
  const certificateValidityYears = Number(publicSettings?.settings?.['certificate.validity_years']) || 1;
  const courseFormatParts = [
    course.modules?.some((module) => module.lessons?.some((lesson) => lesson.type === 'video')) && 'aulas em vídeo',
    course.modules?.some((module) => module.lessons?.some((lesson) => lesson.type === 'text')) && 'leituras guiadas e estudos aplicados',
    course.modules?.some((module) => module.lessons?.some((lesson) => lesson.type === 'quiz')) && 'avaliação final',
  ].filter(Boolean);
  const benefits = [
    {
      icon: 'clock',
      title: 'Carga horária',
      description: `${formatWorkload(course.durationMinutes)} de treinamento.`,
    },
    ...(course.certificateEnabled
      ? [
          {
            icon: 'certificate',
            title: 'Certificado',
            description: 'Certificado digital liberado ao concluir o treinamento.',
          },
          {
            icon: 'shield',
            title: 'Validade do certificado',
            description: `${certificateValidityYears} ${certificateValidityYears === 1 ? 'ano' : 'anos'} a partir da conclusão.`,
          },
        ]
      : []),
  ];

  return (
    <div className="container page">
      <nav className="small muted" style={{ marginBottom: 16 }} aria-label="Você está em">
        <Link to="/catalogo">Catálogo</Link> › <span>{course.categoryName}</span> ›{' '}
        <span className="strong">{course.title}</span>
      </nav>

      {actionError && (
        <div style={{ marginBottom: 16 }}>
          <Alert variant="danger" onClose={() => setActionError(null)}>
            {actionError}
          </Alert>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
        <div className="stack" style={{ gap: 20 }}>
          {course.coverUrl && (
            <img src={course.coverUrl} alt="" className="cover card" style={{ borderRadius: 'var(--radius-lg)' }} />
          )}

          <div className="stack" style={{ gap: 12 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="badge badge-brand course-category-badge">{course.categoryName}</span>
              <span className="badge">{LEVEL_LABEL[course.level]}</span>
              {course.status !== 'published' && <span className="badge badge-warning">Rascunho</span>}
            </div>

            <h1 style={{ margin: 0 }}>{course.title}</h1>

            <div className="course-meta">
              <span><Icon name="clock" size={14} /> {formatWorkload(course.durationMinutes)}</span>
              <span><Icon name="list" size={14} /> {moduleCount} módulo{moduleCount === 1 ? '' : 's'}</span>
              {course.certificateEnabled && <span><Icon name="certificate" size={14} /> Certificado incluso</span>}
              {course.certificateEnabled && (
                <span><Icon name="shield" size={14} /> Validade de {certificateValidityYears} {certificateValidityYears === 1 ? 'ano' : 'anos'}</span>
              )}
            </div>

            {enrolled && (
              <div className="card card-pad">
                <ProgressBar value={progressPct} label="Seu progresso" success={progressPct >= 100} />
              </div>
            )}
          </div>

          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`tab${tab === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === 'avaliacoes' && ` (${formatNumber(course.ratingCount)})`}
              </button>
            ))}
          </div>

          {tab === 'sobre' && (
            <div className="card card-pad stack">
              <section className="stack" style={{ gap: 12 }}>
                <h2 style={{ margin: 0 }}>Sobre o treinamento</h2>
                {course.subtitle && (
                  <p style={{ margin: 0 }}><strong>Curso:</strong> {course.subtitle}</p>
                )}
              {(course.description ?? '')
                .split('\n')
                .filter(Boolean)
                .map((paragraph, i) => (
                  <p key={i} className="muted" style={{ margin: 0 }}>
                    {paragraph}
                  </p>
                ))}
                <div className="stack" style={{ gap: 4 }}>
                  <h3 style={{ margin: 0 }}>Formato</h3>
                  <p className="muted" style={{ margin: 0 }}>
                    {courseFormatParts.length
                      ? `Curso online autoinstrucional, com ${joinInPortuguese(courseFormatParts)}.`
                      : 'Curso online autoinstrucional com conteúdo em preparação.'}
                  </p>
                </div>
              </section>

              <section className="stack" style={{ gap: 12 }}>
                <h2 style={{ margin: 0 }}>O que você recebe</h2>
                <div className="receive-grid">
                  {benefits.map((benefit) => (
                    <article key={benefit.title} className="receive-card">
                      <span className="icon-chip" aria-hidden="true"><Icon name={benefit.icon} size={17} /></span>
                      <strong>{benefit.title}</strong>
                      <p>{benefit.description}</p>
                    </article>
                  ))}
                </div>
              </section>

              <hr className="divider" />

              <div className="stack" style={{ gap: 10 }}>
                <h3 style={{ margin: 0 }}>Instrutor</h3>
                <div className="row">
                  <Avatar name={course.instructorName} src={course.instructorAvatarUrl} />
                  <div className="stack" style={{ gap: 0 }}>
                    <strong>{course.instructorName}</strong>
                    {course.instructorBio && <span className="small muted clamp-2">{course.instructorBio}</span>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'conteudo' && (
            <div className="card" style={{ overflow: 'hidden' }}>
              <div className="card-pad row-between" style={{ borderBottom: '1px solid var(--ink-200)' }}>
                <h3 style={{ margin: 0 }}>Conteúdo programático</h3>
                <span className="small muted">
                  {moduleCount} módulo{moduleCount === 1 ? '' : 's'} · {formatWorkload(course.durationMinutes)}
                </span>
              </div>

              {!course.modules?.length ? (
                <EmptyState icon="file" title="Conteúdo em preparação" />
              ) : (
                <div className="course-modules">
                  {course.modules.map((module, mi) => {
                    const lessons = module.lessons ?? [];
                    const preview = lessons.find((lesson) => lesson.isPreview);
                    return (
                      <details key={module.id} className="course-module" open>
                        <summary>
                          <span className="row" style={{ gap: 12, minWidth: 0 }}>
                            <span className="module-number" aria-hidden="true">{String(mi + 1).padStart(2, '0')}</span>
                            <span className="stack" style={{ gap: 1, minWidth: 0 }}>
                              <strong className="small">{module.title}</strong>
                              <span className="tiny muted">
                                {module.lessonCount} aula{module.lessonCount === 1 ? '' : 's'} · {formatDuration(Math.round((module.durationSeconds ?? 0) / 60))}
                              </span>
                            </span>
                          </span>
                          <Icon className="course-module-caret" name="caretDown" size={16} aria-hidden="true" />
                        </summary>

                        <div className="course-module-body">
                          {module.description && <p className="small muted">{module.description}</p>}
                          {preview && (
                            <Link className="btn btn-ghost btn-sm" to={`/prever/${course.id}?aula=${preview.id}`}>
                              <Icon name="play" size={14} /> Abrir prévia
                            </Link>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'avaliacoes' && (
            <div className="card card-pad stack">
              {enrolled && (
                <form className="card card-pad stack" onSubmit={(event) => { event.preventDefault(); submitReview().catch((err) => setActionError(err.message)); }}>
                  <strong>Conte como foi sua experiência</strong>
                  <select className="select" value={review.rating} onChange={(event) => setReview((value) => ({ ...value, rating: event.target.value }))} aria-label="Sua nota">
                    {[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} estrela{rating === 1 ? '' : 's'}</option>)}
                  </select>
                  <textarea className="textarea" value={review.comment} onChange={(event) => setReview((value) => ({ ...value, comment: event.target.value }))} placeholder="Comentário opcional" maxLength="1000" />
                  <button type="submit" className="btn btn-secondary" disabled={savingReview}>{savingReview ? 'Enviando...' : 'Enviar avaliação'}</button>
                </form>
              )}
              <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
                {/* Sem avaliações não há nota: "0,0" com cinco estrelas vazias
                    parece um erro. Dizer que ainda não há é o correcto. */}
                {course.ratingCount > 0 ? (
                  <div className="center">
                    <div style={{ fontSize: '2.6rem', fontWeight: 800, color: 'var(--ink-900)' }}>
                      {formatRating(course.ratingAvg)}
                    </div>
                    <div className="row" style={{ gap: 2 }} aria-hidden="true">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Icon
                          key={n}
                          name="star"
                          size={16}
                          style={{ color: n <= Math.round(course.ratingAvg) ? 'var(--gold-500)' : 'var(--ink-500)' }}
                        />
                      ))}
                    </div>
                    <span className="small muted">{formatNumber(course.ratingCount)} avaliações</span>
                  </div>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>
                    Este curso ainda não tem avaliações.
                  </p>
                )}

                {/* O histograma sai das linhas de `reviews`. Com o seed atual
                    não há nenhuma linha, mas o curso já vem com ratingAvg/
                    ratingCount preenchidos — renderizar as barras zeradas ao
                    lado de "47 avaliações" se contradiz. Só mostramos quando
                    há avaliações de verdade para sustentar o gráfico. */}
                {reviews.length > 0 && (
                  <div className="grow stack" style={{ gap: 6, minWidth: 220 }}>
                    {[5, 4, 3, 2, 1].map((star) => {
                      const count = reviews.filter((r) => r.rating === star).length;
                      const total = reviews.length || 1;
                      return (
                        <div key={star} className="row" style={{ gap: 8 }}>
                          <span className="tiny muted row" style={{ width: 28, gap: 4 }}>
                            {star} <Icon name="starFill" size={12} />
                          </span>
                          <div className="progress grow">
                            <div className="progress-bar" style={{ width: `${(count / total) * 100}%` }} />
                          </div>
                          <span className="tiny muted" style={{ width: 22, textAlign: 'right' }}>{count}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {reviews.length ? (
                reviews.map((r) => (
                  <div key={r.id} className="stack" style={{ gap: 4, paddingTop: 12, borderTop: '1px solid var(--ink-200)' }}>
                    <div className="row-between">
                      <span className="strong small">{r.userName}</span>
                      <span className="tiny muted">{timeAgo(r.createdAt)}</span>
                    </div>
                    <span
                      className="row"
                      aria-label={`${r.rating} de 5 estrelas`}
                      style={{ color: 'var(--warning-600)', gap: 1 }}
                    >
                      {Array.from({ length: 5 }, (_, n) => (
                        <Icon key={n} name={n < r.rating ? 'starFill' : 'star'} size={13} />
                      ))}
                    </span>
                    {r.comment && <p className="small" style={{ margin: 0 }}>{r.comment}</p>}
                  </div>
                ))
              ) : (
                <EmptyState icon="star" title="Ainda sem avaliações" description="Seja a primeira pessoa a avaliar este curso." />
              )}
            </div>
          )}
        </div>

        <aside className="card card-pad stack" style={{ gap: 14 }}>
          <div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color: free ? 'var(--success-600)' : 'var(--ink-900)' }}>
              {free ? 'Gratuito' : formatPrice(course.priceCents)}
            </div>
            <p className="small muted" style={{ margin: 0 }}>Pagamento único · acesso vitalício</p>
          </div>

          {enrolled ? (
            <>
              <Link className="btn btn-primary btn-lg btn-block" to={`/aprender/${course.id}`}>
                {progressPct > 0 ? 'Continuar de onde parei' : 'Começar agora'}
              </Link>
              <Link className="btn btn-secondary btn-block" to="/minha-conta">
                Ver meus cursos
              </Link>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-primary btn-lg btn-block"
                onClick={free ? goToLearn : buy}
                disabled={enrolling}
              >
                {enrolling && <Spinner />}
                {free ? 'Matricular-se grátis' : 'Comprar curso'}
              </button>
              <button type="button" className="btn btn-secondary btn-block" onClick={() => setTab('conteudo')}>
                Ver conteúdo
              </button>
            </>
          )}

          <ul className="stack small" style={{ listStyle: 'none', padding: 0, margin: 0, gap: 8 }}>
            {highlights.map((item) => (
              <li key={item} style={{ display: 'flex', gap: 8 }}>
                <Icon name="check" size={15} style={{ color: 'var(--success-600)' }} /> {item}
              </li>
            ))}
          </ul>

          <hr className="divider" style={{ margin: '4px 0' }} />
          <span className="tiny muted">Garantia de 7 dias: cancele e receba o valor de volta.</span>
        </aside>
      </div>

      {related?.courses?.filter((c) => c.id !== course.id).length > 0 && (
        <section className="stack" style={{ marginTop: 48 }}>
          <h2 style={{ margin: 0 }}>Cursos relacionados</h2>
          <div className="grid grid-cards">
            {related.courses
              .filter((c) => c.id !== course.id)
              .map((c) => (
                <CourseCard key={c.id} course={c} />
              ))}
          </div>
        </section>
      )}
    </div>
  );
}
