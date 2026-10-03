import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Avatar } from './Avatar.jsx';
import { Icon } from './Icon.jsx';

const NAV = [
  { to: '/catalogo', label: 'Catálogo' },
  { to: '/forum', label: 'Comunidade' },
  { to: '/ranking', label: 'Ranking' },
  { to: '/verificar', label: 'Verificar certificado' },
];

export function Header() {
  const { user, isAuthenticated, canManageCourses, isAdmin, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);
  const navigate = useNavigate();

  const close = () => setMenuOpen(false);

  const handleLogout = async () => {
    setAccountOpen(false);
    setMenuOpen(false);
    await logout();
    navigate('/');
  };

  // Fecha o menu da conta ao clicar fora dele.
  useEffect(() => {
    if (!accountOpen) return undefined;
    const onClick = (event) => {
      if (accountRef.current && !accountRef.current.contains(event.target)) setAccountOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [accountOpen]);

  const links = isAuthenticated ? [{ to: '/minha-conta', label: 'Minha conta' }, ...NAV] : NAV;

  return (
    <header className="header">
      <div className="container header-inner">
        <button
          type="button"
          className="icon-button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu de navegação'}
        >
          <Icon name={menuOpen ? 'x' : 'list'} size={20} />
        </button>

        <Link to="/" className="logo header-logo" onClick={close}>
          <span className="logo-mark" aria-hidden="true">
            <Icon name="cap" size={18} />
          </span>
          LearnUp
        </Link>

        <nav className="nav" aria-label="Navegação principal">
          {links.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="header-actions">
          {isAuthenticated ? (
            <div className="account" ref={accountRef}>
              <button
                type="button"
                className="account-trigger"
                onClick={() => setAccountOpen((v) => !v)}
                aria-expanded={accountOpen}
                aria-haspopup="menu"
              >
                <Avatar name={user.name} src={user.avatarUrl} size="sm" />
                <span className="account-name">{user.name?.split(' ')[0]}</span>
                <Icon name="caretDown" size={14} />
              </button>

              {accountOpen && (
                <div className="menu" role="menu">
                  <Link to="/minha-conta" className="menu-item" onClick={() => setAccountOpen(false)}>
                    <Icon name="user" size={16} /> Meus dados
                  </Link>
                  <Link to="/minha-conta" className="menu-item" onClick={() => setAccountOpen(false)}>
                    <Icon name="book" size={16} /> Minhas matrículas
                  </Link>
                  <Link to="/minha-conta" className="menu-item" onClick={() => setAccountOpen(false)}>
                    <Icon name="certificate" size={16} /> Meus certificados
                  </Link>
                  {canManageCourses && (
                    <Link to="/instructor" className="menu-item" onClick={() => setAccountOpen(false)}>
                      <Icon name="book" size={16} /> Meus cursos
                    </Link>
                  )}
                  {isAdmin && (
                    <Link to="/admin" className="menu-item" onClick={() => setAccountOpen(false)}>
                      <Icon name="shield" size={16} /> Administração
                    </Link>
                  )}
                  <div className="menu-sep" role="separator" />
                  <button type="button" className="menu-item danger" onClick={handleLogout}>
                    <Icon name="x" size={16} /> Sair
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link to="/entrar" className="btn btn-ghost btn-sm" onClick={close}>
                Entrar
              </Link>
              <Link to="/cadastro" className="btn btn-primary btn-sm" onClick={close}>
                Cadastre-se
              </Link>
            </>
          )}
        </div>
      </div>

      {menuOpen && (
        <nav className="mobile-nav open" aria-label="Navegação móvel">
          {links.map((item) => (
            <NavLink key={item.to} to={item.to} onClick={close} className={({ isActive }) => (isActive ? 'active' : '')}>
              {item.label}
            </NavLink>
          ))}
          {!isAuthenticated && (
            <div className="stack" style={{ gap: 8, marginTop: 8 }}>
              <Link to="/entrar" className="btn btn-secondary btn-block" onClick={close}>Entrar</Link>
              <Link to="/cadastro" className="btn btn-primary btn-block" onClick={close}>Cadastre-se</Link>
            </div>
          )}
        </nav>
      )}
    </header>
  );
}
