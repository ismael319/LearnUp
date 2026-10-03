import { useState } from 'react';
import { Link } from 'react-router-dom';
import { learningApi, gamificationApi, certificatesApi } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert } from '../components/Alert.jsx';
import { Avatar } from '../components/Avatar.jsx';
import { ProgressBar } from '../components/ProgressBar.jsx';
import { EmptyState, ErrorState, LoadingBlock } from '../components/Feedback.jsx';
import { Icon } from '../components/Icon.jsx';
import { downloadCertificate } from '../api/download.js';
import { formatDate, formatNumber, badgeIcon } from '../utils/format.js';

const TABS = [
  { id: 'cursos', label: 'Meus cursos' },
  { id: 'certificados', label: 'Certificados' },
  { id: 'conquistas', label: 'Conquistas' },
  { id: 'perfil', label: 'Perfil' },
];

export function AccountPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('cursos');
  const [tabRequest, setTabRequest] = useState(null);

  const openCertificates = () => {
    setTab('certificados');
    setTabRequest(Date.now()); // força a aba a montar e buscar os certificados
  };

  return (
    <div className="container page">
      <div className="row" style={{ gap: 16, marginBottom: 24 }}>
        <Avatar name={user.name} src={user.avatarUrl} size="lg" />
        <div className="stack grow" style={{ gap: 2 }}>
          <h1 style={{ margin: 0 }}>{user.name}</h1>
          <span className="small muted">{user.email}</span>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="badge badge-brand row" style={{ gap: 5 }}>
          <Icon name="starFill" size={13} /> {formatNumber(user.points)} pontos
        </span>
          {user.streakDays > 0 &&           <span className="badge badge-warning"><Icon name="sparkle" size={13} /> {user.streakDays} dias seguidos</span>}
        </div>
      </div>

      <div className="tabs" role="tablist" style={{ marginBottom: 24 }}>
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
          </button>
        ))}
      </div>

      {tab === 'cursos' && <MyCourses onSeeCertificates={openCertificates} />}
      {tab === 'certificados' && <MyCertificates key={tabRequest} />}
      {tab === 'conquistas' && <MyBadges />}
      {tab === 'perfil' && <MyProfile />}
    </div>
  );
}

