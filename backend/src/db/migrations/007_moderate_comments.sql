-- Moderação de comentários: a migration 006 criou `hidden_at` em avaliações e
-- posts, mas o fórum tem um terceiro nível (comentários) e Moderar apenas post
-- deixaria o comentário problemático visível.

ALTER TABLE comments ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS hidden_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- DOWN
-- ALTER TABLE comments DROP COLUMN IF EXISTS hidden_by;
-- ALTER TABLE comments DROP COLUMN IF EXISTS hidden_at;
