/**
 * Download autenticado: um link comum não envia o header Authorization,
 * então usamos fetch + blob + object URL.
 */
import { BASE, tokens, ApiError, refreshAccessToken } from './client.js';

const saveBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const slugify = (text) =>
  (text ?? 'certificado')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

export async function downloadCertificate(code, courseTitle) {
  const url = `${BASE}/certificates/${encodeURIComponent(code)}/download`;
  const fetchCertificate = () => fetch(url, {
    headers: { Authorization: `Bearer ${tokens.access ?? ''}` },
    credentials: 'include',
  });
  let response = await fetchCertificate();

  if (response.status === 401) {
    await refreshAccessToken();
    response = await fetchCertificate();
  }

  if (!response.ok) {
    let message = 'Não foi possível gerar o PDF.';
    try {
      const body = await response.json();
      message = body.message ?? body.error ?? message;
    } catch {
      // resposta não-JSON: mantém mensagem padrão
    }
    throw new ApiError(response.status, { error: { message } });
  }

  saveBlob(await response.blob(), `certificado-${slugify(courseTitle)}.pdf`);
}
