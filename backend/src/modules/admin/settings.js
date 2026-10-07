import { z } from 'zod';
import { query, queryAll } from '../../config/database.js';
import { transaction } from '../../config/database.js';
import { recordAudit } from './audit.js';
import { badRequest, notFound } from '../../utils/errors.js';

/**
 * Configurações da plataforma.
 *
 * A definição fica no código (e não no banco) de propósito: o formato de cada
 * chave é uma decisão de aplicação, e colocá-lo numa tabela faria o banco poder
 * aceitar tipos que o front não sabe desenhar. O banco guarda só o valor.
 */
export const SETTING_DEFS = [
  {
    key: 'platform.name',
    group: 'Plataforma',
    type: 'text',
    label: 'Nome da plataforma',
    description: 'Aparece no cabeçalho, no rodapé e no título do navegador.',
    default: 'LearnUp',
  },
  {
    key: 'platform.tagline',
    group: 'Plataforma',
    type: 'text',
    label: 'Assinatura',
    description: 'Frase curta que resume a oferta.',
    default: 'Cursos de segurança do trabalho',
  },
  {
    key: 'platform.support_email',
    group: 'Plataforma',
    type: 'email',
    label: 'E-mail de suporte',
    description: 'Mostrado no rodapé para o aluno pedir ajuda.',
    default: 'suporte@learnup.dev',
  },
  {
    key: 'platform.whatsapp',
    group: 'Plataforma',
    type: 'text',
    label: 'WhatsApp de suporte',
    description: 'Número com DDI, apenas dígitos. Ex.: 5511999999999.',
    default: '',
  },
  {
    key: 'platform.legal_name',
    group: 'Plataforma',
    type: 'text',
    label: 'Razão social',
    description: 'Exibida nas páginas legais e no rodapé.',
    default: 'LearnUp',
  },
  {
    key: 'platform.document',
    group: 'Plataforma',
    type: 'text',
    label: 'CNPJ',
    description: 'Documento exibido no rodapé institucional.',
    default: '',
  },
  {
    key: 'platform.demo_mode',
    group: 'Plataforma',
    type: 'boolean',
    label: 'Modo demonstração',
    description: 'Exibe um aviso no topo informando que os pagamentos são simulados. Desligue quando ativar um gateway real.',
    default: true,
  },
  {
    key: 'certificate.validity_years',
    group: 'Certificados',
    type: 'number',
    label: 'Validade informada',
    description: 'Prazo exibido no catálogo. Não expira o certificado automaticamente.',
    default: 1,
    min: 1,
    max: 10,
  },
  {
    key: 'maintenance.active',
    group: 'Manutenção',
    type: 'boolean',
    label: 'Site em manutenção',
    description: 'Exibe um aviso no topo e esconde o catálogo.',
    default: false,
  },
  {
    key: 'maintenance.message',
    group: 'Manutenção',
    type: 'text',
    label: 'Aviso de manutenção',
    description: 'Texto exibido enquanto o modo manutenção estiver ativo.',
    default: '',
  },
  {
    key: 'catalog.page_size',
    group: 'Catálogo',
    type: 'number',
    label: 'Cursos por página',
    description: 'Quantos cursos o catálogo mostra em cada página.',
    default: 12,
    min: 4,
    max: 48,
  },
  {
    key: 'catalog.allow_free',
    group: 'Catálogo',
    type: 'boolean',
    label: 'Permitir cursos gratuitos',
    description: 'Desligado, a matrícula exige pagamento.',
    default: true,
  },
];

const DEF_BY_KEY = new Map(SETTING_DEFS.map((d) => [d.key, d]));

/** Chaves que qualquer visitante pode ler (sem autenticação). */
export const PUBLIC_SETTING_KEYS = [
  'platform.name',
  'platform.tagline',
  'platform.support_email',
  'platform.whatsapp',
  'platform.legal_name',
  'platform.document',
  'platform.demo_mode',
  'certificate.validity_years',
  'maintenance.active',
  'maintenance.message',
];

/**
 * Valida e normaliza o patch de configurações.
 * Uma chave desconhecida é erro de digitação, não algo a ser ignorado em
 * silêncio — por isso o erro lista as chaves válidas.
 */
export function normalizeSettings(patch) {
  const changes = [];
  for (const [key, raw] of Object.entries(patch ?? {})) {
    const def = DEF_BY_KEY.get(key);
    if (!def) {
      throw badRequest(`Configuração desconhecida: ${key}`, [{ key, message: 'chave não suportada' }]);
    }

    let value = raw;
    if (def.type === 'boolean') {
      if (typeof value !== 'boolean') throw badRequest(`"${def.label}" deve ser verdadeiro ou falso.`);
    } else if (def.type === 'number') {
      value = Number(value);
      if (!Number.isFinite(value) || value < (def.min ?? -Infinity) || value > (def.max ?? Infinity)) {
        throw badRequest(`"${def.label}" deve ser um número entre ${def.min} e ${def.max}.`);
      }
    } else {
      value = String(value ?? '').trim();
      if (def.type === 'email' && value && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
        throw badRequest(`"${def.label}" não é um e-mail válido.`);
      }
      if (def.type === 'text' && value.length > 300) {
        throw badRequest(`"${def.label}" é longo demais (máximo 300 caracteres).`);
      }
    }
    changes.push({ key, value, def });
  }
  return changes;
}

/** Valores atuais + defaults, para a tela sempre ter todos os campos. */
export async function getSettings({ publicOnly = false } = {}) {
  const keys = publicOnly ? PUBLIC_SETTING_KEYS : SETTING_DEFS.map((d) => d.key);
  const rows = await queryAll(
    `SELECT key, value, updated_at AS "updatedAt" FROM settings WHERE key = ANY($1)`,
    [keys],
  );
  const stored = new Map(rows.map((r) => [r.key, r]));

  return SETTING_DEFS.filter((d) => keys.includes(d.key)).map((def) => {
    const row = stored.get(def.key);
    return {
      key: def.key,
      group: def.group,
      type: def.type,
      label: def.label,
      description: def.description,
      min: def.min,
      max: def.max,
      // `default` é o fallback; o banco tem a linha, mas se alguém apagar a
      // linha a tela continua funcionando.
      value: row ? row.value : def.default,
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

export const settingsMap = async (opts) => {
  const list = await getSettings(opts);
  return Object.fromEntries(list.map((s) => [s.key, s.value]));
};

/** Grava um patch de configurações e registra na auditoria. */
export async function saveSettings(actor, patch) {
  const changes = normalizeSettings(patch);
  if (!changes.length) throw badRequest('Nenhuma configuração informada.');

  return transaction(async (client) => {
    const before = {};
    const after = {};
    for (const { key, value } of changes) {
      const { rows } = await client.query('SELECT value FROM settings WHERE key = $1', [key]);
      before[key] = rows[0]?.value ?? DEF_BY_KEY.get(key).default;
      after[key] = value;
      await client.query(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [key, JSON.stringify(value), actor.id],
      );
    }

    await recordAudit(client, actor, 'settings.update', { type: 'settings' }, {
      summary: `${changes.length} configuração(ões) alterada(s): ${changes.map((c) => c.key).join(', ')}`,
      before,
      after,
    });

    return { updated: changes.map((c) => c.key) };
  });
}

/** Uma configuração só, com 404 se a chave não existir na definição. */
export async function getSettingValue(key) {
  const def = DEF_BY_KEY.get(key);
  if (!def) throw notFound('Configuração não encontrada.');
  const { rows } = await query('SELECT value FROM settings WHERE key = $1', [key]);
  return { key, value: rows[0]?.value ?? def.default };
}
