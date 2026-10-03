import { ZodError } from 'zod';
import { badRequest } from '../utils/errors.js';

/**
 * Valida req[source] contra o schema Zod e substitui o valor pelo
 * resultado parseado (coerções e defaults aplicados).
 *
 *   router.post('/', validate({ body: createUserSchema }), handler)
 */
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      for (const source of ['body', 'query', 'params']) {
        const schema = schemas[source];
        if (!schema) continue;
        const result = schema.parse(req[source] ?? {});
        if (source === 'query') {
          // req.query é getter-only no Express 5; guardamos em req.validatedQuery.
          req.validatedQuery = result;
        } else {
          req[source] = result;
        }
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.issues.map((i) => ({
          field: i.path.join('.') || '(root)',
          message: i.message,
        }));
        return next(badRequest('Dados inválidos.', details));
      }
      next(err);
    }
  };
}