function MyCourses({ onSeeCertificates }) {
  const { data, loading, error, refetch } = useApi(() => learningApi.list(), []);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const enrollments = data?.enrollments ?? [];
  if (!enrollments.length) {
    return (
      <EmptyState
        icon="book"
        title="Você ainda não se matriculou"
        description="Explore o catálogo e comece hoje."
        action={<Link className="btn btn-primary" to="/catalogo">Ver catálogo</Link>}
      />
    );
  }

  const inProgress = enrollments.filter((e) => !e.completedAt);
  const finished = enrollments.filter((e) => e.completedAt);

  return (
    <div className="stack" style={{ gap: 28 }}>
      {inProgress.length > 0 && (
        <Section title="Continuar estudando" count={inProgress.length}>
          {inProgress.map((e) => (
            <div key={e.id} className="card card-pad stack" style={{ gap: 12 }}>
              {e.coverUrl && <img src={e.coverUrl} alt="" className="cover" style={{ borderRadius: 'var(--radius)' }} />}
              <div className="row-between wrap">
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <Link to={`/cursos/${e.slug}`} style={{ color: 'inherit' }}>
                    <strong>{e.title}</strong>
                  </Link>
                  <span className="tiny muted">
                    {e.instructorName} · matriculado em {formatDate(e.enrolledAt)}
                  </span>
                </div>
                <Link className="btn btn-primary btn-sm" to={`/aprender/${e.courseId}`}>
                  Continuar
                </Link>
              </div>
              <ProgressBar
                value={e.progressPercent}
                label={`${e.completedLessons}/${e.totalLessons} aulas`}
              />
            </div>
          ))}
        </Section>
      )}

      {finished.length > 0 && (
        <Section title="Concluídos" count={finished.length}>
          {finished.map((e) => (
            <div key={e.id} className="card card-pad row-between wrap" style={{ gap: 12 }}>
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <strong className="row" style={{ gap: 7 }}><Icon name="check" size={15} /> {e.title}</strong>
                <span className="tiny muted">Concluído em {formatDate(e.completedAt)}</span>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Link className="btn btn-secondary btn-sm" to={`/aprender/${e.courseId}`}>Revisar</Link>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onSeeCertificates}>
                  Certificado
                </button>
              </div>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}

function MyCertificates() {
  const { data, loading, error, refetch } = useApi(() => certificatesApi.list(), []);
  const [busyCode, setBusyCode] = useState(null);
  const [downloadError, setDownloadError] = useState(null);

  const download = async (cert) => {
    setBusyCode(cert.code);
    setDownloadError(null);
    try {
      await downloadCertificate(cert.code, cert.courseTitle);
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setBusyCode(null);
    }
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const certificates = data?.certificates ?? [];
  if (!certificates.length) {
    return (
      <EmptyState
        icon="cap"
        title="Nenhum certificado ainda"
        description="Conclua 100% das aulas de um curso para emitir o seu certificado automaticamente."
      />
    );
  }

  return (
    <div className="stack" style={{ gap: 16 }}>
      {downloadError && <Alert variant="danger" onClose={() => setDownloadError(null)}>{downloadError}</Alert>}

      <div className="grid grid-cards">
        {certificates.map((cert) => (
          <div key={cert.id} className="card card-pad stack" style={{ gap: 10 }}>
            <span className="empty-icon" aria-hidden="true"><Icon name="certificate" size={30} /></span>
            <strong>{cert.courseTitle}</strong>
            <span className="tiny muted">
              Emitido em {formatDate(cert.issuedAt)}
              {cert.finalScore ? ` · nota ${cert.finalScore}` : ''}
            </span>
            <code className="tiny" style={{ background: 'var(--ink-100)', padding: '6px 8px', borderRadius: 6 }}>{cert.code}</code>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => download(cert)}
                disabled={busyCode === cert.code}
              >
                {busyCode === cert.code ? 'Gerando...' : 'Baixar PDF'}
              </button>
              <Link className="btn btn-secondary btn-sm" to={`/verificar?codigo=${cert.code}`}>Verificar</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MyBadges() {
  const { user } = useAuth();
  const { data, loading, error, refetch } = useApi(() => gamificationApi.me(), []);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const stats = data?.stats ?? {};
  const badges = data?.badges ?? [];

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="card card-pad row" style={{ gap: 24, flexWrap: 'wrap' }}>
        <Stat value={formatNumber(user.points)} label="Pontos acumulados" />
        <Stat value={stats.completedCourses ?? 0} label="Cursos concluídos" />
        <Stat value={stats.quizzesPassed ?? 0} label="Quizzes aprovados" />
        <Stat value={stats.enrolledCourses ?? 0} label="Cursos inscritos" />
        <Stat value={stats.certificatesCount ?? 0} label="Certificados" />
        <Stat value={stats.current ?? 1} label="Nível" />
      </div>

      {stats.next > stats.current && (
        <div className="card card-pad">
          <ProgressBar value={Math.round(((user.points - (stats.current - 1) * 500) / 500) * 100)} label={`Faltam ${stats.remaining} pontos para o nível ${stats.next}`} />
        </div>
      )}

      <Section title="Badges conquistados" count={badges.length}>
        {badges.length ? (
          <div className="grid grid-cards">
            {badges.map((b) => (
              <div key={b.id} className="card card-pad center stack" style={{ gap: 6, alignItems: 'center' }}>
                <span className="empty-icon" aria-hidden="true"><Icon name={badgeIcon(b)} size={30} /></span>
                <strong>{b.name}</strong>
                <p className="tiny muted" style={{ margin: 0 }}>{b.description}</p>
                {b.awardedAt && <span className="badge badge-success">Conquistado em {formatDate(b.awardedAt)}</span>}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="award" title="Nenhuma badge ainda" description="Conclua cursos e quizzes para conquistar suas medalhas." />
        )}
      </Section>
    </div>
  );
}

function MyProfile() {
  const { user, updateProfile } = useAuth();
  const [form, setForm] = useState({ name: user.name, bio: user.bio ?? '', phone: user.phone ?? '' });
  const [state, setState] = useState({ busy: false, done: false, error: null });

  const submit = async (event) => {
    event.preventDefault();
    setState({ busy: true, done: false, error: null });
    try {
      await updateProfile(form);
      setState({ busy: false, done: true, error: null });
    } catch (error) {
      setState({ busy: false, done: false, error });
    }
  };

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <form className="card card-pad stack" onSubmit={submit}>
        <h2 style={{ margin: 0 }}>Dados pessoais</h2>
        {state.error && <Alert variant="danger">{state.error.message}</Alert>}
        {state.done && (
          <Alert variant="success" onClose={() => setState((s) => ({ ...s, done: false }))}>
            Perfil atualizado.
          </Alert>
        )}

        <div className="field">
          <label className="label" htmlFor="pf-name">Nome</label>
          <input id="pf-name" className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-phone">Telefone</label>
          <input id="pf-phone" className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </div>
        <div className="field">
          <label className="label" htmlFor="pf-bio">Bio</label>
          <textarea
            id="pf-bio"
            className="textarea"
            value={form.bio}
            onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
            placeholder="Conte um pouco sobre você"
          />
        </div>
        <button type="submit" className="btn btn-primary" disabled={state.busy}>
          {state.busy ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </form>

      <div className="card card-pad stack">
        <h2 style={{ margin: 0 }}>Conta</h2>
        <p className="small muted" style={{ margin: 0 }}>E-mail: <strong>{user.email}</strong></p>
        <p className="small muted" style={{ margin: 0 }}>Função: <strong>{user.role}</strong></p>
        <p className="small muted" style={{ margin: 0 }}>Membro desde {formatDate(user.createdAt ?? new Date().toISOString())}</p>
        <hr className="divider" style={{ margin: '4px 0' }} />
        <p className="tiny muted" style={{ margin: 0 }}>
          A troca de senha está disponível na API (<code>POST /auth/change-password</code>) e ainda não tem tela dedicada.
        </p>
      </div>
    </div>
  );
}

function Section({ title, count, children }) {
  return (
    <section className="stack" style={{ gap: 14 }}>
      <h2 style={{ margin: 0 }}>
        {title} {count > 0 && <span className="badge badge-brand">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Stat({ value, label }) {
  return (
    <div className="center stack" style={{ gap: 0 }}>
      <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--ink-900)' }}>{value}</span>
      <span className="tiny muted">{label}</span>
    </div>
  );
}
