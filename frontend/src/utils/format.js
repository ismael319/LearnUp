/** Formatação compartilhada entre as páginas. */

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos -> "R$ 199,00" */
export const formatPrice = (cents) => (cents > 0 ? brl.format(cents / 100) : 'Gratuito');

/**
 * Centavos -> "R$ 199,00" sempre, inclusive zero.
 *
 * `formatPrice` diz "Gratuito" no zero porque isso é o que um aluno quer ver
 * numa vitrine de curso. Num total de receita, porém, "Gratuito" é mentira: são
 * R$ 0,00 de faturamento. Por isso os dois convivem.
 */
export const formatCurrency = (cents) => brl.format((Number(cents) || 0) / 100);

/** Centavos -> 199 (sem símbolo) */
export const priceNumber = (cents) => brl.format(cents / 100).replace(/\s?R\$.*/, '');

/**
 * Texto digitado no formulário -> centavos. Aceita "199", "199,90", "1.299,00"
 * e ignora qualquer caractere que não seja dígito, vírgula ou ponto.
 *
 * Em pt-BR a vírgula é o separador decimal e o ponto é o de milhar, então a
 * vírgula decide como ler o resto: se existe, o que vem antes dela é a parte
 * inteira; se não existe, o ponto é milhar e o número é inteiro.
 *
 * @returns {number|null} null quando não há valor válido, para o campo ficar vazio.
 */
export function parsePriceToCents(text) {
  const raw = String(text ?? '').replace(/[^\d,.]/g, '');
  if (!raw) return null;

  const hasComma = raw.includes(',');
  const [wholeRaw, fractionRaw] = hasComma
    ? [raw.slice(0, raw.indexOf(',')), raw.slice(raw.indexOf(',') + 1)]
    : [raw, ''];

  const whole = wholeRaw.replace(/\D/g, '') || '0';
  const fraction = fractionRaw.replace(/\D/g, '').padEnd(2, '0').slice(0, 2);
  const cents = Number(`${whole}${fraction}`);
  return Number.isFinite(cents) && cents > 0 ? cents : null;
}

export const formatNumber = (n) => new Intl.NumberFormat('pt-BR').format(n ?? 0);

export const formatRating = (avg) => Number(avg ?? 0).toFixed(1).replace('.', ',');

/** Minutos -> "3h 25min" */
export const formatDuration = (minutes) => {
  const total = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}min`;
  return h ? `${h}h` : `${m}min`;
};

/** Segundos -> "12:34" (ou "1:02:03" quando passa de 1h) */
export const formatTime = (seconds) => {
  const total = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

export const formatDateTime = (iso) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "há 3 dias" */
export const timeAgo = (iso) => {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  const steps = [
    [60, 'segundo', 1],
    [3600, 'minuto', 60],
    [86400, 'hora', 3600],
    [604800, 'dia', 86400],
    [2592000, 'semana', 604800],
    [31536000, 'mês', 2592000],
  ];

  let label = 'mês';
  let divisor = 31536000;
  for (const [limit, name, div] of steps) {
    if (seconds < limit) continue;
    label = name;
    divisor = div;
  }

  const amount = Math.floor(seconds / divisor);
  return amount <= 1 ? `há 1 ${label.replace(/s$/, '')}` : `há ${amount} ${label}`;
};

export const LEVEL_LABEL = {
  beginner: 'Iniciante',
  intermediate: 'Intermediário',
  advanced: 'Avançado',
};

export const LESSON_TYPE = {
  video: { label: 'Vídeo', icon: 'play' },
  text: { label: 'Leitura', icon: 'file' },
  quiz: { label: 'Quiz', icon: 'chart' },
};

/** A API devolve emoji no campo `icon` de badges e categorias. Aqui
 *  traduzimos para o set SVG, chaveando por `key`/`slug` em vez do caractere
 *  — assim o mapeamento continua válido se o emoji do seed mudar. */
export const BADGE_ICON = {
  'primeiro-curso': 'cap',
  'primeiro-quiz': 'check',
  'primeira-conclusao': 'certificate',
  'tres-cursos': 'book',
  'dez-cursos': 'award',
  'dez-quizzes': 'chart',
  'mil-pontos': 'sparkle',
  'semana-folgada': 'spark',
  tutor: 'users',
  certificado: 'certificate',
};

export const CATEGORY_ICON = {
  nr: 'shield',
};

export const badgeIcon = (badge) => BADGE_ICON[badge?.key] ?? 'award';
export const categoryIcon = (category) => CATEGORY_ICON[category?.slug] ?? 'book';

export const initials = (name = '') =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';

export const discountPercent = (price, original) =>
  original > price ? Math.round(((original - price) / original) * 100) : 0;
