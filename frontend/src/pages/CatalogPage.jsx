import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { coursesApi, learningApi } from '../api/client.js';
import { useApi, useDebounced } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useNavigate } from 'react-router-dom';
import { CourseCard, CourseCardSkeleton } from '../components/CourseCard.jsx';
import { EmptyState, ErrorState } from '../components/Feedback.jsx';
import { Alert } from '../components/Alert.jsx';
import { Icon } from '../components/Icon.jsx';
import { LEVEL_LABEL, categoryIcon } from '../utils/format.js';

const SORTS = [
  { value: 'relevance', label: 'Mais populares' },
  { value: 'newest', label: 'Novestros' },
  { value: 'rating', label: 'Melhor avaliados' },
  { value: 'price_asc', label: 'Menor preço' },
  { value: 'price_desc', label: 'Maior preço' },
];

const PRICE_OPTIONS = [
  { value: '', label: 'Qualquer preço' },
  { value: '0', label: 'Somente gratuitos' },
  { value: '1-15000', label: 'Até R$ 150' },
  { value: '10000-30000', label: 'R$ 100 a R$ 300' },
  { value: '20000-', label: 'Acima de R$ 200' },
];

export function CatalogPage() {
  const [params, setParams] = useSearchParams();
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [search, setSearch] = useState(params.get('search') ?? '');
  const debouncedSearch = useDebounced(search, 400);
  const [notice, setNotice] = useState(null);

  const filters = {
    search: debouncedSearch || undefined,
    category: params.get('category') || undefined,
    level: params.get('level') || undefined,
    sort: params.get('sort') || 'relevance',
    page: Number(params.get('page')) || 1,
    ...parsePrice(params.get('price')),
  };

  const { data, loading, error, refetch } = useApi(
    () => coursesApi.list({ ...filters, limit: 12 }),
    [debouncedSearch, params.toString()],
  );

  const { data: categories } = useApi(() => coursesApi.categories(), []);

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  const goToPage = (page) => setFilter('page', page === 1 ? '' : String(page));

  const enrollFree = async (course) => {
    if (!isAuthenticated) {
      navigate('/entrar', { state: { from: '/catalogo' } });
      return;
    }
    try {
      await learningApi.enrollFree(course.id);
      setNotice({ variant: 'success', text: `Matriculado em "${course.title}".` });
      refetch();
    } catch (err) {
      setNotice({ variant: 'danger', text: err.message });
    }
  };

  const activeFilters =
    [filters.category, filters.level, filters.price ? params.get('price') : null, debouncedSearch].filter(Boolean).length;

  return (
    <div className="container page">
      <header className="page-head">
        <div>
          <h1 style={{ margin: 0 }}>Catálogo de cursos</h1>
          <p className="muted" style={{ margin: 0 }}>
            {loading ? 'Carregando...' : `${data?.meta.total ?? 0} cursos disponíveis`}
            {user && ' · faça login para acompanhar seu progresso'}
          </p>
        </div>
      </header>

      {notice && (
        <div style={{ marginBottom: 16 }}>
          <Alert variant={notice.variant} onClose={() => setNotice(null)}>
            {notice.text}
          </Alert>
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: '1fr', marginBottom: 24 }}>
        <div className="card card-pad stack" style={{ gap: 14 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <input
              className="input grow"
              style={{ minWidth: 200 }}
              type="search"
              placeholder="Buscar por título, tema ou palavra-chave..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar cursos"
            />

            <select className="select" value={filters.sort} onChange={(e) => setFilter('sort', e.target.value)} aria-label="Ordenar" style={{ width: 'auto' }}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="row wrap" style={{ gap: 8 }}>
            <button
              type="button"
              className={`badge ${!filters.category ? 'badge-brand' : ''}`}
              style={{ border: 0, cursor: 'pointer', padding: '7px 13px', fontSize: '0.82rem' }}
              onClick={() => setFilter('category', '')}
            >
              Todas
            </button>
            {(categories?.categories ?? []).map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`badge ${filters.category === cat.slug ? 'badge-brand' : ''}`}
                style={{ border: 0, cursor: 'pointer', padding: '7px 13px', fontSize: '0.82rem' }}
                onClick={() => setFilter('category', cat.slug === filters.category ? '' : cat.slug)}
              >
                <Icon name={categoryIcon(cat)} size={14} /> {cat.name} ({cat.courseCount})
              </button>
            ))}
          </div>

          <div className="row wrap" style={{ gap: 10 }}>
            <select className="select" style={{ width: 'auto' }} value={params.get('level') ?? ''} onChange={(e) => setFilter('level', e.target.value)} aria-label="Nível">
              <option value="">Todos os níveis</option>
              {Object.entries(LEVEL_LABEL).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>

            <select className="select" style={{ width: 'auto' }} value={params.get('price') ?? ''} onChange={(e) => setFilter('price', e.target.value)} aria-label="Preço">
              {PRICE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>

            {activeFilters > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }); }}>
                Limpar filtros ({activeFilters})
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={refetch} />}

      {loading ? (
        <div className="grid grid-cards">
          {Array.from({ length: 6 }, (_, i) => <CourseCardSkeleton key={i} />)}
        </div>
      ) : data?.courses.length ? (
        <>
          <div className="grid grid-cards">
            {data.courses.map((course) => (
              <CourseCard key={course.id} course={course} onEnroll={enrollFree} />
            ))}
          </div>

          {data.meta.totalPages > 1 && (
            <nav className="row" style={{ justifyContent: 'center', gap: 8, marginTop: 32 }} aria-label="Paginação">
              <button
                type="button"
                className="btn btn-secondary btn-sm row"
                style={{ gap: 6 }}
                disabled={!data.meta.hasPrev}
                onClick={() => goToPage(data.meta.page - 1)}
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
                onClick={() => goToPage(data.meta.page + 1)}
              >
                Próxima <Icon name="caretRight" size={14} />
              </button>
            </nav>
          )}
        </>
      ) : (
        !error && (
          <EmptyState
            icon="search"
            title="Nenhum curso encontrado"
            description="Tente ajustar a busca ou remover alguns filtros."
            action={
              <button type="button" className="btn btn-secondary" onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }); }}>
                Limpar filtros
              </button>
            }
          />
        )
      )}
    </div>
  );
}

/** "10000-30000" -> { minPrice, maxPrice } */
function parsePrice(raw) {
  if (!raw) return {};
  if (raw === '0') return { free: true };

  const [min, max] = raw.split('-');
  return {
    ...(min ? { minPrice: Number(min) } : {}),
    ...(max ? { maxPrice: Number(max) } : {}),
  };
}
