import 'reflect-metadata';
import type { Server } from 'node:http';
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
  // keep-alive นานกว่า proxy (Nginx upstream keepalive 60 วินาที) — ค่าเริ่มต้น 5 วินาทีทำให้ server ปิด
  // connection ที่ client กำลังจะใช้ซ้ำ → request ล้มแบบ EOF (เจอใน load test Phase 4.6)
  const server = app.getHttpServer() as Server;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  app.get(Logger).log(`API ready at http://localhost:${port}${API_PREFIX}`, 'Bootstrap');
}

void bootstrap();
