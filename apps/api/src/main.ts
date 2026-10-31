import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { API_PREFIX } from '@market-booking/shared';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  setupApp(app);

  const port = app.get(AppConfigService).get('PORT');
  await app.listen(port);
  Logger.log(`API ready at http://localhost:${port}${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
