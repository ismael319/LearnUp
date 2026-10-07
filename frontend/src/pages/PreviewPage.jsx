import { Link, useParams, useSearchParams } from 'react-router-dom';
import { learningApi } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { ErrorState, LoadingBlock } from '../components/Feedback.jsx';
import { Icon } from '../components/Icon.jsx';

export function PreviewPage() {
  const { courseId } = useParams();
  const [params] = useSearchParams();
  const { data, loading, error, refetch } = useApi(() => learningApi.preview(courseId), [courseId]);
  if (loading) return <LoadingBlock label="Carregando prévia..." />;
  if (error) return <div className="container page"><ErrorState error={error} onRetry={refetch} /></div>;
  const lessons = (data?.modules ?? []).flatMap((module) => module.lessons ?? []).filter((lesson) => lesson.isPreview);
  const lesson = lessons.find((item) => item.id === params.get('aula')) ?? lessons[0];
  if (!lesson) return null;
  return <div className="container page" style={{ maxWidth: 960 }}>
    <Link className="small row" style={{ gap: 5, width: 'fit-content' }} to={`/cursos/${data.course.slug}`}><Icon name="caretLeft" size={14} /> Voltar ao treinamento</Link>
    <div className="card card-pad stack" style={{ marginTop: 16 }}>
      <span className="badge badge-brand" style={{ width: 'fit-content' }}>Aula de prévia</span>
      <h1 style={{ margin: 0 }}>{lesson.title}</h1>
      {lesson.videoUrl && <video controls className="lesson-video" src={lesson.videoUrl} />}
      {lesson.content && <div className="lesson-content">{lesson.content}</div>}
      {!lesson.videoUrl && !lesson.content && <p className="muted">Esta aula de prévia está em preparação.</p>}
      <Link className="btn btn-primary" to={`/cursos/${data.course.slug}`} style={{ alignSelf: 'flex-start' }}>Conhecer o treinamento completo</Link>
    </div>
  </div>;
}
