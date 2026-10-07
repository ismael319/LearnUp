import { Link } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { formatPrice, formatRating, formatDuration, formatNumber, LEVEL_LABEL, discountPercent } from '../utils/format.js';

/** Hash simples para variar o fallback de capa sem parecer aleatório. */
const hash = (text = '') => {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 100000;
  return h;
};

/** Duas iniciais do título, para o glifo do fallback. */
const glyphOf = (title = '') =>
  title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');

function Cover({ course }) {
  if (course.coverUrl) {
    return <img src={course.coverUrl} alt="" loading="lazy" />;
  }
  return (
    <span className="cover-fallback" style={{ background: `linear-gradient(${115 + (hash(course.title) % 90)}deg, var(--ink-100), var(--ink-300))` }}>
      <span className="cover-fallback-glyph" aria-hidden="true">{glyphOf(course.title)}</span>
    </span>
  );
}

export function CourseCard({ course, onEnroll, enrolling = false }) {
  const off = discountPercent(course.priceCents, course.originalPriceCents);
  const free = course.priceCents === 0;

  return (
    <article className="card card-hover course-card">
      <Link to={`/cursos/${course.slug}`} aria-label={course.title} className="course-card-cover">
        <Cover course={course} />
      </Link>

      <div className="course-card-body">
        <div className="row wrap" style={{ gap: 6 }}>
          {course.categoryName && <span className="badge badge-brand">{course.categoryName}</span>}
          <span className="badge">{LEVEL_LABEL[course.level]}</span>
          {off > 0 && <span className="badge badge-danger">-{off}%</span>}
          {course.enrolled && <span className="badge badge-success">Matriculado</span>}
        </div>

        <h3 className="clamp-2" style={{ margin: 0 }}>
          <Link to={`/cursos/${course.slug}`} style={{ color: 'inherit' }}>
            {course.title}
          </Link>
        </h3>

        <p className="small muted clamp-2" style={{ margin: 0 }}>
          {course.subtitle}
        </p>

        <div className="course-card-meta">
          {/* Sem avaliações ou sem matrículas não há nota a mostrar: exibir
              "0,0" e "0" numa plataforma nova parece dado corrompido, não
              honesto. A duração aparece sempre. */}
          {course.ratingCount > 0 && (
            <span><Icon name="star" size={14} /> {formatRating(course.ratingAvg)}</span>
          )}
          <span><Icon name="clock" size={14} /> {formatDuration(course.durationMinutes)}</span>
          {course.studentsCount > 0 && (
            <span><Icon name="users" size={14} /> {formatNumber(course.studentsCount)}</span>
          )}
        </div>

        <div className="course-card-foot">
          <span className={`course-card-price${free ? ' is-free' : ''}`}>
            {free ? 'Gratuito' : formatPrice(course.priceCents)}
            {!free && off > 0 && (
              <span className="tiny muted" style={{ textDecoration: 'line-through', marginLeft: 6, fontWeight: 400 }}>
                {formatPrice(course.originalPriceCents)}
              </span>
            )}
          </span>

          {course.enrolled ? (
            <Link className="btn btn-secondary btn-sm" to={`/aprender/${course.id}`}>
              Continuar
            </Link>
          ) : free ? (
            onEnroll ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => onEnroll(course)} disabled={enrolling}>
                {enrolling ? 'Matriculando...' : 'Matricular'}
              </button>
            ) : (
              <Link className="btn btn-primary btn-sm" to={`/cursos/${course.slug}`}>Matricular</Link>
            )
          ) : (
            <Link className="course-card-cta" to={`/cursos/${course.slug}`}>
              Ver curso
              <Icon name="caretRight" size={16} className="icon-caret" />
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

export function CourseCardSkeleton() {
  return (
    <div className="card course-card" aria-hidden="true">
      <div className="skeleton" style={{ height: 168, borderRadius: 0 }} />
      <div className="course-card-body">
        <div className="skeleton" style={{ height: 20, width: '35%' }} />
        <div className="skeleton" style={{ height: 34, width: '85%' }} />
        <div className="skeleton" style={{ height: 13, width: '60%' }} />
        <div className="skeleton" style={{ height: 30, marginTop: 8 }} />
      </div>
    </div>
  );
}
