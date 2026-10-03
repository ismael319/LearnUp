import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert } from '../components/Alert.jsx';
import { Spinner } from '../components/Feedback.jsx';
import { Icon } from '../components/Icon.jsx';

/** Regras espelhadas das do backend (zod) para dar feedback na hora. */
const RULES = [
  { test: (v) => v.length >= 8, label: 'Pelo menos 8 caracteres' },
  { test: (v) => /[a-zA-Z]/.test(v), label: 'Ao menos uma letra' },
  { test: (v) => /\d/.test(v), label: 'Ao menos um número' },
];

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', password: '', acceptTerms: false });
  const [touched, setTouched] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (field) => (event) => {
    const value = field === 'acceptTerms' ? event.target.checked : event.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const failures = useMemo(() => {
    const list = [];
    if (form.name.trim().length < 2) list.push({ field: 'name', message: 'Informe seu nome completo.' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) list.push({ field: 'email', message: 'E-mail inválido.' });
    for (const rule of RULES) {
      if (!rule.test(form.password)) list.push({ field: 'password', message: `A senha precisa: ${rule.label.toLowerCase()}.` });
    }
    if (!form.acceptTerms) list.push({ field: 'acceptTerms', message: 'É preciso aceitar os termos.' });
    return list;
  }, [form]);

  const fieldError = (field) => {
    if (!touched[field]) return null;
    return failures.find((f) => f.field === field)?.message ?? null;
  };

  const valid = failures.length === 0;

  const submit = async (event) => {
    event.preventDefault();
    setTouched({ name: true, email: true, password: true, acceptTerms: true });
    if (!valid) return;

    setBusy(true);
    setError(null);
    try {
      await register({ ...form });
      navigate('/catalogo', { replace: true });
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
          <h1 style={{ margin: 0 }}>Criar conta</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Grátis para começar. Sem cartão de crédito.
          </p>
        </div>

        {error && (
          <Alert variant="danger">
            {error.message}
            {Array.isArray(error.details) && (
              <ul>
                {error.details.map((d, i) => (
                  <li key={i}>{d.message}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        <form className="stack" onSubmit={submit} noValidate>
          <div className="field">
            <label className="label" htmlFor="name">Nome completo</label>
            <input id="name" className="input" value={form.name} onChange={update('name')} onBlur={() => setTouched((t) => ({ ...t, name: true }))} autoComplete="name" required autoFocus />
            {fieldError('name') && <span className="field-error">{fieldError('name')}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="email">E-mail</label>
            <input id="email" type="email" className="input" value={form.email} onChange={update('email')} onBlur={() => setTouched((t) => ({ ...t, email: true }))} autoComplete="email" required />
            {fieldError('email') && <span className="field-error">{fieldError('email')}</span>}
          </div>

          <div className="field">
            <label className="label" htmlFor="password">Senha</label>
            <input id="password" type="password" className="input" value={form.password} onChange={update('password')} onBlur={() => setTouched((t) => ({ ...t, password: true }))} autoComplete="new-password" required />
            {fieldError('password') ? (
              <span className="field-error">{fieldError('password')}</span>
            ) : (
              <ul className="stack" style={{ gap: 2, listStyle: 'none', padding: 0, margin: 0 }}>
                {RULES.map((rule) => {
                  const ok = rule.test(form.password);
                  return (
                    <li
                      key={rule.label}
                      className="tiny row"
                      style={{ gap: 6, color: ok ? 'var(--success-600)' : 'var(--ink-500)' }}
                    >
                      <Icon name={ok ? 'check' : 'info'} size={13} /> {rule.label}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="field">
            <label className="checkbox">
              <input type="checkbox" checked={form.acceptTerms} onChange={update('acceptTerms')} />
              <span>Li e aceito os termos de uso e a política de privacidade.</span>
            </label>
            {fieldError('acceptTerms') && <span className="field-error">{fieldError('acceptTerms')}</span>}
          </div>

          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !valid}>
            {busy && <Spinner />}
            {busy ? 'Criando conta...' : 'Criar conta grátis'}
          </button>
        </form>

        <p className="small center" style={{ margin: 0 }}>
          Já tem conta? <Link to="/entrar">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
