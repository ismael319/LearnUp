import { useState } from 'react';
import { adminApi } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { LoadingBlock, ErrorState, EmptyState } from '../../components/Feedback.jsx';
import { Modal, ConfirmDialog } from '../../components/admin/ConfirmDialog.jsx';
import { Panel, StatCard } from '../../components/admin/ui.jsx';
import { PageHead } from '../../components/admin/AdminLayout.jsx';
import { Icon } from '../../components/Icon.jsx';
import { formatNumber, categoryIcon, badgeIcon } from '../../utils/format.js';

/**
 * Categorias e conquistas na mesma tela porque as duas são taxonomia da
 * plataforma e um admin ajusta as duas no mesmo minuto. Estão separadas em
 * abas porque não têm nada em comum além da tela.
 */
export default function AdminContentPage() {
  const [tab, setTab] = useState('categories');
  const { data, loading, error, refetch } = useApi(() => adminApi.categories(), []);
  const { data: badgeData, loading: badgeLoading, error: badgeError, refetch: refetchBadges } = useApi(
    () => adminApi.badges(),
    [],
  );

  const reload = () => {
    refetch();
    refetchBadges();
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead title="Categorias e conquistas" description="Organização do catálogo e regras de gamificação." />

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'categories'}
              className={`tab ${tab === 'categories' ? 'active' : ''}`}
          onClick={() => setTab('categories')}
        >
          Categorias
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'badges'}
              className={`tab ${tab === 'badges' ? 'active' : ''}`}
          onClick={() => setTab('badges')}
        >
          Conquistas
        </button>
      </div>

      {tab === 'categories' ? (
        <CategoriesPanel data={data} loading={loading} error={error} onRetry={reload} onChanged={reload} />
      ) : (
        <BadgesPanel data={badgeData} loading={badgeLoading} error={badgeError} onRetry={reload} onChanged={reload} />
      )}
    </div>
  );
}

