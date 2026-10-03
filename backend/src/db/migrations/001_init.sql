-- =====================================================================
-- LearnUp - schema inicial (PostgreSQL 14+)
-- Idempotente o suficiente para rodar em banco limpo.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('student', 'instructor', 'admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE course_level AS ENUM ('beginner', 'intermediate', 'advanced');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE course_status AS ENUM ('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lesson_type AS ENUM ('video', 'text', 'quiz');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM ('pending', 'paid', 'failed', 'refunded', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('pix', 'card', 'paypal', 'free');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------

-- `unaccent()` é marcada STABLE (depende do dicionário de busca), então não
-- pode aparecer em expressão de índice. Este wrapper IMMUTABLE é o padrão
-- para busca full-text com acentos e é o que o índice e as queries usam.
CREATE OR REPLACE FUNCTION unaccent_immutable(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, input);
$$;

-- Slug amigável a partir de um texto qualquer.
CREATE OR REPLACE FUNCTION slugify(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(both '-' FROM regexp_replace(
    unaccent(lower(coalesce(input, ''))),
    '[^a-z0-9]+', '-', 'g'
  ));
$$;

-- Triggers de updated_at ------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------
-- Usuários
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (length(trim(name)) >= 2),
  email          citext NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  role           user_role NOT NULL DEFAULT 'student',
  avatar_url     text,
  bio            text,
  points         integer NOT NULL DEFAULT 0 CHECK (points >= 0),
  streak_days    integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_points ON users (points DESC);

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Refresh tokens (rotação a cada uso)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  user_agent  text,
  ip_address  text,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens (user_id, expires_at DESC);

-- ---------------------------------------------------------------------
-- Cursos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  slug       text NOT NULL UNIQUE,
  icon       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS courses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id        uuid REFERENCES categories(id) ON DELETE SET NULL,
  title              text NOT NULL CHECK (length(trim(title)) >= 3),
  slug               text NOT NULL UNIQUE,
  subtitle           text,
  description        text,
  cover_url          text,
  level              course_level NOT NULL DEFAULT 'beginner',
  status             course_status NOT NULL DEFAULT 'draft',
  price_cents        integer NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  original_price_cents integer CHECK (original_price_cents IS NULL OR original_price_cents >= price_cents),
  duration_minutes   integer NOT NULL DEFAULT 0 CHECK (duration_minutes >= 0),
  rating_avg         numeric(3,2) NOT NULL DEFAULT 0,
  rating_count       integer NOT NULL DEFAULT 0,
  students_count     integer NOT NULL DEFAULT 0,
  certificate_enabled boolean NOT NULL DEFAULT true,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_courses_status_price ON courses (status, price_cents);
CREATE INDEX IF NOT EXISTS idx_courses_category ON courses (category_id);
-- Full-text: `unaccent_immutable` é aplicado ANTES do dicionário para que a
-- busca por "gestao" encontre "Gestão" (o dicionário sozinho mantém o acento
-- no documento e o remove na query, então nunca casariam).
CREATE INDEX IF NOT EXISTS idx_courses_search ON courses
  USING gin (to_tsvector('portuguese',
    unaccent_immutable(coalesce(title,'') || ' ' || coalesce(subtitle,'') || ' ' || coalesce(description,''))));

CREATE TRIGGER trg_courses_updated_at BEFORE UPDATE ON courses
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS modules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  position    integer NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, position)
);

CREATE TABLE IF NOT EXISTS lessons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id       uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  title           text NOT NULL,
  description     text,
  type            lesson_type NOT NULL DEFAULT 'video',
  position        integer NOT NULL,
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  video_url       text,
  content         text,
  is_preview      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, position)
);

CREATE INDEX IF NOT EXISTS idx_lessons_module ON lessons (module_id, position);

CREATE TRIGGER trg_lessons_updated_at BEFORE UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Avaliações de alunos
CREATE TABLE IF NOT EXISTS reviews (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id  uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);

