import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { learningApi, quizApi } from '../api/client.js';
import { useApi, useSubmit } from '../hooks/useApi.js';
import { Alert } from '../components/Alert.jsx';
import { ProgressBar } from '../components/ProgressBar.jsx';
import { Spinner, ErrorState, LoadingBlock, EmptyState } from '../components/Feedback.jsx';
import { Icon } from '../components/Icon.jsx';
import { formatTime, formatDuration, LESSON_TYPE, badgeIcon } from '../utils/format.js';

export function LearningPage() {
  const { courseId } = useParams();
  const [params, setParams] = useSearchParams();

  const [lessonId, setLessonId] = useState(params.get('aula') || null);
  const [feedback, setFeedback] = useState(null);

  const { data: outline, loading, error, refetch } = useApi(() => learningApi.outline(courseId), [courseId]);

  // A API responde módulos agrupados; o player trabalha com uma lista plana.
  const lessons = useMemo(
    () => (outline?.modules ?? []).flatMap((m) => m.lessons ?? []),
    [outline?.modules],
  );

  const current = useMemo(
    () => lessons.find((l) => l.id === lessonId) ?? lessons.find((l) => !l.completed) ?? lessons[0],
    [lessons, lessonId],
  );

  const index = lessons.findIndex((l) => l.id === current?.id);
  const next = lessons[index + 1];
  const prev = lessons[index - 1];

  // Mantém a URL e a lição corrente em sincronia.
  useEffect(() => {
    if (!current || current.id === lessonId) return;
    setLessonId(current.id);
    setParams({ aula: String(current.id) }, { replace: true });
  }, [current?.id]);

  const { submit: saveProgress, loading: saving } = useSubmit(
    async (body) => learningApi.saveProgress(courseId, current.id, body),
  );

  // Trava o aviso de conclusão por aula, para os heartbeats não repetirem.
  const completedOnce = useRef(Boolean(current?.completed));

  /*
   * O servidor é quem conclui, então o sucesso vem no `result.completion`, não
   * no que pedimos. Era `body.completed` a decidir a mensagem — o que fazia o
   * aluno ver "Aula concluída!" enquanto o servidor ainda não tinha aceitado,
   * e o oposto: pedir conclusão e ficar sem aviso nenhum quando o servidor
   * recusava (vídeo ainda sem tempo assistido).
   */
  const persist = async (body) => {
    try {
      const result = await saveProgress(body);
      if (result?.completion?.completed && !completedOnce.current) {
        completedOnce.current = true;
        setFeedback({ variant: 'success', text: 'Aula concluída! Seus pontos foram atualizados.' });
        refetch();
      }
      return result;
    } catch (err) {
      // Falha pontual de progresso não invalida a aula assistida.
      if (body.completed) setFeedback({ variant: 'danger', text: err.message });
      return null;
    }
  };

  if (loading) return <LoadingBlock label="Carregando suas aulas..." />;
  if (error) {
    return (
      <div className="container page">
        <ErrorState error={error} onRetry={refetch} title="Não foi possível abrir o curso" />
        <p className="center" style={{ marginTop: 16 }}>
          <Link className="btn btn-secondary" to="/minha-conta">Voltar aos meus cursos</Link>
        </p>
      </div>
    );
  }

  const completedCount = outline?.completedLessons ?? 0;
  const totalLessons = outline?.totalLessons ?? lessons.length;
  const progressPct = totalLessons ? Math.round((completedCount / totalLessons) * 100) : 0;

  return (
    <div className="app-main learning-grid">
      <div className="stack" style={{ gap: 16, padding: '20px 16px 32px', minWidth: 0 }}>
        <div className="row-between wrap">
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <h1 className="truncate" style={{ margin: 0, fontSize: '1.3rem' }}>{outline?.course?.title}</h1>
            <span className="small muted">
              Aula {index + 1} de {lessons.length} · {LESSON_TYPE[current?.type]?.label ?? 'Conteúdo'}
            </span>
          </div>
          <Link className="btn btn-ghost btn-sm row" style={{ gap: 6 }} to="/minha-conta">
            <Icon name="caretLeft" size={14} /> Meus cursos
          </Link>
        </div>

        {feedback && (
          <Alert variant={feedback.variant} onClose={() => setFeedback(null)}>
            {feedback.text}
          </Alert>
        )}

        {current?.type === 'quiz' ? (
          <QuizPanel
            key={current.id}
            lessonId={current.id}
            onPassed={() => {
              refetch();
              setFeedback({ variant: 'success', text: 'Quiz registrado! Veja seu badge na aba Conquistas.' });
            }}
          />
        ) : (
          <LessonPlayer key={current?.id} lesson={current} onProgress={persist} saving={saving} />
        )}

        <div className="row-between wrap" style={{ gap: 10 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm row"
            style={{ gap: 6 }}
            onClick={() => prev && setLessonId(prev.id)}
            disabled={!prev}
          >
            <Icon name="caretLeft" size={14} /> Anterior
          </button>

          {/* Aula de vídeo com arquivo é concluída pelo servidor, conforme o
              tempo assistido. O botão aqui só existe para texto e para o
              modo demonstração — oferecer conclusão de vídeo seria mostrar um
              botão que o servidor recusa. */}
          {current?.type !== 'quiz' && !current?.completed && !current?.requiresWatchTime && (
            <button
              type="button"
              className="btn btn-success btn-sm"
              onClick={() => persist({ positionSeconds: Math.round(current?.lastPosition ?? 0), completed: true })}
              disabled={saving}
            >
              {saving && <Spinner />} Marcar como concluída
            </button>
          )}

          <button
            type="button"
            className="btn btn-primary btn-sm row"
            style={{ gap: 6 }}
            onClick={() => next && setLessonId(next.id)}
            disabled={!next}
          >
            Próxima <Icon name="caretRight" size={14} />
          </button>
        </div>

        <div className="card card-pad">
          <ProgressBar value={progressPct} label={`Progresso do curso · ${formatDuration(outline?.course?.durationMinutes)}`} success={progressPct >= 100} />
        </div>
      </div>

      <aside className="card learning-aside" style={{ borderRadius: 0, borderLeft: 0, borderBottom: 0, maxHeight: '70vh', overflow: 'auto' }}>
        <div
          className="row-between"
          style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--ink-400)', padding: '14px 16px', borderBottom: '1px solid var(--ink-200)' }}
        >
          <strong className="small">Conteúdo</strong>
          <span className="tiny muted">{completedCount}/{totalLessons}</span>
        </div>

        {(outline?.modules ?? []).map((module, mi) => (
          <section key={module.id} className="learning-module">
            <div className="learning-module-title">
              <span className="truncate">{String(mi + 1).padStart(2, '0')} · {module.title}</span>
              <span>{module.lessons?.length ?? 0}</span>
            </div>
            {(module.lessons ?? []).map((lesson, li) => {
              const type = LESSON_TYPE[lesson.type] ?? LESSON_TYPE.video;
              const active = lesson.id === current?.id;
              return (
                <button
                  key={lesson.id}
                  type="button"
                  onClick={() => setLessonId(lesson.id)}
                  className="row"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    gap: 10,
                    padding: '11px 16px',
                    border: 0,
                    borderTop: '1px solid var(--ink-200)',
                    background: active ? 'var(--brand-50)' : 'transparent',
                    cursor: 'pointer',
                    font: 'inherit',
                    color: 'var(--ink-800)',
                  }}
                >
                  <span className={`icon-chip${lesson.completed ? ' is-done' : ''}`} aria-hidden="true">
                    <Icon name={lesson.completed ? 'check' : type.icon} size={16} />
                  </span>
                  <span className="stack grow" style={{ gap: 0, minWidth: 0 }}>
                    <span
                      className="small truncate"
                      style={{ fontWeight: active ? 700 : 400, color: active ? 'var(--brand-700)' : 'var(--ink-800)' }}
                    >
                      {mi + 1}.{li + 1} {lesson.title}
                    </span>
                    {lesson.durationSeconds ? <span className="tiny muted">{formatTime(lesson.durationSeconds)}</span> : null}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </aside>
    </div>
  );
}

/**
 * Player com <video> nativo e retomada de posição. Cursos sem `videoUrl`
 * (caso do seed) caem num modo de leitura funcional em vez de player quebrado.
 */
/** Intervalo entre heartbeats enviados ao servidor. */
const HEARTBEAT_MS = 15000;

function LessonPlayer({ lesson, onProgress, saving }) {
  const videoRef = useRef(null);
  const [position, setPosition] = useState(lesson?.lastPosition ?? 0);
  const [watched, setWatched] = useState(lesson?.watchedSeconds ?? 0);

  /*
   * O envio é controlado por TEMPO DE RELÓGIO, não pela posição do vídeo.
   * Antes a condição era `position - ultima >= 15`, o que num `seek` disparava
   * vários envios seguidos, e o servidor via um intervalo novo em cada um.
   * O servidor já limita o crédito pelo tempo decorrido; o cliente só precisa
   * não multiplicar os envios.
   */
  const lastBeatAt = useRef(0);
  const sentComplete = useRef(Boolean(lesson?.completed));

  useEffect(() => {
    const resume = lesson?.lastPosition ?? 0;
    setPosition(resume);
    setWatched(lesson?.watchedSeconds ?? 0);
    lastBeatAt.current = 0;
    sentComplete.current = Boolean(lesson?.completed);
  }, [lesson?.id, lesson?.lastPosition, lesson?.watchedSeconds, lesson?.completed]);

  if (!lesson) {
    return (
      <EmptyState
        icon="file"
        title="Nenhuma aula disponível"
        description="Este curso ainda não tem conteúdo publicado."
        action={<Link className="btn btn-primary" to="/minha-conta">Voltar</Link>}
      />
    );
  }

  if (lesson.locked) {
    return <EmptyState icon="lock" title="Aula bloqueada" description="Você precisa estar matriculado para assistir." />;
  }

  if (!lesson.videoUrl) {
    return (
      <div className="card card-pad stack" style={{ gap: 12, minHeight: 300 }}>
        <div
          className="row"
          style={{ justifyContent: 'center', padding: 24, background: 'var(--ink-300)', borderRadius: 'var(--radius)', color: 'var(--ink-800)', minHeight: 240 }}
        >
          <span className="center stack" style={{ gap: 6, alignItems: 'center' }}>
            <span className="trust-icon" aria-hidden="true">
              <Icon name="play" size={22} />
            </span>
            <strong>Player em modo demonstração</strong>
            <p className="small muted" style={{ margin: 0 }}>
              Este curso ainda não possui arquivo de vídeo cadastrado.
            </p>
          </span>
        </div>

        <h2 style={{ margin: 0 }}>{lesson.title}</h2>
        {lesson.content
          ? lesson.content.split('\n').map((paragraph, i) => (
              <p key={i} className="muted" style={{ margin: 0 }}>{paragraph}</p>
            ))
          : <p className="muted" style={{ margin: 0 }}>Conteúdo da aula em preparação pela equipe LearnUp.</p>}

        <button
          type="button"
          className="btn btn-success"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => onProgress({ positionSeconds: 0, completed: true })}
          disabled={saving || lesson.completed}
        >
          {saving && <Spinner />}
          {lesson.completed ? (
            <>
              <Icon name="check" size={15} /> Concluída
            </>
          ) : (
            'Concluir aula'
          )}
        </button>
      </div>
    );
  }

  /*
   * Envia um heartbeat com a posição atual. `completed` NÃO vai aqui: quem
   * conclui uma aula de vídeo é o servidor, depois de somar o tempo
   * assistido. Mandar `completed: true` seria pedir exatamente o que a
   * validação existe para não aceitar.
   */
  const beat = async (video) => {
    const seconds = Math.floor(video.currentTime);
    lastBeatAt.current = Date.now();
    const result = await onProgress({
      positionSeconds: seconds,
      durationSeconds: Math.floor(video.duration) || lesson.durationSeconds,
    });
    /*
     * Espelha o tempo que o SERVIDOR aceitou, não o que o vídeo mostra. Se ele
     * recusou parte do avanço (ex.: heartbeat atrasado), a barra fica atrás da
     * posição do vídeo — que é o correto, porque é isso que vale para concluir.
     */
    if (typeof result?.completion?.watched === 'number') setWatched(result.completion.watched);
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="card" style={{ overflow: 'hidden', background: '#000', borderRadius: 'var(--radius-lg)' }}>
        <video
          ref={videoRef}
          src={lesson.videoUrl}
          controls
          playsInline
          preload="metadata"
          style={{ width: '100%', display: 'block', aspectRatio: '16 / 9' }}
          onLoadedMetadata={(e) => {
            const resume = lesson.lastPosition ?? 0;
            if (resume > 0 && resume < e.currentTarget.duration - 5) e.currentTarget.currentTime = resume;
            setPosition(e.currentTarget.currentTime);
          }}
          onTimeUpdate={(e) => {
            const current = e.currentTarget.currentTime;
            setPosition(current);
            // Dispara várias vezes por segundo; o relógio decide o ritmo.
            if (e.currentTarget.paused) return;
            if (Date.now() - lastBeatAt.current < HEARTBEAT_MS) return;
            beat(e.currentTarget);
          }}
          onPlay={(e) => {
            // Zera o relógio ao retomar: o tempo parado não pode contar como
            // se tivesse sido assistido, e o intervalo anterior seria enorme.
            lastBeatAt.current = 0;
            beat(e.currentTarget);
          }}
          onPause={(e) => {
            if (e.currentTarget.currentTime > 0) beat(e.currentTarget);
          }}
          onEnded={(e) => {
            // Chegou ao fim: manda a posição final. A conclusão é do servidor,
            // e ele só concorda se o tempo realmente assistido chegar a 90%.
            if (lastBeatAt.current) beat(e.currentTarget);
            setPosition(e.currentTarget.duration);
          }}
        />
      </div>

      <div className="row-between small muted">
        <span>{formatTime(position)} · {lesson.title}</span>
        {lesson.requiresWatchTime ? (
          <WatchProgress
            watched={watched}
            required={lesson.requiredWatchSeconds}
            completed={lesson.completed}
          />
        ) : null}
      </div>

      {!lesson.requiresWatchTime && (
        <div className="row-end">
          <button
            type="button"
            className="btn btn-success btn-sm"
            onClick={() => onProgress({ positionSeconds: Math.floor(position), completed: true })}
            disabled={saving || lesson.completed}
          >
            {lesson.completed ? (
              <>
                <Icon name="check" size={15} /> Concluída
              </>
            ) : (
              'Concluir aula'
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Mostra o progresso real de tempo assistido no vídeo.
 *
 * A barra é alimentada pelo que o SERVIDOR aceitou (`watched`), não pela
 * posição do vídeo — que o aluno pode arrastar para qualquer lado. Assim a
 * tela não promete conclusão que ainda não vai aparecer na lista de aulas.
 */
function WatchProgress({ watched, required, completed }) {
  if (completed) {
    return (
      <span className="row" style={{ gap: 6, color: 'var(--success-600)', fontWeight: 600 }}>
        <Icon name="check" size={15} /> Aula concluída
      </span>
    );
  }
  if (!required) return null;

  const pct = Math.min(100, Math.round((watched / required) * 100));
  const missing = Math.max(0, required - watched);

  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="tiny muted">
        {missing > 0 ? `Faltam ${formatDuration(missing)} de tempo assistido` : 'Concluindo...'}
      </span>
      <span className="progress" style={{ width: 90 }} aria-hidden="true">
        <span className="progress-fill" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/** Quiz endereçado pela aula. A correção acontece no servidor. */
function QuizPanel({ lessonId, onPassed }) {
  const { data, loading, error, refetch } = useApi(() => quizApi.forLesson(lessonId), [lessonId]);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const quiz = data?.quiz;

  const submit = async () => {
    setBusy(true);
    setSubmitError(null);
    try {
      const payload = Object.entries(answers).map(([questionId, optionId]) => ({ questionId, optionId }));
      const res = await quizApi.submit(lessonId, payload);
      setResult(res);
      if (res.passed) onPassed?.();
    } catch (err) {
      setSubmitError(err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Carregando quiz..." />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!quiz?.questions?.length) {
    return <EmptyState icon="chart" title="Quiz sem perguntas" description="Esta aula ainda não tem um questionário." />;
  }

  if (result) {
    return (
      <div className="card card-pad stack">
        <h2 style={{ margin: 0 }}>Resultado: {result.scorePercent}%</h2>
        <p style={{ margin: 0 }}>
          Você acertou {result.correctCount} de {result.totalQuestions} perguntas.{' '}
          {result.passed
            ? result.pointsAwarded > 0
              ? `Aprovado! +${result.pointsAwarded} pontos.`
              : 'Aprovado! (os pontos desta aprovação já tinham sido concedidos).'
            : 'Nota abaixo do mínimo — revise o conteúdo e tente de novo.'}
        </p>
        {result.pointsAwarded > 0 && <span className="badge badge-brand">+{result.pointsAwarded} pontos</span>}
        {result.newBadges?.length > 0 && (
          <div className="row wrap" style={{ gap: 6 }}>
            {result.newBadges.map((b) => (
              <span key={b.key} className="badge badge-gold"><Icon name={badgeIcon(b)} size={13} /> {b.name}</span>
            ))}
          </div>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setResult(null);
            setAnswers({});
            refetch();
          }}
        >
          Refazer quiz
        </button>
      </div>
    );
  }

  return (
    <div className="card card-pad stack" style={{ gap: 18 }}>
      <div className="stack" style={{ gap: 2 }}>
        <h2 style={{ margin: 0 }}>{quiz.title}</h2>
        <span className="small muted">
          Nota mínima: {quiz.passPercent}% · {quiz.questions.length} perguntas
          {quiz.attemptsLeft !== null && quiz.attemptsLeft !== undefined && ` · ${quiz.attemptsLeft} tentativa(s) restante(s)`}
        </span>
      </div>

      {submitError && <Alert variant="danger">{submitError.message}</Alert>}

      {quiz.questions.map((q, qi) => (
        <fieldset key={q.id} className="stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
          <legend style={{ fontWeight: 600, padding: 0 }}>{qi + 1}. {q.prompt}</legend>
          {q.options.map((opt) => (
            <label
              key={opt.id}
              className={`option-card${answers[q.id] === opt.id ? ' selected' : ''}`}
            >
              <input
                type="radio"
                name={q.id}
                checked={answers[q.id] === opt.id}
                onChange={() => setAnswers((a) => ({ ...a, [q.id]: opt.id }))}
              />
              <span className="small">{opt.label}</span>
            </label>
          ))}
        </fieldset>
      ))}

      <button type="button" className="btn btn-primary btn-lg" onClick={submit} disabled={busy || Object.keys(answers).length === 0}>
        {busy && <Spinner />} Enviar respostas
      </button>
    </div>
  );
}
