import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import { Icon } from '../Icon.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { adminApi } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { formatNumber } from '../../utils/format.js';

/**
 * Menu do painel. `badge` marca quantos itens exigem ação agora — é o que faz o
 * admin saber onde olhar sem abrir cada tela.
 */
export const ADMIN_NAV = [
  { to: '/admin', end: true, label: 'Visão geral', icon: 'chart' },
  { to: '/admin/cursos', label: 'Cursos', icon: 'book', badge: 'inReview' },
  { to: '/admin/usuarios', label: 'Usuários', icon: 'users' },
  { to: '/admin/pedidos', label: 'Pedidos', icon: 'wallet', badge: 'pendingOrders' },
  { to: '/admin/matriculas', label: 'Matrículas', icon: 'cap' },
  { to: '/admin/conteudo', label: 'Categorias e badges', icon: 'palette' },
  { to: '/admin/moderacao', label: 'Moderação', icon: 'megaphone', badge: 'hiddenCount' },
  { to: '/admin/relatorios', label: 'Relatórios', icon: 'spark' },
  { to: '/admin/configuracoes', label: 'Configurações', icon: 'edit' },
  { to: '/admin/auditoria', label: 'Auditoria', icon: 'list' },
];

export function AdminLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // A sidebar é uma gaveta no mobile: navegar fecha, senão a tela nova fica
  // escondida atrás do menu.
  useEffect(() => setOpen(false), [location.pathname]);

  const current = ADMIN_NAV.find((item) => (item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)));

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${open ? 'open' : ''}`}>
        <div className="admin-brand">
          <Link to="/admin" className="admin-brand-link">
            <span className="admin-logo" aria-hidden="true">
              <Icon name="shield" size={20} />
            </span>
            <span>
              <strong>Painel</strong>
              <small>Administração</small>
            </span>
          </Link>
          <button type="button" className="icon-btn admin-sidebar-close" onClick={() => setOpen(false)} aria-label="Fechar menu">
            <Icon name="x" size={18} />
          </button>
        </div>

        <AdminNav />
      </aside>

      {open && <div className="admin-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}

      <div className="admin-main">
        <header className="admin-topbar">
          <button type="button" className="icon-btn admin-menu-btn" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Icon name="list" size={20} />
          </button>
          <h1 className="admin-topbar-title">{current?.label ?? 'Administração'}</h1>
          <Link to="/" className="btn btn-ghost btn-sm">
            Ver o site
          </Link>
        </header>

        <div className="admin-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

/**
 * Contadores do menu.
 *
 * Ficam aqui, e não em cada tela, porque os badges são do menu: uma requisição
 * por montagem do layout, em vez de uma por página. Os números são do momento em
 * que o layout montou. Quem altera uma fila e volta para a tela recarrega o
 * overview junto, então o contador reflete a ação.
 */
function AdminNav() {
  const { data } = useApi(() => adminApi.overview(), []);
  const { user } = useAuth();
  const o = data?.overview;

  const counts = {
    inReview: o?.courses?.inReview ?? 0,
    pendingOrders: o?.orders?.pendingOrders ?? 0,
    hiddenCount:
      (o?.moderation?.hiddenReviews ?? 0) + (o?.moderation?.hiddenPosts ?? 0) + (o?.moderation?.hiddenComments ?? 0),
  };

  return (
    <nav className="admin-nav" aria-label="Seções do painel">
      {ADMIN_NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `admin-nav-link ${isActive ? 'active' : ''}`}
        >
          <Icon name={item.icon} size={17} />
          <span>{item.label}</span>
          {item.badge && counts[item.badge] > 0 && (
            <span className="admin-nav-badge" title={`${counts[item.badge]} aguardando ação`}>
              {formatNumber(counts[item.badge])}
            </span>
          )}
        </NavLink>
      ))}

      <div className="admin-nav-foot">
        <p className="tiny muted" style={{ margin: 0 }}>
          {user?.name}
          <br />
          {user?.email}
        </p>
      </div>
    </nav>
  );
}

/** Cabeçalho padrão das telas internas. */
export function PageHead({ title, description, actions }) {
  return (
    <div className="page-head">
      <div className="stack" style={{ gap: 4 }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        {description && <p className="muted" style={{ margin: 0 }}>{description}</p>}
      </div>
      {actions && <div className="row wrap" style={{ gap: 8 }}>{actions}</div>}
    </div>
  );
}
