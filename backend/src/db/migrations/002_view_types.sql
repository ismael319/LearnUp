-- =====================================================================
-- 002 - tipos de retorno numéricos
-- count() retorna bigint e o node-postgres o serializa como string.
-- Convertemos para int/float8 no limite do banco para a API devolver JSON
-- numérico de verdade.
-- =====================================================================

DROP VIEW IF EXISTS course_progress;
CREATE VIEW course_progress AS
SELECT
  e.id                AS enrollment_id,
  e.user_id,
  e.course_id,
  count(l.id)::int                                        AS total_lessons,
  count(lp.id) FILTER (WHERE lp.completed)::int           AS completed_lessons,
  CASE
    WHEN count(l.id) = 0 THEN 0
    ELSE round(100.0 * count(lp.id) FILTER (WHERE lp.completed) / count(l.id))::int
  END                                                     AS progress_percent,
  e.completed_at,
  e.last_accessed_at
FROM enrollments e
JOIN modules m ON m.course_id = e.course_id
JOIN lessons l ON l.module_id = m.id
LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.enrollment_id = e.id
GROUP BY e.id;

-- DOWN
-- (restaure a definição com casts ::int removidos manualmente se precisar)
