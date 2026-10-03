/**
 * Registro de auditoria.
 *
 * Toda ação sensível do administrador passa por aqui. A regra é simples: se
 * alguém perguntar "quem fez isso e quando", a resposta tem que estar no banco,
 * não na memória do operador.
 *
 * Uso canônico (dentro de uma transação, para que o log entre na mesma unidade
 * de trabalho da ação):
 *
 *   return transaction(async (client) => {
 *     ... altera ...
 *     await recordAudit(client, actor, 'order.refund', { type: 'order', id }, { before, after });
 *   });
 */

/**
 * @param {import('pg').PoolClient} client
 * @param {{id: string, name: string, email: string}} actor
 * @param {string} action  nome no formato `entidade.ação` (ex.: `order.refund`)
 * @param {{type: string, id?: string}} entity
 * @param {{summary?: string, before?: object, after?: object}} extra
 */
export async function recordAudit(client, actor, action, entity, extra = {}) {
  await client.query(
    `INSERT INTO audit_logs
       (actor_id, actor_name, actor_email, action, entity_type, entity_id, summary, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      actor?.id ?? null,
      actor?.name ?? null,
      actor?.email ?? null,
      action,
      entity.type,
      entity.id ?? null,
      extra.summary ?? null,
      extra.before ? JSON.stringify(extra.before) : null,
      extra.after ? JSON.stringify(extra.after) : null,
    ],
  );
}

/** Nomes de ação aceitos pelo filtro da tela de auditoria. */
export const AUDIT_ACTIONS = [
  'user.role.change',
  'user.block',
  'user.unblock',
  'user.password.reset',
  'order.refund',
  'order.cancel',
  'order.confirm',
  'course.approve',
  'course.reject',
  'course.publish',
  'course.unpublish',
  'course.archive',
  'course.delete',
  'enrollment.cancel',
  'enrollment.reactivate',
  'certificate.revoke',
  'certificate.restore',
  'category.create',
  'category.update',
  'category.delete',
  'category.uncategorize',
  'badge.create',
  'badge.update',
  'badge.delete',
  'badge.award',
  'badge.revoke',
  'review.hide',
  'review.show',
  'review.delete',
  'post.hide',
  'post.show',
  'post.delete',
  'comment.hide',
  'comment.show',
  'comment.delete',
  'settings.update',
];

/** Rótulos em português para a tela de auditoria. */
export const AUDIT_LABELS = {
  'user.role.change': 'Papel alterado',
  'user.block': 'Usuário bloqueado',
  'user.unblock': 'Usuário desbloqueado',
  'user.password.reset': 'Senha redefinida',
  'order.refund': 'Pedido reembolsado',
  'order.cancel': 'Pedido cancelado',
  'order.confirm': 'Pagamento confirmado',
  'course.approve': 'Curso aprovado',
  'course.reject': 'Curso devolvido ao instrutor',
  'course.publish': 'Curso publicado',
  'course.unpublish': 'Curso despublicado',
  'course.archive': 'Curso arquivado',
  'course.delete': 'Curso excluído',
  'enrollment.cancel': 'Matrícula cancelada',
  'enrollment.reactivate': 'Matrícula reativada',
  'certificate.revoke': 'Certificado revogado',
  'certificate.restore': 'Certificado restaurado',
  'category.create': 'Categoria criada',
  'category.update': 'Categoria editada',
  'category.delete': 'Categoria removida',
  'category.uncategorize': 'Cursos desvinculados',
  'badge.create': 'Badge criado',
  'badge.update': 'Badge editado',
  'badge.delete': 'Badge removido',
  'badge.award': 'Badge concedido',
  'badge.revoke': 'Badge retirado',
  'review.hide': 'Avaliação ocultada',
  'review.show': 'Avaliação exibida',
  'review.delete': 'Avaliação excluída',
  'post.hide': 'Post ocultado',
  'post.show': 'Post exibido',
  'post.delete': 'Post excluído',
  'comment.hide': 'Comentário ocultado',
  'comment.show': 'Comentário exibido',
  'comment.delete': 'Comentário excluído',
  'settings.update': 'Configuração alterada',
};
