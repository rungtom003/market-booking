import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX } from '@market-booking/shared';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  // เก็บ log ตอน boot ไว้จนกว่า pino logger พร้อม (setupApp → useLogger)
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  setupApp(app);

  const port = app.get(AppConfigService).get('PORT');
  await app.listen(port);
  app.get(Logger).log(`API ready at http://localhost:${port}${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
