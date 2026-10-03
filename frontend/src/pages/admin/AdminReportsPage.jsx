import { useState } from 'react';
import { adminApi } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { LoadingBlock, ErrorState } from '../../components/Feedback.jsx';
import { Panel, BarList, LineChart, SummaryBar, StatCard, StatusTag } from '../../components/admin/ui.jsx';
import { PageHead } from '../../components/admin/AdminLayout.jsx';
import { formatCurrency, formatNumber, formatDate } from '../../utils/format.js';

const PERIOD_OPTIONS = [
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: '365', label: '12 meses' },
];

/**
 * Relatórios respondem "o que está acontecendo", não "o que clicar". Por isso o
 * período é a única variável de controle: mudar o intervalo reescreve todas as
 * seções de uma vez, para o admin comparar o mesmo recorte.
 */
export default function AdminReportsPage() {
  const [days, setDays] = useState('30');

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Relatórios"
        description="Receita, atividade e conclusão no mesmo período."
        actions={
          <div className="row" style={{ gap: 6 }}>
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                className={`btn btn-sm ${days === p.value ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setDays(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        }
      />

      <RevenueSection days={days} />
      <ActivitySection days={days} />
      <div className="admin-grid-2">
        <TopCoursesSection />
        <TopInstructorsSection />
      </div>
      <CompletionSection />
    </div>
  );
}

function RevenueSection({ days }) {
  const { data, loading, error, refetch } = useApi(() => adminApi.reports.revenue({ days }), [days]);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const t = data.totals;
  const labels = data.series.map((p) => formatDate(p.day));
  const revenue = data.series.map((p) => p.revenueCents);
  const refunds = data.series.map((p) => p.refundCents);
  const enrollments = data.series.map((p) => p.enrollments);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="stat-grid">
        <StatCard icon="wallet" label="Receita paga" value={formatCurrency(t.paidCents)} note={`${formatNumber(t.paidOrders)} pedidos`} />
        <StatCard
          icon="arrowRight"
          label="Reembolsado"
          value={formatCurrency(t.refundedCents)}
          note={`${formatNumber(t.refundedOrders)} pedidos · ${formatNumber(t.refundRate)}% da receita`}
          tone={t.refundRate > 10 ? 'bad' : 'default'}
        />
        <StatCard icon="card" label="Ticket médio" value={formatCurrency(t.averageTicketCents)} />
        <StatCard icon="cap" label="Pedidos no período" value={formatNumber(t.totalOrders)} />
      </div>

      <Panel
        title="Receita e reembolsos por dia"
        description="Reembolso aparece ao lado para dar contexto a uma queda de receita."
      >
        <div className="stack" style={{ gap: 16 }}>
          <LineChart
            labels={labels}
            series={[revenue, refunds]}
            format={formatCurrency}
            empty="Nenhum pedido pago no período"
          />
          <LineChart
            labels={labels}
            series={[enrollments]}
            format={formatNumber}
            empty="Nenhuma matrícula no período"
          />
        </div>
      </Panel>
    </div>
  );
}

function ActivitySection({ days }) {
  const { data, loading, error, refetch } = useApi(() => adminApi.reports.activity({ days }), [days]);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  const labels = data.series.map((p) => formatDate(p.day));
  const total = (key) => data.series.reduce((sum, p) => sum + (p[key] ?? 0), 0);

  return (
    <Panel title="Atividade por dia" description="Cadastros, matrículas, publicações e avaliações">
      <div className="stack" style={{ gap: 16 }}>
        <SummaryBar
          items={[
            { label: 'cadastros', value: formatNumber(total('signups')) },
            { label: 'matrículas', value: formatNumber(total('enrollments')) },
            { label: 'publicações', value: formatNumber(total('posts')) },
            { label: 'avaliações', value: formatNumber(total('reviews')) },
          ]}
        />
        <LineChart
          labels={labels}
          series={[data.series.map((p) => p.signups), data.series.map((p) => p.enrollments)]}
          empty="Nenhuma atividade no período"
        />
      </div>
    </Panel>
  );
}

function TopCoursesSection() {
  const { data, loading, error, refetch } = useApi(() => adminApi.reports.topCourses(), []);

  if (loading) return <Panel title="Cursos mais vendidos"><LoadingBlock /></Panel>;
  if (error) return <Panel title="Cursos mais vendidos"><ErrorState error={error} onRetry={refetch} /></Panel>;

  const courses = data.courses;

  return (
    <Panel title="Cursos mais vendidos" description="Ordenado por receita paga">
      {!courses.length ? (
        <p className="muted small">Nenhuma venda registrada.</p>
      ) : (
        <div className="table-wrap">
          <table className="table table-admin">
            <thead>
              <tr>
                <th>Curso</th>
                <th className="cell-tight">Alunos</th>
                <th className="cell-tight">Receita</th>
                <th className="cell-tight">Nota</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="truncate">{c.title}</span>
                      <span className="tiny muted">{c.instructorName}</span>
                    </div>
                  </td>
                  <td className="cell-tight">{formatNumber(c.students)}</td>
                  <td className="cell-tight">{formatCurrency(c.revenueCents)}</td>
                  <td className="cell-tight">
                    {c.ratingAvg ? Number(c.ratingAvg).toFixed(1).replace('.', ',') : '—'}
                    <span className="tiny muted"> ({c.reviewCount})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function TopInstructorsSection() {
  const { data, loading, error, refetch } = useApi(() => adminApi.reports.topInstructors(), []);

  if (loading) return <Panel title="Instrutores"><LoadingBlock /></Panel>;
  if (error) return <Panel title="Instrutores"><ErrorState error={error} onRetry={refetch} /></Panel>;

  return (
    <Panel title="Instrutores" description="Por receita gerada">
      <BarList
        items={data.instructors.map((i) => ({
          id: i.id,
          label: i.name,
          value: i.revenueCents,
          note: `${formatNumber(i.courses)} cursos · ${formatNumber(i.students)} alunos`,
        }))}
        format={formatCurrency}
        empty="Nenhum instrutor com cursos publicados"
      />
    </Panel>
  );
}

function CompletionSection() {
  const { data, loading, error, refetch } = useApi(() => adminApi.reports.completion(), []);

  if (loading) return <Panel title="Conclusão dos cursos"><LoadingBlock /></Panel>;
  if (error) return <Panel title="Conclusão dos cursos"><ErrorState error={error} onRetry={refetch} /></Panel>;

  const courses = data.courses;

  return (
    <Panel
      title="Conclusão dos cursos"
      description="Onde a turma trava: um curso com muitos alunos e pouca conclusão pede revisão de conteúdo."
    >
      {!courses.length ? (
        <p className="muted small">Nenhum curso com matrículas ativas.</p>
      ) : (
        <div className="table-wrap">
          <table className="table table-admin">
            <thead>
              <tr>
                <th>Curso</th>
                <th>Status</th>
                <th className="cell-tight">Alunos</th>
                <th className="cell-tight">Concluíram</th>
                <th className="cell-tight">Progresso médio</th>
              </tr>
            </thead>
            <tbody>
              {courses.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="truncate">{c.title}</span>
                      <span className="tiny muted">
                        {formatNumber(c.moduleCount)} módulos · {formatNumber(c.lessonCount)} aulas
                      </span>
                    </div>
                  </td>
                  <td>
                    <StatusTag status={c.status} />
                  </td>
                  <td className="cell-tight">{formatNumber(c.students)}</td>
                  <td className="cell-tight">{formatNumber(c.completed)}</td>
                  <td className="cell-tight">
                    <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                      <div className="bar-track" style={{ width: 70 }}>
                        <div className="bar-fill" style={{ width: `${Math.min(100, c.avgProgress)}%` }} />
                      </div>
                      <span className="nowrap">{formatNumber(c.avgProgress)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
