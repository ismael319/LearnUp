-- Fluxo de aprovação de cursos: o instrutor envia para revisão e o admin
-- publica. Sem este valor, "in_review" não teria onde ser gravado.
ALTER TYPE course_status ADD VALUE IF NOT EXISTS 'in_review';

-- DOWN
-- Não é possível remover um valor de enum em uso. Para desfazer, recrie o
-- tipo (veja o bloco do arquivo 006_admin_governance.sql, que recria o enum
-- ao remover a feature).
