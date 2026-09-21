import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Layer 1: minimal bootstrap. Feature modules are added in later layers.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Allow the Vite dev server (and the Compose frontend) to call the API.
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = process.env.BACKEND_PORT ? Number(process.env.BACKEND_PORT) : 3000;

  // Bind to 0.0.0.0 so the port is reachable from outside the container.
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
