import { Test } from '@nestjs/testing';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { runWithRequestContext } from '../../src/common/request-context';
import { AppConfigModule } from '../../src/config/config.module';
import { AuditModule } from '../../src/modules/audit/audit.module';
import { AuditService } from '../../src/modules/audit/audit.service';
import { PrismaModule } from '../../src/prisma/prisma.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { truncateAll } from './test-db';

describe('AuditService (integration)', () => {
  let audit: AuditService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, PrismaModule, AuditModule],
    }).compile();
    audit = moduleRef.get(AuditService);
    prisma = moduleRef.get(PrismaService);
    await truncateAll(prisma as unknown as PrismaClient);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists an entry with context and redacted payloads', async () => {
    const entityId = '01a18fcf-0000-7000-8000-000000000001';

    await runWithRequestContext({ requestId: 'r1', ip: '203.0.113.9', userAgent: 'jest' }, () =>
      audit.log({
        actorType: 'ADMIN',
        actorId: '01a18fcf-0000-7000-8000-000000000002',
        action: 'admin_user.update',
        entity: { type: 'admin_user', id: entityId },
        before: { displayName: 'A', passwordHash: '$2b$12$secret' },
        after: { displayName: 'B' },
      }),
    );

    const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId } });
    expect(row).toMatchObject({
      actorType: 'ADMIN',
      action: 'admin_user.update',
      entityType: 'admin_user',
      before: { displayName: 'A', passwordHash: '[REDACTED]' },
      after: { displayName: 'B' },
      ip: '203.0.113.9',
      userAgent: 'jest',
    });
  });

  it('rolls back with the surrounding transaction', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await audit.log(
          { actorType: 'SYSTEM', action: 'test.rollback', entity: { type: 'test' } },
          tx,
        );
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');

    await expect(prisma.auditLog.count({ where: { action: 'test.rollback' } })).resolves.toBe(0);
  });
});
