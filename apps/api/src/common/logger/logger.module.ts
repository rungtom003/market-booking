import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from '../../config/app-config.service';
import { PINO_REDACT_PATHS } from '../redact';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL'),
          // request id ตั้งโดย requestContextMiddleware (ทำงานก่อน) — log, header และ audit จึงใช้ค่าเดียวกัน
          genReqId: (req) => req.id ?? randomUUID(),
          redact: { paths: PINO_REDACT_PATHS, censor: '[REDACTED]' },
          // health check ถูกเรียกถี่โดย uptime monitor — ไม่ต้อง log
          autoLogging: { ignore: (req) => req.url?.endsWith('/health') ?? false },
          // dev อ่านง่าย; production เป็น JSON บรรทัดเดียวสำหรับเก็บ log
          transport:
            config.get('NODE_ENV') === 'development'
              ? {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
                }
              : undefined,
        },
      }),
    }),
  ],
})
export class AppLoggerModule {}
