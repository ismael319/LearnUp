import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { certificatesApi } from '../api/client.js';
import { Alert } from '../components/Alert.jsx';
import { Icon } from '../components/Icon.jsx';
import { formatDate } from '../utils/format.js';

export function VerifyCertificatePage() {
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('codigo') ?? '');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (event, value) => {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await certificatesApi.verify(value ?? code);
      setResult(data.certificate ? { ...data.certificate, valid: data.valid } : null);
      if (!data.certificate) setError(new Error('Certificado não encontrado.'));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // Permite abrir /verificar?codigo=XXX direto do e-mail do certificado.
  useEffect(() => {
    const initial = params.get('codigo');
    if (initial) lookup(null, initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="container page" style={{ maxWidth: 640 }}>
      <h1>Verificar certificado</h1>
      <p className="muted">Confira se um certificado da LearnUp é autêntico usando o código de verificação.</p>

      <form className="card card-pad stack" onSubmit={lookup} style={{ marginBottom: 20 }}>
        <div className="field">
          <label className="label" htmlFor="code">Código do certificado</label>
          <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="LU-XXXX-XXXX" required />
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || code.trim().length < 4}>
          {busy ? 'Verificando...' : 'Verificar'}
        </button>
      </form>

      {error && <Alert variant="danger">{error.message}</Alert>}

      {result && (
        <div className="card card-pad stack" style={{ borderColor: result.valid ? 'var(--success-600)' : 'var(--danger-600)' }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="empty-icon" aria-hidden="true">
              <Icon name={result.valid ? 'certificate' : 'alert'} size={30} />
            </span>
            <div className="stack" style={{ gap: 0 }}>
              <strong>{result.valid ? 'Certificado autêntico' : 'Certificado revogado'}</strong>
              <span className="tiny muted">Emitido por LearnUp</span>
            </div>
          </div>
          <hr className="divider" style={{ margin: '4px 0' }} />
          <p style={{ margin: 0 }}>
            <strong>{result.userName}</strong> concluiu o curso <strong>{result.courseTitle}</strong>
            {result.finalScore ? ` com nota ${result.finalScore}` : ''}.
          </p>
          <span className="small muted">Emitido em {formatDate(result.issuedAt)}</span>
          <code className="tiny" style={{ background: 'var(--ink-100)', padding: '6px 8px', borderRadius: 6 }}>{result.code}</code>
        </div>
      )}

      <p className="small muted center" style={{ marginTop: 20 }}>
        Não tem certificado ainda? <Link to="/catalogo">Explore os cursos</Link>
      </p>
    </div>
  );
}
