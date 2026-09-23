import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Allowed browser origins, from `FRONTEND_URL`.
 *
 * In production the frontend is a separate Fly app on a different hostname, so
 * the old permissive `origin: true` (reflect whatever asks) has to become an
 * explicit allowlist. `FRONTEND_URL` is a comma-separated list so a staging
 * origin can sit alongside production without another env var.
 *
 * Defaults to the Vite dev server when unset, which keeps local development
 * working with no `.env` changes — the previous behaviour, scoped down.
 */
function allowedOrigins(): string[] {
  const raw = process.env.FRONTEND_URL;
  if (!raw) return ['http://localhost:5173'];
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: allowedOrigins(),
    credentials: true,
  });

  // Enforce DTO decorators; strip unknown properties; transform payloads.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // One consistent error envelope for every failure (ai-dev-instructions §8).
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : 3000;

  // Bind to 0.0.0.0 so the port is reachable from outside the container.
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
