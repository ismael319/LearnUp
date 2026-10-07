-- Um pedido pode conter mais de um treinamento. `orders.course_id` continua
-- preenchido com o primeiro item para preservar consultas e históricos legados.
CREATE TABLE IF NOT EXISTS order_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE RESTRICT,
  title       text NOT NULL,
  cover_url   text,
  unit_cents  integer NOT NULL CHECK (unit_cents >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, course_id)
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_course ON order_items (course_id);

-- Todos os pedidos anteriores eram de um único curso: materializamos esse item
-- para que o novo código trate histórico e novos pedidos da mesma forma.
INSERT INTO order_items (order_id, course_id, title, cover_url, unit_cents, created_at)
SELECT o.id, c.id, c.title, c.cover_url, o.amount_cents + o.discount_cents, o.created_at
  FROM orders o
  JOIN courses c ON c.id = o.course_id
ON CONFLICT (order_id, course_id) DO NOTHING;