-- ---------------------------------------------------------------------
-- Pedidos e pagamentos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id      uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  amount_cents   integer NOT NULL CHECK (amount_cents >= 0),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  currency       char(3) NOT NULL DEFAULT 'BRL',
  method         payment_method NOT NULL,
  status         order_status NOT NULL DEFAULT 'pending',
  provider       text,
  provider_ref   text,
  checkout_url   text,
  pix_qr_code    text,
  pix_copy_code  text,
  paid_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_provider_ref
  ON orders (provider, provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS payment_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid REFERENCES orders(id) ON DELETE SET NULL,
  provider    text NOT NULL,
  event_type  text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events (order_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Matrículas e progresso
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id       uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  order_id        uuid REFERENCES orders(id) ON DELETE SET NULL,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  last_accessed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_user ON enrollments (user_id, last_accessed_at DESC);

CREATE TABLE IF NOT EXISTS lesson_progress (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id    uuid NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  lesson_id        uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  position_seconds integer NOT NULL DEFAULT 0 CHECK (position_seconds >= 0),
  completed        boolean NOT NULL DEFAULT false,
  completed_at     timestamptz,
  last_watched_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (enrollment_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_enrollment ON lesson_progress (enrollment_id);

-- ---------------------------------------------------------------------
-- Quizzes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quizzes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id     uuid NOT NULL UNIQUE REFERENCES lessons(id) ON DELETE CASCADE,
  title         text NOT NULL DEFAULT 'Quiz da aula',
  pass_percent  smallint NOT NULL DEFAULT 70 CHECK (pass_percent BETWEEN 0 AND 100),
  max_attempts  smallint NOT NULL DEFAULT 0,  -- 0 = ilimitado
  points_reward integer NOT NULL DEFAULT 25 CHECK (points_reward >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id     uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  prompt      text NOT NULL,
  explanation text,
  position    integer NOT NULL,
  UNIQUE (quiz_id, position)
);

CREATE TABLE IF NOT EXISTS quiz_options (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
  label       text NOT NULL,
  is_correct  boolean NOT NULL DEFAULT false,
  position    integer NOT NULL,
  UNIQUE (question_id, position)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        uuid NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score_percent  smallint NOT NULL CHECK (score_percent BETWEEN 0 AND 100),
  passed         boolean NOT NULL,
  answers        jsonb NOT NULL DEFAULT '[]'::jsonb,
  points_awarded integer NOT NULL DEFAULT 0,
  completed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user ON quiz_attempts (user_id, quiz_id, completed_at DESC);

-- ---------------------------------------------------------------------
-- Certificados
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS certificates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id     uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  code          text NOT NULL UNIQUE,
  final_score   smallint,
  issued_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  UNIQUE (user_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_certificates_code ON certificates (code);

-- ---------------------------------------------------------------------
-- Fórum / comunidade
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS posts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id    uuid REFERENCES courses(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (length(trim(title)) >= 3),
  content      text NOT NULL CHECK (length(trim(content)) >= 2),
  is_pinned    boolean NOT NULL DEFAULT false,
  is_locked    boolean NOT NULL DEFAULT false,
  views_count  integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_posts_course ON posts (course_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts (created_at DESC);

CREATE TRIGGER trg_posts_updated_at BEFORE UPDATE ON posts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- threaded com 2 níveis (comentário raiz -> respostas).
-- A profundidade é validada em src/modules/forum/service.js.
CREATE TABLE IF NOT EXISTS comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES comments(id) ON DELETE CASCADE,
  content    text NOT NULL CHECK (length(trim(content)) >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT comments_not_self_parent CHECK (parent_id IS DISTINCT FROM id)
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments (post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments (parent_id);

-- ---------------------------------------------------------------------
-- Gamificação
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS badges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text NOT NULL,
  icon        text NOT NULL DEFAULT '🏅',
  points      integer NOT NULL DEFAULT 0,
  criteria    text NOT NULL  -- chave lógica avaliada pelo serviço
);

-- Histórico.append-only de pontos: fonte da verdade para o saldo.
CREATE TABLE IF NOT EXISTS point_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points      integer NOT NULL,
  reason      text NOT NULL,
  ref_type    text,
  ref_id      uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_point_ledger_user ON point_ledger (user_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_point_ledger_idempotency
  ON point_ledger (user_id, reason, ref_type, ref_id)
  WHERE ref_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_badges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id   uuid NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON user_badges (user_id, awarded_at DESC);

-- ---------------------------------------------------------------------
-- Views de apoio
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW course_progress AS
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
