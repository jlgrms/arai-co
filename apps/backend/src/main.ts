import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

// Layer 3: bootstrap now includes global validation for auth DTOs.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Allow the Vite dev server (and the Compose frontend) to call the API.
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Enforce DTO decorators; strip unknown properties; transform payloads.
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : 3000;

  // Bind to 0.0.0.0 so the port is reachable from outside the container.
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
