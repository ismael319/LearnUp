-- Motivo da moderação.
--
-- `hidden_at` diz QUANDO, `hidden_by` diz QUEM. Falta o PORQUÊ, que é a única
-- informação que permite responder a uma reclamação ("por que minha avaliação
-- sumiu?") e detectar quem está moderando de mais.

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_reason text;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS hidden_reason text;

-- DOWN
-- ALTER TABLE comments DROP COLUMN IF EXISTS hidden_reason;
-- ALTER TABLE posts DROP COLUMN IF EXISTS hidden_reason;
-- ALTER TABLE reviews DROP COLUMN IF EXISTS hidden_reason;
