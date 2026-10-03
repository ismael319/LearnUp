import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { adminApi } from '../../api/client.js';
import { useApi, useDebounced } from '../../hooks/useApi.js';
import { DataTable, SearchField, FilterSelect } from '../../components/admin/DataTable.jsx';
import { ConfirmDialog, Modal } from '../../components/admin/ConfirmDialog.jsx';
import { StatusTag, SummaryBar, Panel } from '../../components/admin/ui.jsx';
import { PageHead } from '../../components/admin/AdminLayout.jsx';
import { Icon } from '../../components/Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatCurrency, formatNumber, formatDate, initials } from '../../utils/format.js';

const ROLE_LABEL = { student: 'Aluno', instructor: 'Instrutor', admin: 'Administrador' };

const ROLE_OPTIONS = [
  { value: '', label: 'Todos os papéis' },
  { value: 'student', label: 'Alunos' },
  { value: 'instructor', label: 'Instrutores' },
  { value: 'admin', label: 'Administradores' },
];

/** Papéis que podem ser atribuídos, sem o item "todos" do filtro. */
const CHANGEABLE_ROLES = [
  { value: 'student', label: 'Aluno' },
  { value: 'instructor', label: 'Instrutor' },
  { value: 'admin', label: 'Administrador' },
];

const ROLE_IMPACT = {
  student: 'Perde o acesso à área de instrutor e não vê mais o painel administrativo.',
  instructor: 'Passa a criar e publicar cursos; o acesso ao painel sai, a menos que também seja admin.',
  admin: 'Passa a ver o painel administrativo e a tomar decisões de governança.',
};

const STATUS_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'blocked', label: 'Bloqueados' },
];

const ORDER_OPTIONS = [
  { value: 'recent', label: 'Mais recentes' },
  { value: 'name', label: 'Nome (A-Z)' },
  { value: 'enrollments', label: 'Mais matrículas' },
];

