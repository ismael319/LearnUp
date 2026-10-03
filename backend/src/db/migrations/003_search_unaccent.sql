-- =====================================================================
-- 003 - busca full-text com unaccent
--
-- O dicionário português do PostgreSQL remove o acento do lado da query
-- ("gestao" -> 'gesta') mas mantém no documento ("Gestão" -> 'gestã'),
-- então a busca nunca encontrava nada com acento. Aplicar `unaccent`
-- antes do dicionário normaliza os dois lados.
--
-- `unaccent()` é STABLE e não pode entrar em índice; o wrapper IMMUTABLE
-- `unaccent_immutable` resolve (criado em 001).
-- (A forma to_tsvector(regconfig, regdictionary, text) só existe no PG17+;
--  no PG16 usamos o wrapper.)
-- =====================================================================

DROP INDEX IF EXISTS idx_courses_search;

CREATE INDEX idx_courses_search ON courses
  USING gin (to_tsvector('portuguese',
    unaccent_immutable(coalesce(title,'') || ' ' || coalesce(subtitle,'') || ' ' || coalesce(description,''))));

-- DOWN
-- DROP INDEX IF EXISTS idx_courses_search;
-- CREATE INDEX idx_courses_search ON courses
--   USING gin (to_tsvector('portuguese',
--     coalesce(title,'') || ' ' || coalesce(subtitle,'') || ' ' || coalesce(description,'')));
