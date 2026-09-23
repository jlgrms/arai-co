import type { ConfigService } from '@nestjs/config';

/**
 * The JWT signing secret, resolved from `JWT_SECRET`.
 *
 * Used by BOTH the signer (`auth.module.ts`) and the verifier
 * (`jwt.strategy.ts`). They must agree on the key or every token is rejected, so
 * the lookup lives here rather than being copy-pasted into each — a drift
 * between the two would present as "every login silently fails", which is a
 * miserable thing to debug.
 *
 * FAILS CLOSED IN PRODUCTION. Previously both sites fell back to the literal
 * `'change-me-in-a-real-deployment'` with no regard for NODE_ENV. That is a
 * known secret: if `JWT_SECRET` were ever missing in production, the app would
 * start happily and sign real session tokens with a value published in this
 * repo — anyone could forge an admin token. It would also fail *silently*,
 * which is the worst property for an auth key.
 *
 * So: outside development/test the secret is REQUIRED and its absence stops the
 * boot. In development the well-known fallback is kept, because local work and
 * the test suite should not need a secret configured to run.
 */
export function resolveJwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (secret) return secret;

  const env = config.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
  if (env === 'production') {
    throw new Error(
      'JWT_SECRET is not set. Refusing to start in production with a default ' +
        'signing key — set it with `fly secrets set JWT_SECRET=...`.',
    );
  }

  return 'change-me-in-a-real-deployment';
}
