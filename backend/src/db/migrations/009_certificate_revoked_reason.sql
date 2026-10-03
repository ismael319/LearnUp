-- Motivo da revogação de certificado.
--
-- `certificates.revoked_at` já existia, mas não dizia POR QUE o certificado
-- foi revogado. O admin informa um motivo ao revogar e ao cancelar uma
-- matrícula por reembolso, e sem esta coluna essa informação só vivia na
-- auditoria — impossível de mostrar na ficha do aluno ou de responder "por que
-- perdi meu certificado?".
--
-- Coluna aditiva e nullable: certificados já emitidos continuam válidos e os
-- revogados antes desta migration simplesmente não têm motivo registrado.
ALTER TABLE certificates
  ADD COLUMN IF NOT EXISTS revoked_reason text;
