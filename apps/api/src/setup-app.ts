import { INestApplication } from '@nestjs/common';
import { API_PREFIX } from '@market-booking/shared';
import { AppConfigService } from './config/app-config.service';

/** ตั้งค่าที่ใช้ร่วมกันระหว่าง main.ts และ e2e test เพื่อให้ test ตรงกับของจริง */
export function setupApp(app: INestApplication): void {
  const config = app.get(AppConfigService);

  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''));
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();
}
