import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert } from '../components/Alert.jsx';
import { Spinner } from '../components/Feedback.jsx';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const redirectTo = location.state?.from ?? '/minha-conta';

  const update = (field) => (event) => setForm((f) => ({ ...f, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(form);
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container page" style={{ maxWidth: 460 }}>
      <div className="card card-pad stack" style={{ gap: 20 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ margin: 0 }}>Entrar</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Continue de onde parou.
          </p>
        </div>

        {error && <Alert variant="danger">{error.message}</Alert>}

        <form className="stack" onSubmit={submit} noValidate>
          <div className="field">
            <label className="label" htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              className="input"
              value={form.email}
              onChange={update('email')}
              autoComplete="email"
              required
              autoFocus
            />
          </div>

          <div className="field">
            <label className="label" htmlFor="password">Senha</label>
            <input
              id="password"
              type="password"
              className="input"
              value={form.password}
              onChange={update('password')}
              autoComplete="current-password"
              required
            />
          </div>

          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
            {busy && <Spinner />}
            {busy ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="small center" style={{ margin: 0 }}>
          Ainda não tem conta? <Link to="/cadastro">Cadastre-se grátis</Link>
        </p>
      </div>
    </div>
  );
}
