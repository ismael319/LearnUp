import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { CartProvider } from './context/CartContext.jsx';
import { Header } from './components/Header.jsx';
import { Footer } from './components/Footer.jsx';
import { LoadingBlock } from './components/Feedback.jsx';
import { AdminLayout } from './components/admin/AdminLayout.jsx';

import { HomePage, AboutPage, ContactPage, LegalPage, NotFoundPage } from './pages/StaticPages.jsx';
import { LoginPage } from './pages/LoginPage.jsx';
import { RegisterPage } from './pages/RegisterPage.jsx';
import { CatalogPage } from './pages/CatalogPage.jsx';
import { CourseDetailPage } from './pages/CourseDetailPage.jsx';
import { CheckoutPage } from './pages/CheckoutPage.jsx';
import { LearningPage } from './pages/LearningPage.jsx';
import { AccountPage } from './pages/AccountPage.jsx';
import { CartPage } from './pages/CartPage.jsx';
import { PreviewPage } from './pages/PreviewPage.jsx';
import { VerifyCertificatePage } from './pages/VerifyCertificatePage.jsx';
import { ForumPage, ForumPostPage, NewPostPage, LeaderboardPage } from './pages/ForumPage.jsx';
import { InstructorPage, CourseEditorPage } from './pages/InstructorPages.jsx';

import AdminDashboardPage from './pages/admin/AdminDashboardPage.jsx';
import AdminCoursesPage from './pages/admin/AdminCoursesPage.jsx';
import AdminUsersPage from './pages/admin/AdminUsersPage.jsx';
import AdminOrdersPage from './pages/admin/AdminOrdersPage.jsx';
import AdminEnrollmentsPage from './pages/admin/AdminEnrollmentsPage.jsx';
import AdminContentPage from './pages/admin/AdminContentPage.jsx';
import AdminModerationPage from './pages/admin/AdminModerationPage.jsx';
import AdminReportsPage from './pages/admin/AdminReportsPage.jsx';
import AdminSettingsPage from './pages/admin/AdminSettingsPage.jsx';
import AdminAuditPage from './pages/admin/AdminAuditPage.jsx';

import './styles/global.css';

/** Bloqueia rotas privadas e guarda o destino para redirecionar após o login. */
function RequireAuth({ children }) {
  const { isAuthenticated, booting } = useAuth();
  const location = useLocation();

  if (booting) return <LoadingBlock label="Verificando sua sessão..." />;
  if (!isAuthenticated) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  return children;
}

/**
 * Exige um papel específico além da sessão ativa. Montar a tela e esconder
 * o link não é proteção: a API valida de novo, e aqui evitamos apenas mostrar
 * uma página vazia a quem não pode usá-la.
 */
function RequireRole({ roles, children }) {
  const { user, booting } = useAuth();
  const location = useLocation();

  if (booting) return <LoadingBlock label="Verificando sua sessão..." />;
  if (!user) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** Casca do site: cabeçalho e rodapé, como o aluno e o instrutor conhecem. */
function SiteShell() {
  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sobre" element={<AboutPage />} />
          <Route path="/contato" element={<ContactPage />} />
          <Route path="/termos" element={<LegalPage type="terms" />} />
          <Route path="/privacidade" element={<LegalPage type="privacy" />} />
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="/cadastro" element={<RegisterPage />} />
          <Route path="/catalogo" element={<CatalogPage />} />
          <Route path="/cursos/:slug" element={<CourseDetailPage />} />
          <Route path="/ranking" element={<LeaderboardPage />} />
          <Route path="/forum" element={<ForumPage />} />
          <Route path="/forum/novo" element={<RequireAuth><NewPostPage /></RequireAuth>} />
          <Route path="/forum/:postId" element={<ForumPostPage />} />
          <Route path="/verificar" element={<VerifyCertificatePage />} />
          <Route path="/carrinho" element={<CartPage />} />
          <Route path="/prever/:courseId" element={<PreviewPage />} />
          <Route path="/checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
          <Route path="/checkout/:courseId" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
          <Route path="/aprender/:courseId" element={<RequireAuth><LearningPage /></RequireAuth>} />
          <Route path="/minha-conta" element={<RequireAuth><AccountPage /></RequireAuth>} />
          <Route
            path="/instructor"
            element={<RequireRole roles={['instructor', 'admin']}><InstructorPage /></RequireRole>}
          />
          <Route
            path="/instructor/curso/:courseId"
            element={<RequireRole roles={['instructor', 'admin']}><CourseEditorPage /></RequireRole>}
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
        <ScrollToTop />
        {/*
         * O painel tem shell próprio (menu lateral + topbar), sem o cabeçalho do
         * site. Por isso `/admin` é um ramo de fora do `SiteShell`.
         *
         * O guard fica na rota-pai, e não em cada sub-rota: as dez telas já
         * nascem protegidas, e uma sub-rota nova não pode ser esquecida. A API
         * valida de novo — isto aqui evita renderizar uma tela que terminaria em
         * 403 — mas a proteção de verdade é o `requireRole` no servidor.
         */}
        <Routes>
          <Route
            path="/admin"
            element={
              <RequireRole roles={['admin']}>
                <AdminLayout />
              </RequireRole>
            }
          >
            <Route index element={<AdminDashboardPage />} />
            <Route path="cursos" element={<AdminCoursesPage />} />
            <Route path="usuarios" element={<AdminUsersPage />} />
            <Route path="pedidos" element={<AdminOrdersPage />} />
            <Route path="matriculas" element={<AdminEnrollmentsPage />} />
            <Route path="conteudo" element={<AdminContentPage />} />
            <Route path="moderacao" element={<AdminModerationPage />} />
            <Route path="relatorios" element={<AdminReportsPage />} />
            <Route path="configuracoes" element={<AdminSettingsPage />} />
            <Route path="auditoria" element={<AdminAuditPage />} />
            {/* Sub-rota desconhecida volta para a visão geral, não para 404. */}
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Route>

          <Route path="*" element={<SiteShell />} />
        </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
