import { useMemo, useState } from 'react';
import { adminApi } from '../../api/client.js';
import { useApi } from '../../hooks/useApi.js';
import { LoadingBlock, ErrorState } from '../../components/Feedback.jsx';
import { Panel } from '../../components/admin/ui.jsx';
import { PageHead } from '../../components/admin/AdminLayout.jsx';
import { Icon } from '../../components/Icon.jsx';
import { formatDateTime } from '../../utils/format.js';

/**
 * As configurações são definidas no backend (`SETTING_DEFS`) e chegam aqui com
 * rótulo, tipo, descrição e faixa. A tela não mantém uma lista própria de
 * campos: uma chave nova no backend aparece aqui sozinha, e uma removida some
 * sem deixar formulário órfão.
 */
export default function AdminSettingsPage() {
  const { data, loading, error, refetch } = useApi(() => adminApi.settings(), []);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const settings = data?.settings ?? [];
  const groups = useMemo(() => {
    const map = new Map();
    for (const s of settings) {
      if (!map.has(s.group)) map.set(s.group, []);
      map.get(s.group).push(s);
    }
    return [...map.entries()];
  }, [settings]);

  // Só as chaves que o admin realmente mexeu vão no PATCH: mandar tudo faria a
  // auditoria registrar alteração onde não houve nenhuma.
  const changed = settings.filter((s) => s.key in draft && !sameValue(s.value, draft[s.key]));

  const setValue = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const reset = () => setDraft({});

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const patch = Object.fromEntries(changed.map((s) => [s.key, draft[s.key]]));
      await adminApi.saveSettings(patch);
      setDraft({});
      setNotice({ message: `${changed.length} configuração(ões) salva(s).` });
      refetch();
    } catch (err) {
      setSaveError(err);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingBlock label="Carregando configurações..." />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <PageHead
        title="Configurações"
        description="Identidade da plataforma, aviso de manutenção e regras do catálogo."
        actions={
          <>
            {changed.length > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={busy}>
                Descartar
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={save}
              disabled={busy || changed.length === 0}
            >
              {busy && <span className="spinner" style={{ width: 14, height: 14 }} />}
              Salvar {changed.length > 0 ? `(${changed.length})` : ''}
            </button>
          </>
        }
      />

      {saveError && <div className="alert alert-danger">{saveError.message}</div>}

      {notice && (
        <div className="alert alert-success">
          <div className="grow">{notice.message}</div>
          <button type="button" className="alert-close" onClick={() => setNotice(null)} aria-label="Fechar">
            <Icon name="x" size={16} />
          </button>
        </div>
      )}

      {changed.length > 0 && (
        <div className="alert alert-info" role="status">
          <Icon name="edit" size={18} />
          <div className="grow">
            {changed.length} alteração(ões) não salva(s): {changed.map((s) => s.label).join(', ')}.
          </div>
        </div>
      )}

      {groups.map(([group, items]) => (
        <Panel key={group} title={group}>
          <div className="stack" style={{ gap: 18 }}>
            {items.map((setting) => (
              <SettingField
                key={setting.key}
                setting={setting}
                value={setting.key in draft ? draft[setting.key] : setting.value}
                onChange={(v) => setValue(setting.key, v)}
                dirty={setting.key in draft && !sameValue(setting.value, draft[setting.key])}
              />
            ))}
          </div>
        </Panel>
      ))}

      <p className="tiny muted">
        Configurações alteradas pela última vez:{' '}
        {settings
          .map((s) => s.updatedAt)
          .filter(Boolean)
          .sort()
          .reverse()[0]
          ? formatDateTime(
              settings
                .map((s) => s.updatedAt)
                .filter(Boolean)
                .sort()
                .reverse()[0],
            )
          : 'nunca'}
      </p>
    </div>
  );
}

/** `true` e `"true"` precisam ser iguais, senão o boolean da DB "mudaria" sozinho. */
const sameValue = (a, b) => {
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  return String(a ?? '') === String(b ?? '');
};

function SettingField({ setting, value, onChange, dirty }) {
  const id = `setting-${setting.key.replace(/\./g, '-')}`;

  return (
    <div className="setting-row">
      <label className="stack" style={{ gap: 2 }} htmlFor={id}>
        <span className="row" style={{ gap: 6 }}>
          <strong>{setting.label}</strong>
          {dirty && <span className="pill pill-warn">alterado</span>}
        </span>
        <span className="tiny muted">{setting.description}</span>
        <span className="tiny muted mono">{setting.key}</span>
      </label>

      <div className="setting-control">
        {setting.type === 'boolean' ? (
          <label className="switch">
            <input
              id={id}
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span>{Boolean(value) ? 'Ativo' : 'Inativo'}</span>
          </label>
        ) : setting.type === 'number' ? (
          <input
            id={id}
            className="input"
            type="number"
            min={setting.min}
            max={setting.max}
            value={value ?? ''}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        ) : (
          <input
            id={id}
            className="input"
            type={setting.type === 'email' ? 'email' : 'text'}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {setting.type === 'number' && (setting.min || setting.max) && (
          <span className="tiny muted">
            entre {setting.min} e {setting.max}
          </span>
        )}
      </div>
    </div>
  );
}
