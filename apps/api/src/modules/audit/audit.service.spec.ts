import { Prisma } from '../../generated/prisma/client';
import { runWithRequestContext } from '../../common/request-context';
import type { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  const create = jest.fn();
  const prisma = { auditLog: { create } } as unknown as PrismaService;
  const service = new AuditService(prisma);

  beforeEach(() => create.mockReset());

  it('writes the entry with redacted before/after and request ip/user-agent', async () => {
    await runWithRequestContext({ requestId: 'r1', ip: '10.0.0.1', userAgent: 'jest' }, () =>
      service.log({
        actorType: 'ADMIN',
        actorId: 'admin-1',
        action: 'admin_user.update',
        entity: { type: 'admin_user', id: 'u1' },
        before: { displayName: 'A', passwordHash: 'old' },
        after: { displayName: 'B', passwordHash: 'new' },
      }),
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        actorType: 'ADMIN',
        actorId: 'admin-1',
        action: 'admin_user.update',
        entityType: 'admin_user',
        entityId: 'u1',
        before: { displayName: 'A', passwordHash: '[REDACTED]' },
        after: { displayName: 'B', passwordHash: '[REDACTED]' },
        ip: '10.0.0.1',
        userAgent: 'jest',
      },
    });
  });

  it('stores SQL NULL for missing before/after and context (e.g. SYSTEM jobs)', async () => {
    await service.log({
      actorType: 'SYSTEM',
      action: 'booking.expire',
      entity: { type: 'booking' },
    });

    expect(create.mock.calls[0][0].data).toMatchObject({
      actorId: null,
      entityId: null,
      before: Prisma.DbNull,
      after: Prisma.DbNull,
      ip: null,
      userAgent: null,
    });
  });

  it('uses the given transaction client instead of the default one', async () => {
    const txCreate = jest.fn();

    await service.log({ actorType: 'ADMIN', action: 'x.y', entity: { type: 'x' } }, {
      auditLog: { create: txCreate },
    } as never);

    expect(txCreate).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });
});
