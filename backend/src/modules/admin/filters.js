/**
 * Montagem de cláusulas WHERE para as listagens do painel.
 *
 * Sem isto, cada listagem repete a mesma dance: um array de valores, um array de
 * cláusulas e um `replace('?', ...)` para numerar os placeholders. O risco real
 * é errar a numeração quando um filtro é opcional, e o sintoma aparece como
 * "search por nome filtra por senha".
 *
 *   const f = where();
 *   if (search) f.add('unaccent_immutable(u.name) ILIKE ?', `%${search}%`);
 *   if (role)   f.add('u.role = ?', role);
 *   await queryAll(`SELECT ... FROM users u ${f.sql} ORDER BY ... ${f.limit(10, f.offset(0))}`, f.params);
 */
export function where() {
  const values = [];
  const clauses = [];

  return {
    /**
     * Adiciona uma cláusula. Com valor, usa `?` como placeholder; sem valor,
     * a cláusula entra como está.
     *
     * Dois cuidados, ambos erros que só aparecem em produção:
     *
     * 1. Sem valor (`add('col IS NULL')`), nada é empilhado — empilhar
     *    `undefined` faz o PostgreSQL responder "bind message supplies 1
     *    parameters, but prepared statement requires 0".
     * 2. Uma cláusula pode ter MAIS DE UM `?`. É o caso de toda busca por
     *    várias colunas, onde o mesmo termo é comparado com cada uma delas.
     *    Num lugar só e o `?` restante vira SQL inválido. Aqui cada `?` recebe
     *    um parâmetro próprio e a numeração anda da esquerda para a direita.
     */
    add(sql, value) {
      if (value === undefined) {
        clauses.push(sql);
        return this;
      }
      const count = sql.split('?').length - 1;
      for (let i = 0; i < count; i += 1) values.push(value);
      const first = values.length - count + 1;
      let next = first;
      clauses.push(sql.replace(/\?/g, () => `$${next++}`));
      return this;
    },

    /** Adiciona `sql` sem placeholder, ou `false` se `condition` for falso. */
    when(condition, sql) {
      if (condition) clauses.push(sql);
      return this;
    },

    get sql() {
      return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    },

    get params() {
      return values;
    },

    /** Placeholder do próximo valor depois dos filtros. */
    next() {
      return `$${values.length + 1}`;
    },

    /** `LIMIT ? OFFSET ?` já numerado, continuando a contagem. */
    limitOffset(limit, offset) {
      const a = this.next();
      const b = `$${values.length + 2}`;
      return { sql: `LIMIT ${a} OFFSET ${b}`, params: [...values, limit, offset] };
    },
  };
}

/** Busca sem acento, reaproveitando a função criada na migration 003. */
export const unaccentedMatch = (columns, placeholder) =>
  columns
    .map((column) => `unaccent_immutable(${column}) ILIKE '%' || unaccent_immutable(${placeholder}) || '%'`)
    .join(' OR ');
