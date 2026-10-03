import { Link } from 'react-router-dom';
import { adminApi } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { LoadingBlock, ErrorState, EmptyState } from '../../components/Feedback.jsx';
import { StatCard, Panel, BarList, SummaryBar } from '../../components/admin/ui.jsx';
import { PageHead } from '../../components/admin/AdminLayout.jsx';
import { formatNumber, formatCurrency, formatDate } from '../../utils/format.js';

/** Topo do painel: números que exigem decisão, não só números. */
export default function AdminDashboardPage() {
  const { data, loading, error, refetch } = useApi(() => adminApi.overview(), []);

  if (loading) return <LoadingBlock label="Carregando o painel..." />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const o = data.overview;
  const s = data.summary ?? {};

  return (
    <div className="stack" style={{ gap: 20 }}>
      <PageHead
        title="Visão geral"
        description="O que mudou na plataforma e o que está esperando você."
        actions={
          <Link to="/admin/relatorios" className="btn btn-secondary btn-sm">
            Ver relatórios
          </Link>
        }
      />

      <div className="stat-grid">
        <StatCard
          icon="wallet"
          label="Receita (30 dias)"
          value={formatCurrency(s.revenue30dCents)}
          note={
            s.revenueVariation === null || s.revenueVariation === undefined
              ? 'sem histórico de 30 dias para comparar'
              : `${s.revenueVariation >= 0 ? '+' : ''}${formatNumber(s.revenueVariation)}% vs. 30 dias anteriores`
          }
          tone={s.revenueVariation > 0 ? 'good' : s.revenueVariation < 0 ? 'bad' : 'default'}
        />
        <StatCard
          icon="users"
          label="Alunos"
          value={formatNumber(o.users.students)}
          note={`${formatNumber(s.newUsers30d ?? 0)} novos em 30 dias`}
        />
        <StatCard
          icon="book"
          label="Cursos publicados"
          value={formatNumber(o.courses.published)}
          note={`${formatNumber(o.courses.drafts)} rascunhos · ${formatNumber(o.courses.archived)} arquivados`}
        />
        <StatCard
          icon="cap"
          label="Matrículas ativas"
          value={formatNumber(o.enrollmentStats?.active ?? 0)}
          note={`${formatNumber(o.enrollments)} no total`}
        />
        <StatCard
          icon="lock"
          label="Contas bloqueadas"
          value={formatNumber(o.users.blocked)}
          note={o.users.blocked ? 'acesso e sessões encerrados' : 'nenhuma'}
          tone={o.users.blocked ? 'bad' : 'default'}
        />
        <StatCard
          icon="megaphone"
          label="Fila de moderação"
          value={formatNumber(
            o.moderation.hiddenReviews + o.moderation.hiddenPosts + o.moderation.hiddenComments,
          )}
          note={`${formatNumber(o.moderation.hiddenReviews)} avaliações · ${formatNumber(o.moderation.hiddenPosts)} posts · ${formatNumber(o.moderation.hiddenComments)} comentários`}
        />
      </div>

      <FilaDeEspera overview={o} />

      <div className="admin-grid-2">
        <Panel title="Receita por dia" description="Pedidos pagos e reembolsados nos últimos 30 dias">
          <RevenueSpark />
        </Panel>

        <Panel title="Cursos mais vendidos" description="Por número de matrículas ativas">
          <TopCourses />
        </Panel>
      </div>
    </div>
  );
}

/** O bloco mais importante do topo: o que está parado esperando decisão. */
function FilaDeEspera({ overview }) {
  const items = [
    {
      to: '/admin/cursos?status=in_review',
      count: overview.courses.inReview,
      label: 'curso(s) aguardando aprovação',
      action: 'Avaliar publicação',
    },
    {
      to: '/admin/pedidos?status=pending',
      count: overview.orders.pendingOrders,
      label: 'pedido(s) pendentes de confirmação',
      action: 'Conferir pagamento',
    },
    {
      to: '/admin/moderacao',
      count:
        overview.moderation.hiddenReviews + overview.moderation.hiddenPosts + overview.moderation.hiddenComments,
      label: 'item(ns) ocultos pela moderação',
      action: 'Rever conteúdo',
    },
  ].filter((item) => item.count > 0);

  if (!items.length) {
    return (
      <Panel title="Fila de trabalho">
        <EmptyState
          icon="check"
          title="Nada esperando por você"
          description="Nenhum curso para aprovar, pedido pendente ou conteúdo ocultado."
        />
      </Panel>
    );
  }

  return (
    <Panel title="Fila de trabalho" description="Itens que travam a operação até uma decisão">
      <ul className="queue-list">
        {items.map((item) => (
          <li key={item.to}>
            <div className="stack" style={{ gap: 2 }}>
              <strong>
                {formatNumber(item.count)} {item.label}
              </strong>
              <span className="small muted">{item.action}</span>
            </div>
            <Link to={item.to} className="btn btn-secondary btn-sm">
              Abrir
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function RevenueSpark() {
  const { data, loading, error } = useApi(() => adminApi.reports.revenue({ days: 30 }), []);

  if (loading) return <p className="muted small">Carregando...</p>;
  if (error) return <p className="muted small">Não foi possível carregar a série de receita.</p>;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <SummaryBar
        items={[
          { label: 'receita paga', value: formatCurrency(data.totals.paidCents) },
          { label: 'reembolsado', value: formatCurrency(data.totals.refundedCents) },
          { label: 'taxa de reembolso', value: `${formatNumber(data.totals.refundRate)}%` },
          { label: 'ticket médio', value: formatCurrency(data.totals.averageTicketCents) },
        ]}
      />
      <MiniBars points={data.series} />
    </div>
  );
}

/** Barras verticais simples: mais legível que área empilhada para 30 dias. */
function MiniBars({ points = [] }) {
  if (!points.length) return <p className="muted small">Sem pedidos no período.</p>;
  const max = Math.max(...points.map((p) => p.revenueCents || 0), 1);

  return (
    <div className="mini-bars" role="img" aria-label="Receita diária dos últimos 30 dias">
      {points.map((point) => (
        <span
          key={point.day}
          className="mini-bar"
          style={{ height: `${Math.max(2, Math.round(((point.revenueCents || 0) / max) * 100))}%` }}
          title={`${formatDate(point.day)}: ${formatCurrency(point.revenueCents)}`}
        />
      ))}
    </div>
  );
}

function TopCourses() {
  const { data, loading, error } = useApi(() => adminApi.reports.topCourses(), []);

  if (loading) return <p className="muted small">Carregando...</p>;
  if (error) return <p className="muted small">Não foi possível carregar o ranking.</p>;

  return (
    <BarList
      items={data.courses.map((c) => ({
        id: c.id,
        label: c.title,
        value: c.students,
        note: `${formatNumber(c.orders)} pedidos pagos · ${formatCurrency(c.revenueCents)}`,
      }))}
      empty="Nenhuma matrícula ativa ainda"
    />
  );
}