function CategoriesPanel({ data, loading, error, onRetry, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [uncategorizing, setUncategorizing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

  const run = async (fn, message) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setEditing(null);
      setRemoving(null);
      setUncategorizing(null);
      setNotice({ message });
      onChanged();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  const categories = data?.categories ?? [];

  return (
    <div className="stack" style={{ gap: 14 }}>
      {actionError && <div className="alert alert-danger">{actionError.message}</div>}
      {notice && (
        <div className="alert alert-success">
          <div className="grow">{notice.message}</div>
          <button type="button" className="alert-close" onClick={() => setNotice(null)} aria-label="Fechar">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      <Panel
        title={`${categories.length} categoria(s)`}
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
            <Icon name="plus" size={15} /> Nova categoria
          </button>
        }
      >
        {!categories.length ? (
          <EmptyState icon="book" title="Nenhuma categoria" description="Crie a primeira para organizar o catálogo." />
        ) : (
          <div className="grid-cards">
            {categories.map((cat) => (
              <article key={cat.id} className="card card-pad stack" style={{ gap: 10 }}>
                <div className="row" style={{ gap: 10 }}>
                  <span className="stat-icon" aria-hidden="true">
                    <Icon name={categoryIcon(cat)} size={18} />
                  </span>
                  <div className="stack" style={{ gap: 2 }}>
                    <strong>{cat.name}</strong>
                    <span className="tiny muted">/{cat.slug}</span>
                  </div>
                </div>
                <span className="small muted">
                  {formatNumber(cat.courseCount)} curso(s)
                  {cat.icon ? ` · ícone ${cat.icon}` : ''}
                </span>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(cat)}>
                    Editar
                  </button>
                  {/*
                   * Apagar com cursos linked deixaria todos sem categoria
                   * (a FK é SET NULL). O backend recusa; a interface oferece
                   * antes a desvinculação, que é o caminho sem perda.
                   */}
                  {cat.courseCount > 0 ? (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUncategorizing(cat)}>
                      Desvincular cursos
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => setRemoving(cat)}
                    >
                      Remover
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>

        <CategoryDialog
        // A `key` remonta o diálogo a cada alvo: sem ela o `useState` inicial do
        // formulário continua carregando o valor do item anterior ao reabrir.
        key={editing?.id ?? 'new'}
        category={editing}
        busy={busy}
        onClose={() => setEditing(null)}
        onSubmit={(payload) =>
          run(
            () =>
              editing?.id
                ? adminApi.updateCategory(editing.id, payload)
                : adminApi.createCategory(payload),
            editing?.id ? 'Categoria atualizada.' : 'Categoria criada.',
          )
        }
      />

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remover categoria "${removing?.name ?? ''}"`}
        description="A categoria não tem cursos vinculados, então nada mais depende dela."
        confirmLabel="Remover categoria"
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(() => adminApi.deleteCategory(removing.id), 'Categoria removida.')}
      />

      <ConfirmDialog
        open={Boolean(uncategorizing)}
        title={`Desvincular ${uncategorizing?.courseCount ?? 0} curso(s)`}
        description={`Os cursos de "${uncategorizing?.name}" ficarão sem categoria. A categoria em si continua existindo.`}
        impact={['Os cursos continuam publicados e intactos', 'Só a classificação por categoria é perdida', 'Dá para recategorizar depois']}
        confirmLabel="Desvincular"
        tone="warn"
        busy={busy}
        onCancel={() => setUncategorizing(null)}
        onConfirm={() => run(() => adminApi.uncategorize(uncategorizing.id), 'Cursos desvinculados.')}
      />
    </div>
  );
}

function CategoryDialog({ category, busy, onClose, onSubmit }) {
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? '');

  return (
    <Modal
      open={Boolean(category)}
      title={category?.id ? 'Editar categoria' : 'Nova categoria'}
      description="O endereço é gerado a partir do nome e usado na vitrine do aluno."
      onClose={onClose}
      onSubmit={() => onSubmit({ name, icon: icon.trim() || null })}
      submitLabel={category?.id ? 'Salvar' : 'Criar categoria'}
      busy={busy}
    >
      <label className="field">
        <span>Nome</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span>Ícone (emoji, opcional)</span>
        <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="NR" maxLength={8} />
      </label>
    </Modal>
  );
}

function BadgesPanel({ data, loading, error, onRetry, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [awarding, setAwarding] = useState(null);
  const [notice, setNotice] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { data: userData } = useApi(() => adminApi.users({ role: 'student', limit: 50, orderBy: 'name' }), []);

  const run = async (fn, message) => {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      setEditing(null);
      setRemoving(null);
      setAwarding(null);
      setNotice({ message });
      onChanged();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;

  const badges = data?.badges ?? [];
  const criteria = data?.criteria ?? [];

  return (
    <div className="stack" style={{ gap: 14 }}>
      {actionError && <div className="alert alert-danger">{actionError.message}</div>}
      {notice && (
        <div className="alert alert-success">
          <div className="grow">{notice.message}</div>
          <button type="button" className="alert-close" onClick={() => setNotice(null)} aria-label="Fechar">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      <div className="stat-grid">
        <StatCard icon="award" label="Conquistas cadastradas" value={formatNumber(badges.length)} />
        <StatCard
          icon="users"
          label="Conquistas concedidas"
          value={formatNumber(badges.reduce((sum, b) => sum + (b.awardedCount ?? 0), 0))}
        />
        <StatCard
          icon="sparkle"
          label="Pontos em circulação"
          value={formatNumber(badges.reduce((sum, b) => sum + b.points * (b.awardedCount ?? 0), 0))}
        />
      </div>

      <Panel
        title="Catálogo de conquistas"
        description="O critério é avaliado pela plataforma; conceder na mão é exceção, não atalho."
        actions={
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditing({})}>
            <Icon name="plus" size={15} /> Nova conquista
          </button>
        }
      >
        {!badges.length ? (
          <EmptyState icon="award" title="Nenhuma conquista cadastrada" />
        ) : (
          <div className="table-wrap">
            <table className="table table-admin">
              <thead>
                <tr>
                  <th>Conquista</th>
                  <th>Critério</th>
                  <th className="cell-tight">Pontos</th>
                  <th className="cell-tight">Concedidas</th>
                  <th className="cell-tight">Ações</th>
                </tr>
              </thead>
              <tbody>
                {badges.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <span className="stat-icon" aria-hidden="true">
                          <Icon name={badgeIcon(b)} size={18} />
                        </span>
                        <div className="stack" style={{ gap: 2 }}>
                          <strong>{b.name}</strong>
                          <span className="tiny muted">{b.description || b.key}</span>
                        </div>
                      </div>
                    </td>
                    <td className="small">{b.criteriaLabel}</td>
                    <td className="cell-tight">{formatNumber(b.points)}</td>
                    <td className="cell-tight">{formatNumber(b.awardedCount ?? 0)}</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(b)}>
                          Editar
                        </button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAwarding(b)}>
                          Conceder
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          onClick={() => setRemoving(b)}
                          aria-label={`Remover ${b.name}`}
                          title="Remover"
                        >
                          <Icon name="trash" size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

        <BadgeDialog
        key={editing?.id ?? 'new'}
        badge={editing}
        criteria={criteria}
        busy={busy}
        onClose={() => setEditing(null)}
        onSubmit={(payload) =>
          run(
            () => (editing?.id ? adminApi.updateBadge(editing.id, payload) : adminApi.createBadge(payload)),
            editing?.id ? 'Conquista atualizada.' : 'Conquista criada.',
          )
        }
      />

        <AwardDialog
        key={awarding?.id ?? 'none'}
        badge={awarding}
        users={userData?.users ?? []}
        busy={busy}
        onClose={() => setAwarding(null)}
        onSubmit={(userId, reason) => run(() => adminApi.awardBadge(awarding.id, userId, reason), 'Conquista concedida.')}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remover "${removing?.name ?? ''}"`}
        description={
          removing?.awardedCount > 0
            ? `${removing.awardedCount} aluno(s) já têm esta conquista. Ela some do perfil de todo mundo.`
            : 'Ninguém tem esta conquista ainda.'
        }
        confirmLabel="Remover conquista"
        busy={busy}
        onCancel={() => setRemoving(null)}
        onConfirm={() => run(() => adminApi.deleteBadge(removing.id), 'Conquista removida.')}
      />
    </div>
  );
}

function BadgeDialog({ badge, criteria, busy, onClose, onSubmit }) {
  const [form, setForm] = useState({
    key: badge?.key ?? '',
    name: badge?.name ?? '',
    description: badge?.description ?? '',
    points: badge?.points ?? 0,
    criteria: badge?.criteria ?? '',
  });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const isEdit = Boolean(badge?.id);
  const ready = form.key.trim() && form.name.trim() && form.criteria;

  return (
    <Modal
      open={Boolean(badge)}
      title={isEdit ? 'Editar conquista' : 'Nova conquista'}
      description="A chave identifica a conquista no código e precisa ser única."
      onClose={onClose}
      onSubmit={() => onSubmit({ ...form, description: form.description.trim() || null })}
      submitLabel={isEdit ? 'Salvar' : 'Criar conquista'}
      busy={busy}
    >
      <div className="form-grid">
        <label className="field">
          <span>Chave</span>
          <input
            className="input"
            value={form.key}
            onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
            placeholder="primeiro_curso"
          />
          <span className="tiny muted">Apenas minúsculas, números e underscore.</span>
        </label>
        <label className="field">
          <span>Nome</span>
          <input className="input" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Primeiro curso" />
        </label>
        <label className="field">
          <span>Descrição</span>
          <input
            className="input"
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Conclua o primeiro curso"
          />
        </label>
        <label className="field">
          <span>Critério</span>
          <select className="select" value={form.criteria} onChange={(e) => set({ criteria: e.target.value })}>
            <option value="">Escolha um critério</option>
            {criteria.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Pontos</span>
          <input
            className="input"
            type="number"
            min="0"
            value={form.points}
            onChange={(e) => set({ points: Number(e.target.value) })}
          />
        </label>
      </div>
      {!ready && <span className="tiny muted">Preencha chave, nome e critério para salvar.</span>}
    </Modal>
  );
}

function AwardDialog({ badge, users, busy, onClose, onSubmit }) {
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');

  return (
    <Modal
      open={Boolean(badge)}
      title={`Conceder "${badge?.name ?? ''}"`}
      description="Concessão manual: use para“不过a” ou para corrigir um erro. Conquistas normais são dadas pela plataforma."
      onClose={onClose}
      onSubmit={() => onSubmit(userId, reason)}
      submitLabel="Conceder conquista"
      busy={busy}
    >
      <label className="field">
        <span>Aluno</span>
        <select className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">Escolha um aluno</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.email})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Motivo</span>
        <input
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: cortesia do mês"
        />
      </label>
    </Modal>
  );
}