export default function AdminUsersPage() {
  const { user: me } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const debounced = useDebounced(search);
  const role = params.get('role') ?? '';
  const status = params.get('status') ?? '';
  const orderBy = params.get('orderBy') ?? 'recent';
  const page = Number(params.get('page') ?? 1);

  const [blocking, setBlocking] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [changingRole, setChangingRole] = useState(null);
  const [detail, setDetail] = useState(null);
  const [notice, setNotice] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const setParam = (patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === '' || value === null || value === undefined) next.delete(key);
      else next.set(key, String(value));
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  const { data, loading, error: loadError, refetch } = useApi(
    () => adminApi.users({ search: debounced, role, status, orderBy, page, limit: 20 }),
    [debounced, role, status, orderBy, page],
  );

  /** Ações em lote: o erro precisa aparecer mesmo que o `finally`-limpe o modal. */
  const run = async (fn, successMessage) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setBlocking(null);
      setResetting(null);
      setChangingRole(null);
      setNotice({ message: successMessage });
      refetch();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Usuários"
        description="Papéis, bloqueios e recuperação de acesso. Bloquear encerra as sessões imediatamente."
      />

      {error && (
        <div className="alert alert-danger" role="alert">
          <Icon name="alert" size={18} />
          <div className="grow">{error.message}</div>
        </div>
      )}

      <DataTable
        rows={data?.users}
        loading={loading}
        error={loadError}
        onRetry={refetch}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        meta={data?.meta}
        onPageChange={(p) => setParam({ page: p })}
        emptyIcon="users"
        emptyTitle="Nenhum usuário encontrado"
        emptyDescription="Ajuste a busca ou os filtros."
        filters={
          <>
            <SearchField value={search} onChange={setSearch} placeholder="Buscar por nome ou e-mail" width={260} />
            <FilterSelect value={role} onChange={(v) => setParam({ role: v })} options={ROLE_OPTIONS} label="Filtrar por papel" />
            <FilterSelect value={status} onChange={(v) => setParam({ status: v })} options={STATUS_OPTIONS} label="Filtrar por status" />
            <FilterSelect value={orderBy} onChange={(v) => setParam({ orderBy: v })} options={ORDER_OPTIONS} label="Ordenar" />
          </>
        }
        columns={[
          {
            key: 'user',
            header: 'Usuário',
            render: (u) => (
              <div className="row" style={{ gap: 10 }}>
                <span className="avatar avatar-sm" aria-hidden="true">
                  {initials(u.name)}
                </span>
                <div className="stack" style={{ gap: 2 }}>
                  <button type="button" className="link" onClick={() => setDetail(u)}>
                    {u.name}
                    {u.id === me?.id && <span className="tiny muted"> (você)</span>}
                  </button>
                  <span className="tiny muted">{u.email}</span>
                </div>
              </div>
            ),
          },
          { key: 'role', header: 'Papel', render: (u) => <StatusTag status={u.role} map={ROLE_LABEL} /> },
          {
            key: 'status',
            header: 'Situação',
            render: (u) =>
              u.blockedAt ? (
                <StatusTag status="blocked" title={u.blockedReason ?? ''} />
              ) : (
                <StatusTag status="active" title="Ativo" />
              ),
          },
          {
            key: 'enrollments',
            header: 'Matrículas',
            align: 'right',
            render: (u) => <span className="nowrap">{formatNumber(u.enrollmentCount ?? 0)}</span>,
          },
          {
            key: 'courses',
            header: 'Cursos',
            align: 'right',
            render: (u) => (u.role === 'instructor' ? formatNumber(u.courseCount ?? 0) : '—'),
          },
          { key: 'joined', header: 'Entrou', render: (u) => <span className="nowrap small">{formatDate(u.createdAt)}</span> },
          {
            key: 'actions',
            header: 'Ações',
            align: 'right',
            render: (u) => (
              <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setChangingRole(u)}
                  disabled={u.id === me?.id}
                  title={u.id === me?.id ? 'Você não pode alterar o próprio papel' : 'Alterar papel'}
                >
                  <Icon name="shield" size={14} /> Papel
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setResetting(u)}
                  title="Redefinir senha"
                >
                  <Icon name="lock" size={14} /> Senha
                </button>
                {u.blockedAt ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => run(() => adminApi.unblockUser(u.id), `${u.name} foi desbloqueado(a).`)}
                    disabled={busy}
                  >
                    Desbloquear
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => setBlocking(u)}
                    // O backend recusa bloqueio da própria conta e da última conta
                    // de admin; desligar o botão evita o erro evitável.
                    disabled={u.id === me?.id || u.role === 'admin'}
                    title={
                      u.id === me?.id
                        ? 'Você não pode bloquear a própria conta'
                        : u.role === 'admin'
                          ? 'Despromova ou bloqueie outra conta de admin'
                          : 'Bloquear acesso'
                    }
                  >
                    Bloquear
                  </button>
                )}
              </div>
            ),
          },
        ]}
      />

      <BlockDialog
        target={blocking}
        busy={busy}
        onCancel={() => setBlocking(null)}
        onConfirm={(reason) => run(() => adminApi.blockUser(blocking.id, reason), `${blocking.name} foi bloqueado(a).`)}
      />

      <ResetPasswordDialog
        // Remonta por usuário: sem a `key`, a senha digitada para uma pessoa
        // continuaria no formulário ao abrir o diálogo para outra.
        key={resetting?.id ?? 'none'}
        target={resetting}
        busy={busy}
        onCancel={() => setResetting(null)}
        onConfirm={(password) => run(() => adminApi.resetPassword(resetting.id, password), 'Senha redefinida.')}
      />

        <RoleDialog
          key={changingRole?.id ?? 'none'}
          target={changingRole}
          busy={busy}
        onCancel={() => setChangingRole(null)}
        onConfirm={(role) =>
          run(
            () => adminApi.changeRole(changingRole.id, role),
            `${changingRole.name} agora é ${ROLE_LABEL[role].toLowerCase()}.`,
          )
        }
      />

      <UserDetail user={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

/**
 * Bloquear derruba a sessão na hora e esconde o conteúdo. O motivo não é
 * burocracia: é o que o usuário precisa ler para saber o que houve.
 */
function BlockDialog({ target, busy, onCancel, onConfirm }) {
  return (
    <ConfirmDialog
      open={Boolean(target)}
      title={`Bloquear ${target?.name ?? ''}`}
      description="A conta perde o acesso imediatamente e todas as sessões abertas são encerradas."
      impact={[
        'As sessões abertas são encerradas agora',
        'O access token atual deixa de ser aceito',
        'O conteúdo publicado continua no ar',
        'Desbloquear restaura o acesso normalmente',
      ]}
      reason
      reasonLabel="Motivo do bloqueio"
      reasonPlaceholder="Ex.: conta duplicada, violação dos termos"
      confirmLabel="Bloquear acesso"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function ResetPasswordDialog({ target, busy, onCancel, onConfirm }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;

  return (
    <Modal
      open={Boolean(target)}
      title="Redefinir senha"
      description={
        target
          ? `A senha de ${target.name} (${target.email}) será trocada. Passe a nova senha para o usuário por um canal seguro.`
          : ''
      }
      onClose={onCancel}
      onSubmit={() => onConfirm(password)}
      submitLabel="Redefinir senha"
      busy={busy}
    >
      <label className="field">
        <span>Nova senha</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {tooShort && <span className="tiny" style={{ color: 'var(--danger)' }}>Use ao menos 8 caracteres.</span>}
      </label>
      <label className="field">
        <span>Repetir a senha</span>
        <input
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && <span className="tiny" style={{ color: 'var(--danger)' }}>As senhas não são iguais.</span>}
      </label>
    </Modal>
  );
}

/**
 * Troca de papel.
 *
 * O texto de impacto não é enfeite: cada papel abre e fecha portas diferentes,
 * e a decisão depende de saber o que a pessoa deixa de acessar — não só o nome
 * do papel novo. A tabela não abre este diálogo para a própria conta, e o
 * backend ainda protege a auto-demissão e a queda do último admin.
 */
function RoleDialog({ target, busy, onCancel, onConfirm }) {
  const [role, setRole] = useState(target?.role ?? 'student');

  const demoting = role !== target?.role;
  const lastAdmin = target?.role === 'admin' && role !== 'admin';

  return (
    <Modal
      open={Boolean(target)}
      title="Alterar papel"
      description={target ? `${target.name} (${target.email})` : ''}
      onClose={onCancel}
      onSubmit={() => onConfirm(role)}
      submitLabel="Salvar papel"
      busy={busy}
    >
      <label className="field">
        <span>Papel</span>
        <select
          className="input"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {CHANGEABLE_ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {lastAdmin ? (
        <div className="callout callout-danger small">
          Esta é a única conta de administrador ativa. Promova outra pessoa antes de rebaixar esta, senão a
          plataforma fica sem quem a administre.
        </div>
      ) : demoting ? (
        <ul className="impact-list">
          <li>
            <Icon name="info" size={15} />
            <span>{ROLE_IMPACT[role]}</span>
          </li>
          <li>
            <Icon name="info" size={15} />
            <span>Vale na próxima requisição: a sessão aberta da pessoa continua válida por alguns minutos.</span>
          </li>
          <li>
            <Icon name="info" size={15} />
            <span>Cursos já publicados e matrículas existentes continuam como estão.</span>
          </li>
        </ul>
      ) : null}

      <p className="tiny muted" style={{ margin: 0 }}>
        A troca fica registrada na auditoria com o papel anterior e o novo.
      </p>
    </Modal>
  );
}

/** Ficha completa: perfil, cursos, matrículas, pedidos e conquistas. */
function UserDetail({ user, onClose }) {
  const { data, loading, error } = useApi(() => (user ? adminApi.user(user.id) : null), [user?.id], {
    skip: !user,
  });

  return (
    <Modal open={Boolean(user)} title={user?.name ?? ''} onClose={onClose} submitLabel="Fechar" onSubmit={onClose}>
      {loading ? (
        <p className="muted small">Carregando...</p>
      ) : error ? (
        <p className="muted small">{error.message}</p>
      ) : data ? (
        <div className="stack" style={{ gap: 14 }}>
          <SummaryBar
            items={[
              { label: 'matrículas ativas', value: formatNumber(data.summary.activeEnrollments) },
              { label: 'pago', value: formatCurrency(data.summary.paidCents) },
              { label: 'cursos dados', value: formatNumber(data.summary.courseCount) },
              { label: 'badges', value: formatNumber(data.summary.badgeCount) },
            ]}
          />

          <div className="row wrap" style={{ gap: 8 }}>
            <StatusTag status={data.user.role} map={ROLE_LABEL} />
            {data.user.blockedAt ? (
              <StatusTag status="blocked" title={data.user.blockedReason} />
            ) : (
              <StatusTag status="active" />
            )}
            <span className="small muted">{data.user.email}</span>
            <span className="small muted">
              {formatNumber(data.user.points)} pontos · {data.user.streakDays ?? 0} dias de sequência
            </span>
          </div>

          {data.user.blockedReason && (
            <div className="callout callout-danger small">
              Bloqueado: {data.user.blockedReason} ({formatDate(data.user.blockedAt)})
            </div>
          )}

          {data.user.bio && <p className="muted small" style={{ margin: 0 }}>{data.user.bio}</p>}

          {data.courses.length > 0 && (
            <Panel title={`Cursos que ensina (${data.courses.length})`}>
              <ul className="stack small" style={{ gap: 6 }}>
                {data.courses.map((c) => (
                  <li key={c.id} className="row-between">
                    <span>{c.title}</span>
                    <span className="row" style={{ gap: 6 }}>
                      <StatusTag status={c.status} />
                      <span className="muted">{formatNumber(c.studentCount)} alunos</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {data.enrollments.length > 0 && (
            <Panel title={`Matrículas (${data.enrollments.length})`}>
              <ul className="stack small" style={{ gap: 6 }}>
                {data.enrollments.slice(0, 12).map((e) => (
                  <li key={e.id} className="row-between">
                    <span className="truncate">{e.courseTitle}</span>
                    <span className="row" style={{ gap: 6 }}>
                      <StatusTag status={e.status} />
                      <span className="muted nowrap">{formatDate(e.enrolledAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {data.certificates.length > 0 && (
            <Panel title={`Certificados (${data.certificates.length})`}>
              <ul className="stack small" style={{ gap: 6 }}>
                {data.certificates.map((c) => (
                  <li key={c.id} className="row-between">
                    <span className="truncate">{c.courseTitle}</span>
                    <span className="row" style={{ gap: 6 }}>
                      {c.revokedAt && <StatusTag status="revoked" />}
                      <span className="muted nowrap">{formatDate(c.issuedAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
