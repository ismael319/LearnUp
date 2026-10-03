-- Tempo realmente assistido por aula.
--
-- O progresso passava a ser auditado pelo que o navegador afirmava: bastava
-- enviar `completed: true` para receber os pontos e, fechando o curso, o
-- certificado. A ideia de não confiar no cliente estava certa, mas
-- `position_seconds` acabou a ser lido como prova de que a aula tinha sido
-- vista.
--
-- Aqui o banco passa a guardar quanto tempo foi realmente visionado, e o
-- servidor passa a SOMAR esse tempo a partir de quanto o vídeo avançou a cada
-- atualização, limitado pelo tempo que passou desde a última. Com isso:
--
--   * `completed: true` deixa de ser suficiente para concluir uma aula de
--     vídeo — é preciso ter acumulado 90% da duração;
--   *.seek para o fim não concede tempo assistido, porque o avanço é limitado
--     pelo tempo decorrido;
--   * o progresso continua a ser derivado (GREATEST), então a informação
--     enviada não consegue reescrever o histórico.
--
-- Backfill: aulas já concluídas ficam com `watched_seconds` igual à duração
-- (o aluno assistiu, segundo o sistema até aqui) e as demais com 0 — serão
-- preenchidas naturalmente conforme o aluno assistir. Nenhuma aula concluída
-- é reclassificada, e nenhum aluno perde o que já tinha.
ALTER TABLE lesson_progress
  ADD COLUMN IF NOT EXISTS watched_seconds integer NOT NULL DEFAULT 0
    CHECK (watched_seconds >= 0),
  ADD COLUMN IF NOT EXISTS last_reported_position integer NOT NULL DEFAULT 0
    CHECK (last_reported_position >= 0),
  ADD COLUMN IF NOT EXISTS last_reported_at timestamptz;

UPDATE lesson_progress lp
   SET watched_seconds = l.duration_seconds
  FROM lessons l
 WHERE l.id = lp.lesson_id
   AND lp.completed
   AND lp.watched_seconds = 0
   AND l.duration_seconds > 0;

-- DOWN
-- ALTER TABLE lesson_progress DROP COLUMN IF EXISTS last_reported_at;
-- ALTER TABLE lesson_progress DROP COLUMN IF EXISTS last_reported_position;
-- ALTER TABLE lesson_progress DROP COLUMN IF EXISTS watched_seconds;
