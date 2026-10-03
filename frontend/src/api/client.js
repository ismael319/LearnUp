export const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';

const ACCESS_KEY = 'learnup.access';

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY);
  },
  save({ accessToken }) {
    if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY);
  },
};

export class ApiError extends Error {
  constructor(status, payload) {
    super(payload?.error?.message ?? `Erro ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload?.error?.code;
    this.details = payload?.error?.details;
  }
}

/** Erro de rede: o hook de dados pode tentar novamente. */
export class NetworkError extends Error {
  constructor(message = 'Não foi possível conectar ao servidor.') {
    super(message);
    this.name = 'NetworkError';
    this.retryable = true;
  }
}

const sessionListeners = new Set();

/** A UI reage aqui quando não há mais como renovar a sessão. */
export const onSessionExpired = (fn) => {
  sessionListeners.add(fn);
  return () => sessionListeners.delete(fn);
};

const notifyExpired = () => sessionListeners.forEach((fn) => fn());

let refreshPromise = null;

/**
 * Renova o access token. Deduplica chamadas concorrentes: várias requisições
 * que tomam 401 ao mesmo tempo aguardam a mesma renovação.
 */
export function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    });

    if (!res.ok) {
      tokens.clear();
      notifyExpired();
      throw new ApiError(401, { error: { code: 'session_expired' } });
    }

    const data = await res.json();
    tokens.save(data);
    return data.accessToken;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

function buildUrl(path, params) {
  if (!params) return `${BASE}${path}`;

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => search.append(key, v));
    else search.append(key, value);
  }

  const qs = search.toString();
  return qs ? `${BASE}${path}?${qs}` : `${BASE}${path}`;
}

/** Uma ida e volta ao servidor, sem tratamento de erro. */
async function once(method, path, { body, params, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(buildUrl(path, params), {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {}),
        ...headers,
      },
      credentials: 'include',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new NetworkError();
  }

  if (res.status === 204) return { status: 204, data: null };

  const contentType = res.headers.get('content-type') ?? '';
  const data = contentType.includes('application/json') ? await res.json().catch(() => null) : await res.text();

  return { status: res.status, data };
}

/**
 * Requisição com renovação automática de sessão.
 * Em 401, tenta renovar uma vez com o cookie httpOnly e repete a chamada.
 */
export async function request(method, path, options = {}) {
  const attempt = await once(method, path, options);

  if (attempt.status === 401 && options.auth !== false) {
    try {
      await refreshAccessToken();
      const retried = await once(method, path, options);
      if (retried.status < 400) return retried.data;
      throw new ApiError(retried.status, retried.data);
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(401, { error: { code: 'session_expired' } });
    }
  }

  if (attempt.status >= 400) throw new ApiError(attempt.status, attempt.data);
  return attempt.data;
}

export const get = (path, params) => request('GET', path, { params });
export const post = (path, body) => request('POST', path, { body });
export const patch = (path, body) => request('PATCH', path, { body });
export const put = (path, body) => request('PUT', path, { body });
export const del = (path, body) => request('DELETE', path, { body });

// --- API agrupada por domínio --------------------------------------------
// Nomes de métodos e caminhos espelham backend/src/modules/*/controller.js.

export const authApi = {
  me: () => get('/auth/me'),
  login: (body) => post('/auth/login', body),
  register: (body) => post('/auth/register', body),
  logout: () => post('/auth/logout'),
  updateProfile: (body) => patch('/auth/me', body),
  changePassword: (body) => post('/auth/change-password', body),
  // Login/cadastro não devem anexar o token da sessão anterior.
  loginRaw: (body) => once('POST', '/auth/login', { body, auth: false }),
  registerRaw: (body) => once('POST', '/auth/register', { body, auth: false }),
};

export const coursesApi = {
  /** sort: relevance | newest | rating | popular | price_asc | price_desc */
  list: (params) => get('/courses', params),
  categories: () => get('/courses/categories'),
  instructors: () => get('/courses/instructors'),
  /** Aceita id ou slug. Retorna o curso com `modules` e `previewLessons`. */
  detail: (idOrSlug) => get(`/courses/${encodeURIComponent(idOrSlug)}`),
  reviews: (idOrSlug) => get(`/courses/${encodeURIComponent(idOrSlug)}/reviews`),
  addReview: (idOrSlug, body) => post(`/courses/${encodeURIComponent(idOrSlug)}/reviews`, body),
  related: (id) => get(`/courses/${id}/related`),
  // --- Gestão de cursos (instrutor e admin) ---
  /** Cursos sob gestão: os do instrutor; todos, se for admin. Inclui rascunhos. */
  managed: () => get('/courses/mine'),
  /** Curso completo para edição, com todas as aulas. */
  forEditing: (idOrSlug) => get(`/courses/${encodeURIComponent(idOrSlug)}/manage`),
  create: (body) => post('/courses', body),
  update: (idOrSlug, body) => patch(`/courses/${encodeURIComponent(idOrSlug)}`, body),
  saveCurriculum: (idOrSlug, modules) => put(`/courses/${encodeURIComponent(idOrSlug)}/curriculum`, { modules }),
};

export const adminApi = {
  overview: () => get('/admin/overview'),

  // --- Usuários ---
  /** search, role, status (active|blocked), orderBy (recent|name|enrollments) */
  users: (params) => get('/admin/users', params),
  user: (userId) => get(`/admin/users/${userId}`),
  changeRole: (userId, role) => patch(`/admin/users/${userId}/role`, { role }),
  blockUser: (userId, reason) => post(`/admin/users/${userId}/block`, { reason }),
  unblockUser: (userId) => post(`/admin/users/${userId}/unblock`),
  resetPassword: (userId, password) => post(`/admin/users/${userId}/reset-password`, { password }),

  // --- Pedidos ---
  /** status, method, courseId, userId, from, to (AAAA-MM-DD), search */
  orders: (params) => get('/admin/orders', params),
  order: (orderId) => get(`/admin/orders/${orderId}`),
  /** Cancelamento do gateway: estorna e cancela a matrícula. */
  refundOrder: (orderId, reason) => post(`/admin/orders/${orderId}/refund`, { reason }),
  /** Cancela sem devolver dinheiro. */
  cancelOrder: (orderId, reason) => post(`/admin/orders/${orderId}/cancel`, { reason }),
  /** Confirma à mão um pagamento que não chegou pelo webhook. */
  confirmOrder: (orderId) => post(`/admin/orders/${orderId}/confirm`),

  // --- Cursos ---
  /** status, search, categoryId, instructorId, orderBy (recent|title|students|revenue|status) */
  courses: (params) => get('/admin/courses', params),
  course: (courseId) => get(`/admin/courses/${courseId}`),
  /** action: approve | reject | publish | unpublish | archive | restore */
  transitionCourse: (courseId, action, reason) => post(`/admin/courses/${courseId}/${action}`, { reason }),
  deleteCourse: (courseId, reason) => del(`/admin/courses/${courseId}`, reason ? { reason } : undefined),

  // --- Matrículas e certificados ---
  /** status, courseId, userId, courseStatus, search, orderBy (recent|progress|course) */
  enrollments: (params) => get('/admin/enrollments', params),
  cancelEnrollment: (enrollmentId, reason) => post(`/admin/enrollments/${enrollmentId}/cancel`, { reason }),
  reactivateEnrollment: (enrollmentId) => post(`/admin/enrollments/${enrollmentId}/reactivate`),
  /** revoked: boolean|undefined (ausente = todos) */
  certificates: (params) => get('/admin/certificates', params),
  /** revoked: boolean|undefined (ausente = revogar) */
  certificate: (certificateId, body) => patch(`/admin/certificates/${certificateId}`, body),

  // --- Categorias e badges ---
  categories: () => get('/admin/categories'),
  createCategory: (body) => post('/admin/categories', body),
  updateCategory: (categoryId, body) => patch(`/admin/categories/${categoryId}`, body),
  deleteCategory: (categoryId) => del(`/admin/categories/${categoryId}`),
  uncategorize: (categoryId) => post(`/admin/categories/${categoryId}/uncategorize`),

  badges: () => get('/admin/badges'),
  createBadge: (body) => post('/admin/badges', body),
  updateBadge: (badgeId, body) => patch(`/admin/badges/${badgeId}`, body),
  deleteBadge: (badgeId) => del(`/admin/badges/${badgeId}`),
  awardBadge: (badgeId, userId, reason) => post(`/admin/badges/${badgeId}/award`, { userId, reason }),
  revokeBadge: (badgeId, userId) => post(`/admin/badges/${badgeId}/revoke`, { userId }),

  // --- Moderação ---
  /** visibility: visible | hidden | all */
  reviews: (params) => get('/admin/reviews', params),
  setReviewVisibility: (reviewId, hidden, reason) => post(`/admin/reviews/${reviewId}/visibility`, { hidden, reason }),
  deleteReview: (reviewId) => del(`/admin/reviews/${reviewId}`),
  posts: (params) => get('/admin/posts', params),
  setPostVisibility: (postId, hidden, reason) => post(`/admin/posts/${postId}/visibility`, { hidden, reason }),
  deletePost: (postId) => del(`/admin/posts/${postId}`),
  comments: (params) => get('/admin/comments', params),
  setCommentVisibility: (commentId, hidden, reason) => post(`/admin/comments/${commentId}/visibility`, { hidden, reason }),
  deleteComment: (commentId) => del(`/admin/comments/${commentId}`),

  // --- Relatórios ---
  reports: {
    summary: () => get('/admin/reports/summary'),
    revenue: (params) => get('/admin/reports/revenue', params),
    topCourses: () => get('/admin/reports/top-courses'),
    topInstructors: () => get('/admin/reports/top-instructors'),
    completion: () => get('/admin/reports/completion'),
    activity: (params) => get('/admin/reports/activity', params),
    courseFunnel: (courseId) => get(`/admin/reports/course/${courseId}/funnel`),
  },

  // --- Configurações e auditoria ---
  settings: () => get('/admin/settings'),
  saveSettings: (body) => patch('/admin/settings', body),
    /** search, action, entityType, actorId, page, limit */
    auditLogs: (params) => get('/admin/audit-logs', params),
};

/** Subconjunto público: nome, assinatura e aviso de manutenção, sem login. */
export const platformApi = {
  // `request` direto (e não `get`) porque só ele aceita `auth: false`: o
  // chamador pode estar com a sessão expirada e ainda assim precisar do nome da
  // plataforma para montar a tela de manutenção.
  settings: () => request('GET', '/platform/settings', { auth: false }),
};

export const learningApi = {
  /** status: all | in_progress | completed */
  list: (status) => get('/enrollments', status ? { status } : undefined),
  enrollFree: (courseId) => post('/enrollments', { courseId }),
  /** Alimenta o player: { course, enrollment, modules, totalLessons, completedLessons } */
  outline: (courseId) => get(`/enrollments/${courseId}/outline`),
  progress: (courseId) => get(`/enrollments/${courseId}/progress`),
  saveProgress: (courseId, lessonId, body) => put(`/enrollments/${courseId}/lessons/${lessonId}`, body),
};

export const quizApi = {
  /** O quiz é.addressado pela aula (lessonId), não pelo quiz. */
  forLesson: (lessonId) => get(`/quizzes/lessons/${lessonId}`),
  submit: (lessonId, answers) => post(`/quizzes/lessons/${lessonId}/attempts`, { answers }),
};

export const certificatesApi = {
  list: () => get('/certificates'),
  issue: (courseId) => post('/certificates', { courseId }),
  byCode: (code) => get(`/certificates/${encodeURIComponent(code)}`),
  /** Endpoint público: não exige login. */
  verify: (code) => get(`/certificates/verify/${encodeURIComponent(code)}`),
  downloadUrl: (code) => `${BASE}/certificates/${encodeURIComponent(code)}/download`,
};

export const paymentsApi = {
  methods: () => get('/payments/methods'),
  /** method: pix | card | paypal */
  createOrder: (body) => post('/payments/orders', body),
  orders: () => get('/payments/orders'),
  order: (id) => get(`/payments/orders/${id}`),
  /** Só funciona com PAYMENT_PROVIDER=mock (substitui o webhook no dev). */
  confirmMock: (orderId) => post(`/payments/mock/${orderId}/confirm`),
};

export const forumApi = {
  /** sort: recent | top | unanswered */
  list: (params) => get('/forum/posts', params),
  detail: (id) => get(`/forum/posts/${id}`),
  create: (body) => post('/forum/posts', body),
  remove: (id) => del(`/forum/posts/${id}`),
  comment: (postId, body) => post(`/forum/posts/${postId}/comments`, body),
};

export const gamificationApi = {
  me: () => get('/gamification/me'),
  leaderboard: (limit = 20) => get('/gamification/leaderboard', { limit }),
  badges: () => get('/gamification/badges'),
  myPosition: () => get('/gamification/me/leaderboard-position'),
};
