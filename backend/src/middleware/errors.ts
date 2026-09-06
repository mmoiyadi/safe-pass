import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '@pm/shared';

/**
 * Error serializer. Emits { error: { code, message, details } } and never leaks internals.
 *
 * An unrecognised error becomes a bare 500 with no message from the thrown object, because a
 * Prisma or driver error can carry column values — and a column value here may be ciphertext
 * or an AuthHash (FR-020).
 */
/** Fastify types the handler's first argument loosely; narrow it before touching any field. */
interface MaybeFastifyError {
  name?: string;
  message?: string;
  stack?: string;
  statusCode?: number;
  validation?: unknown;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((raw: unknown, request: FastifyRequest, reply: FastifyReply) => {
    if (raw instanceof ApiError) {
      return reply.code(raw.status).send(raw.toBody());
    }
    const error = (raw ?? {}) as MaybeFastifyError;

    if (error.message?.startsWith('ENVELOPE_MALFORMED')) {
      return reply.code(400).send({
        error: { code: 'ENVELOPE_MALFORMED', message: 'Malformed ciphertext envelope' },
      });
    }

    if (error.statusCode === 429) {
      return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } });
    }

    if (error.validation) {
      return reply
        .code(400)
        .send({ error: { code: 'VALIDATION_FAILED', message: 'Request validation failed' } });
    }

    request.log.error({ err: { name: error.name, stack: error.stack } }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'VALIDATION_FAILED', message: 'Internal error' } });
  });

  // FR-030: an unknown route is indistinguishable from a resource the caller may not see.
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } }),
  );
}
