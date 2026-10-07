import { Link } from 'react-router-dom';
import { coursesApi, gamificationApi, forumApi } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { CourseCard, CourseCardSkeleton } from '../components/CourseCard.jsx';
import { HeroCarousel } from '../components/HeroCarousel.jsx';
import { TrustStrip } from '../components/TrustStrip.jsx';
import { SectionHeader } from '../components/SectionHeader.jsx';
import { Icon } from '../components/Icon.jsx';
import { ErrorState, EmptyState } from '../components/Feedback.jsx';
import { formatNumber, timeAgo } from '../utils/format.js';

export function HomePage() {
  const { data, loading, error, refetch } = useApi(() => coursesApi.list({ sort: 'relevance', limit: 8 }), []);
  const { data: feed } = useApi(() => forumApi.list({ sort: 'recent', limit: 3 }), []);
  const { data: ranking } = useApi(() => gamificationApi.leaderboard(3), []);

  const courses = data?.courses ?? [];
  const posts = feed?.posts ?? [];

  return (
    <div>
      <HeroCarousel items={courses.slice(0, 5)} />

      <TrustStrip totalCourses={data?.meta?.total} />

      {/* Catálogo */}
      <section className="section section-deep">
        <div className="container">
          <SectionHeader
            eyebrow="Catálogo"
            title="Cursos em destaque"
            description="Escolha a área que você quer dominar e comece hoje mesmo."
            action={
              <Link className="btn btn-secondary btn-arrow" to="/catalogo">
                Ver catálogo completo
                <Icon name="caretRight" size={16} className="icon-caret" />
              </Link>
            }
          />

          <div className="grid course-grid">
            {loading ? (
              Array.from({ length: 4 }, (_, i) => <CourseCardSkeleton key={i} />)
            ) : error ? (
              // Sem este ramo, uma API fora do ar renderizaria a home inteira
              // sem cursos, como se a plataforma estivesse vazia.
              <div style={{ gridColumn: '1 / -1' }}>
                <ErrorState error={error} onRetry={refetch} />
              </div>
            ) : courses.length ? (
              courses.map((course) => <CourseCard key={course.id} course={course} />)
            ) : (
              <div style={{ gridColumn: '1 / -1' }}>
                <EmptyState
                  icon="book"
                  title="Nenhum curso publicado"
                  description="Os cursos publicados aparecem aqui assim que ficarem disponíveis."
                />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Comunidade */}
      {posts.length > 0 && (
        <section className="section">
          <div className="container">
            <SectionHeader
              eyebrow="Comunidade"
              title="Perguntas e respostas"
              description="Troque ideia com outros alunos e tire suas dúvidas."
              action={
                <Link className="btn btn-secondary btn-arrow" to="/forum">
                  Ver fórum
                  <Icon name="caretRight" size={16} className="icon-caret" />
                </Link>
              }
            />

            <div className="grid grid-cards">
              {posts.map((post) => (
                <article key={post.id} className="card card-hover post-card">
                  <span className="post-card-tag">Discussão</span>
                  <h3 className="clamp-2" style={{ margin: 0 }}>
                    <Link to={`/forum/${post.id}`} style={{ color: 'inherit' }}>
                      {post.title}
                    </Link>
                  </h3>
                  <p className="small muted clamp-3" style={{ margin: 0 }}>
                    {post.content}
                  </p>
                  <div className="post-card-foot">
                    <span>{post.userName}</span>
                    <span aria-hidden="true">·</span>
                    <span>{timeAgo(post.createdAt)}</span>
                    <span className="row" style={{ gap: 4, marginLeft: 'auto' }}>
                      <Icon name="message" size={14} /> {formatNumber(post.commentsCount)}
                    </span>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Ranking */}
      {ranking?.leaderboard?.length > 0 && (
        <section className="section section-deep">
          <div className="container">
            <SectionHeader
              eyebrow="Ranking"
              title="Alunos em destaque"
              description="Quem está acumulando mais pontos na plataforma."
              action={
                <Link className="btn btn-secondary btn-arrow" to="/ranking">
                  Ranking completo
                  <Icon name="caretRight" size={16} className="icon-caret" />
                </Link>
              }
            />

            <div className="grid grid-cards">
              {ranking.leaderboard.map((row, i) => (
                <article key={row.id} className="card card-hover center stack" style={{ alignItems: 'center', gap: 8, padding: 24 }}>
                  <span className="trust-icon" aria-hidden="true">
                    <Icon name={['trophy', 'award', 'sparkle'][i] ?? 'award'} size={20} />
                  </span>
                  <strong>{row.name}</strong>
                  <span className="badge badge-brand">{formatNumber(row.points)} pontos</span>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* CTA final */}
      <section className="section">
        <div className="container">
          <div className="card center stack" style={{ gap: 12, padding: '48px 24px' }}>
            <h2 style={{ margin: 0 }}>Pronto para começar?</h2>
            <p className="muted" style={{ maxWidth: 480, margin: 0 }}>
              Crie sua conta em segundos e comece seu primeiro curso gratuitamente.
            </p>
            <div className="row wrap" style={{ justifyContent: 'center', gap: 10 }}>
              <Link className="btn btn-primary btn-lg" to="/cadastro">Criar conta grátis</Link>
              <Link className="btn btn-secondary btn-lg" to="/catalogo">Ver cursos</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function AboutPage() {
  return (
    <div className="container page" style={{ maxWidth: 760 }}>
      <p className="eyebrow">Sobre</p>
      <h1>Sobre a LearnUp</h1>
      <div className="card card-pad stack">
        <p>
          A LearnUp é uma plataforma de cursos online para capacitação profissional.
          Você encontra um fluxo completo de aprendizagem: descobrir um curso, assistir às aulas,
          responder quizzes, acompanhar o progresso, conversar na comunidade e receber um certificado verificável.
        </p>
        <p>
          Os pagamentos usam um provider simulado enquanto a operação comercial não está configurada,
          então nenhum valor real é cobrado neste ambiente.
        </p>
        <hr className="divider" />
        <h2 style={{ margin: 0 }}>Como funciona</h2>
        <ol className="stack small" style={{ paddingLeft: 20, margin: 0, gap: 6 }}>
          <li>Escolha um curso gratuito ou pague por um curso premium.</li>
          <li>Assista às aulas — o progresso é salvo automaticamente.</li>
          <li>Responda aos quizzes para ganhar pontos extras.</li>
          <li>Complete 100% das aulas para emitir o certificado.</li>
          <li>Conquiste badges e suba no ranking da comunidade.</li>
        </ol>
        <Link className="btn btn-primary" to="/catalogo" style={{ alignSelf: 'flex-start' }}>Explorar cursos</Link>
      </div>
    </div>
  );
}

export function ContactPage() {
  return <div className="container page" style={{ maxWidth: 760 }}>
    <p className="eyebrow">Contato</p><h1>Fale com a nossa equipe</h1>
    <div className="card card-pad stack">
      <p className="muted">Use este canal para tirar dúvidas sobre acesso, treinamentos, certificados ou pedidos.</p>
      <a className="btn btn-primary" style={{ alignSelf: 'flex-start' }} href="mailto:suporte@learnup.dev"><Icon name="mail" size={17} /> Enviar e-mail</a>
      <p className="small muted" style={{ margin: 0 }}>O e-mail de suporte e o WhatsApp podem ser atualizados no painel administrativo.</p>
    </div>
  </div>;
}

export function LegalPage({ type }) {
  const privacy = type === 'privacy';
  return <div className="container page" style={{ maxWidth: 760 }}>
    <p className="eyebrow">Informações legais</p><h1>{privacy ? 'Política de privacidade' : 'Termos de uso'}</h1>
    <article className="card card-pad stack">
      <p>{privacy ? 'Tratamos apenas os dados necessários para criar sua conta, liberar treinamentos, emitir certificados e prestar suporte.' : 'Ao utilizar a plataforma, você concorda em fornecer dados verdadeiros e manter suas credenciais de acesso em sigilo.'}</p>
      <p>{privacy ? 'Dados pessoais não são comercializados. O acesso é restrito às finalidades operacionais, legais e de segurança da plataforma.' : 'O acesso a cada treinamento é pessoal e intransferível. Certificados dependem da conclusão integral dos requisitos definidos no curso.'}</p>
      <p className="muted small">Este texto é um modelo inicial e deve ser revisado pela assessoria jurídica antes da publicação comercial.</p>
    </article>
  </div>;
}

export function NotFoundPage() {
  return (
    <div className="container page center stack" style={{ maxWidth: 520 }}>
      <span className="trust-icon" style={{ margin: '0 auto' }} aria-hidden="true">
        <Icon name="search" size={24} />
      </span>
      <h1 style={{ margin: 0 }}>Página não encontrada</h1>
      <p className="muted">O endereço que você tentou acessar não existe ou foi movido.</p>
      <div className="row" style={{ justifyContent: 'center', gap: 10 }}>
        <Link className="btn btn-primary" to="/">Ir para o início</Link>
        <Link className="btn btn-secondary" to="/catalogo">Ver catálogo</Link>
      </div>
    </div>
  );
}
