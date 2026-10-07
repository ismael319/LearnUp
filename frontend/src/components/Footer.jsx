import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from './Icon.jsx';
import { platformApi } from '../api/client.js';
import { useApi } from '../hooks/useApi.js';

const NAV_LINKS = [
  { to: '/catalogo', label: 'Cursos' },
  { to: '/verificar', label: 'Validar certificado' },
  { to: '/ranking', label: 'Ranking' },
  { to: '/forum', label: 'Comunidade' },
  { to: '/sobre', label: 'Sobre' },
];

const SOCIAL = [
  { icon: 'instagram', label: 'Instagram', href: 'https://instagram.com' },
  { icon: 'facebook', label: 'Facebook', href: 'https://facebook.com' },
  { icon: 'youtube', label: 'YouTube', href: 'https://youtube.com' },
  { icon: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/5500000000000' },
];

export function Footer() {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const { data: platform } = useApi(() => platformApi.settings(), []);
  const settings = platform?.settings ?? {};
  const name = settings['platform.name'] ?? 'LearnUp';
  const whatsapp = String(settings['platform.whatsapp'] ?? '').replace(/\D/g, '');

  const search = (event) => {
    event.preventDefault();
    const term = query.trim();
    navigate(term ? `/catalogo?search=${encodeURIComponent(term)}` : '/catalogo');
  };

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div className="stack" style={{ gap: 16 }}>
            <Link to="/" className="logo">
              <span className="logo-mark" aria-hidden="true">
                <Icon name="cap" size={18} />
              </span>
              {name}
            </Link>
            <p className="small muted" style={{ maxWidth: 340, margin: 0 }}>
              {settings['platform.tagline'] ?? 'Cursos online'} com acompanhamento de progresso, quizzes, certificados verificáveis
              e uma comunidade de alunos.
            </p>
            <div className="row" style={{ gap: 8 }}>
              {SOCIAL.filter((item) => item.icon !== 'whatsapp' || whatsapp).map((item) => (
                <a
                  key={item.label}
                  href={item.icon === 'whatsapp' ? `https://wa.me/${whatsapp}` : item.href}
                  className="social-link"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={item.label}
                >
                  <Icon name={item.icon} size={18} />
                </a>
              ))}
            </div>
          </div>

          <nav className="stack" style={{ gap: 10 }} aria-label="Links do rodapé">
            <h3 className="footer-title">Navegação</h3>
            {NAV_LINKS.map((link) => (
              <Link key={link.to} to={link.to} className="footer-link">
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="stack" style={{ gap: 12 }}>
            <h3 className="footer-title">Encontre um curso</h3>
            <form className="footer-search" onSubmit={search} role="search">
              <input
                type="search"
                className="input"
                placeholder="Ex.: NR 12, NR 35, EPI..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Buscar cursos"
              />
              <button type="submit" className="icon-button search-submit" aria-label="Buscar">
                <Icon name="search" size={18} />
              </button>
            </form>
            <p className="tiny muted" style={{ margin: 0 }}>
              Matrícula imediata, acesso liberado assim que o pagamento é aprovado.
            </p>
          </div>
        </div>

        <hr className="divider" style={{ margin: '32px 0 16px' }} />

        <div className="footer-bottom">
          <p className="tiny muted" style={{ margin: 0 }}>
            © {new Date().getFullYear()} {settings['platform.legal_name'] ?? name}{settings['platform.document'] ? ` · CNPJ ${settings['platform.document']}` : ''}
          </p>
          <div className="row wrap" style={{ gap: 16 }}>
            <Link className="footer-link" to="/termos">Termos de uso</Link>
            <Link className="footer-link" to="/privacidade">Privacidade</Link>
            <Link className="footer-link" to="/contato">Contato</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
