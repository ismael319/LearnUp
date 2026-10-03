import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/helpers.js';
import { validate } from '../../middleware/validate.js';
import { authenticate, optionalAuth } from '../../middleware/auth.js';
import { notFound } from '../../utils/errors.js';
import {
  listCertificates,
  getCertificateOrThrow,
  verifyCertificate,
  renderCertificatePdf,
  issueCertificate,
} from '../../services/certificates.js';

const codeParam = z.object({ code: z.string().trim().min(8).max(60) });

const router = Router();

/** Verificação pública (para recrutadores / landing page). */
router.get(
  '/verify/:code',
  validate({ params: codeParam }),
  asyncHandler(async (req, res) => {
    const result = await verifyCertificate(req.params.code.toUpperCase());
    if (!result.certificate) throw notFound('Certificado não encontrado.');
    res.json(result);
  }),
);

router.use(authenticate);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ certificates: await listCertificates(req.user.id) });
  }),
);

router.post(
  '/',
  validate({ body: z.object({ courseId: z.string().uuid() }) }),
  asyncHandler(async (req, res) => {
    const certificate = await issueCertificate(req.user.id, req.body.courseId);
    res.status(201).json({ certificate });
  }),
);

router.get(
  '/:code',
  validate({ params: codeParam }),
  asyncHandler(async (req, res) => {
    res.json({ certificate: await getCertificateOrThrow(req.user.id, req.params.code.toUpperCase()) });
  }),
);

/** Download em PDF. */
router.get(
  '/:code/download',
  validate({ params: codeParam }),
  asyncHandler(async (req, res) => {
    const cert = await getCertificateOrThrow(req.user.id, req.params.code.toUpperCase());
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="certificado-${cert.code}.pdf"`);
    renderCertificatePdf(cert).pipe(res);
  }),
);

/** Link público de visualização (o certificado não exige login do dono). */
router.get(
  '/:code/public',
  optionalAuth,
  validate({ params: codeParam }),
  asyncHandler(async (req, res) => {
    const result = await verifyCertificate(req.params.code.toUpperCase());
    if (!result.certificate) throw notFound('Certificado não encontrado.');
    res.json(result);
  }),
);

export default router;
