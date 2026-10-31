import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppConfigService } from '../config/app-config.service';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: AppConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL'),
        // connection ต่อ instance — ช่วงเปิดรอบ request พร้อมกันเยอะ (Phase 4.6)
        max: config.get('DATABASE_POOL_SIZE'),
      }),
    });
  }

  // ไม่ $connect() ตอน init — Prisma ต่อ DB เองตอน query แรก ทำให้ app/test ที่ไม่แตะ DB boot ได้โดยไม่ต้องมี postgres
  // ปิด connection pool ตอน shutdown (app.enableShutdownHooks() ใน setup-app.ts เรียก hook นี้เมื่อได้ SIGTERM/SIGINT)
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
