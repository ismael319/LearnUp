-- Governança da plataforma: tudo que o administrador precisa para operar o
-- site e para deixar rastro do que fez.

-- 1. Registro de auditoria ------------------------------------------------
-- Toda ação destrutiva ou sensível do admin grava uma linha aqui. `before` e
-- `after` guardam o JSON para permitir desfazer/auditar sem adivinhar.
-- `actor_name` é desnormalizado de propósito: o log precisa sobreviver à
-- exclusão do usuário que fez a ação.
CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_name  text,
  actor_email text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  summary     text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action);

-- 2. Bloqueio de usuários -------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS blocked_reason text;

-- 3. Status da matrícula --------------------------------------------------
-- Cancelar NÃO pode ser DELETE: `lesson_progress` e `quiz_attempts` pendem da
-- matrícula com ON DELETE CASCADE, e apagar a linha destruiria o histórico do
-- aluno sem nenhum rastro.
DO $$ BEGIN
  CREATE TYPE enrollment_status AS ENUM ('active', 'canceled', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS status enrollment_status NOT NULL DEFAULT 'active';
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS canceled_at timestamptz;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS canceled_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS cancel_reason text;

-- 4. Aprovação de curso ----------------------------------------------------
ALTER TABLE courses ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- 5. Moderação reversível --------------------------------------------------
-- Ocultar preserva o registro (e o log de auditoria); apagar não deixa pista.
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS hidden_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- 6. Configurações da plataforma ------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO settings (key, value) VALUES
  ('platform.name',          '"LearnUp"'::jsonb),
  ('platform.tagline',       '"Cursos de segurança do trabalho"'::jsonb),
  ('platform.support_email', '"suporte@learnup.dev"'::jsonb),
  ('maintenance.active',     'false'::jsonb),
  ('maintenance.message',    '""'::jsonb),
  ('catalog.page_size',      '12'::jsonb),
  ('catalog.allow_free',     'true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- DOWN
-- DROP TABLE IF EXISTS settings;
-- DROP TABLE IF EXISTS audit_logs;
-- ALTER TABLE posts DROP COLUMN IF EXISTS hidden_by;
-- ALTER TABLE posts DROP COLUMN IF EXISTS hidden_at;
-- ALTER TABLE reviews DROP COLUMN IF EXISTS hidden_by;
-- ALTER TABLE reviews DROP COLUMN IF EXISTS hidden_at;
-- ALTER TABLE courses DROP COLUMN IF EXISTS approved_by;
-- ALTER TABLE courses DROP COLUMN IF EXISTS approved_at;
-- ALTER TABLE enrollments DROP COLUMN IF EXISTS cancel_reason;
-- ALTER TABLE enrollments DROP COLUMN IF EXISTS canceled_by;
-- ALTER TABLE enrollments DROP COLUMN IF EXISTS canceled_at;
-- ALTER TABLE enrollments DROP COLUMN IF EXISTS status;
-- DROP TYPE IF EXISTS enrollment_status;
-- ALTER TABLE users DROP COLUMN IF EXISTS blocked_reason;
-- ALTER TABLE users DROP COLUMN IF EXISTS blocked_at;
