import { INestApplication } from '@nestjs/common';
import { API_PREFIX } from '@market-booking/shared';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { requestContextMiddleware } from './common/request-context';
import { AppConfigService } from './config/app-config.service';
import { setupSwagger } from './setup-swagger';

/** ตั้งค่าที่ใช้ร่วมกันระหว่าง main.ts และ integration test เพื่อให้ test ตรงกับของจริง */
export function setupApp(app: INestApplication): void {
  const config = app.get(AppConfigService);

  app.useLogger(app.get(Logger));
  // ต้องมาก่อน middleware ของ Nest (รวม pino-http) — ดู request-context.ts
  app.use(requestContextMiddleware);
  app.use(helmet());
  // อ่าน refresh token cookie (httpOnly) — ใช้เฉพาะ /auth/refresh, /auth/logout
  app.use(cookieParser());

  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ''));
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();

  if (!config.isProduction) setupSwagger(app);
}
