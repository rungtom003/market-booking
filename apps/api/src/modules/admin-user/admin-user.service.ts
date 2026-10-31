import { Injectable } from '@nestjs/common';
import {
  AdminRole,
  AdminUser,
  AdminUserListQuery,
  CreateAdminUserInput,
  ErrorCode,
  UpdateAdminUserInput,
} from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PaginatedResult, toSkipTake } from '../../common/pagination/paginated-result';
import { hashPassword } from '../../common/password';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AdminPrincipal } from '../auth/principal';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { MarketService } from '../market/market.service';

// ไม่ select password_hash — ไม่มีทางหลุดออกไปใน response/audit
const PUBLIC_FIELDS = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  marketId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AdminUserSelect;

type AdminUserRow = Prisma.AdminUserGetPayload<{ select: typeof PUBLIC_FIELDS }>;

function toDto(row: AdminUserRow): AdminUser {
  return {
    ...row,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class AdminUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly markets: MarketService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  async list(query: AdminUserListQuery): Promise<PaginatedResult<AdminUser>> {
    const where: Prisma.AdminUserWhereInput = {
      role: query.role,
      isActive: query.isActive,
      ...(query.q && {
        OR: [
          { username: { contains: query.q, mode: 'insensitive' } },
          { displayName: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.adminUser.findMany({
        where,
        select: PUBLIC_FIELDS,
        orderBy: { createdAt: 'asc' },
        ...toSkipTake(query),
      }),
      this.prisma.adminUser.count({ where }),
    ]);
    return PaginatedResult.of(rows.map(toDto), total, query);
  }

  async get(id: string): Promise<AdminUser> {
    return toDto(await this.findOrThrow(id));
  }

  async create(actor: AdminPrincipal, input: CreateAdminUserInput): Promise<AdminUser> {
    const marketId = await this.marketFor(input.role, input.marketId);
    const passwordHash = await hashPassword(input.password);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.adminUser.create({
          data: {
            username: input.username,
            passwordHash,
            displayName: input.displayName,
            role: input.role,
            marketId,
          },
          select: PUBLIC_FIELDS,
        });
        await this.audit.log(
          {
            actorType: 'ADMIN',
            actorId: actor.id,
            action: 'admin_user.create',
            entity: { type: 'admin_user', id: row.id },
            after: row,
          },
          tx,
        );
        return toDto(row);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(ErrorCode.USERNAME_TAKEN, 'Username is already taken');
      }
      throw error;
    }
  }

  async update(actor: AdminPrincipal, id: string, input: UpdateAdminUserInput): Promise<AdminUser> {
    const before = await this.findOrThrow(id);
    const role = input.role ?? before.role;
    const isActive = input.isActive ?? before.isActive;

    // กันตัวเองหลุดสิทธิ์จนไม่มีใครแก้กลับได้
    if (id === actor.id && (role !== before.role || !isActive)) {
      throw new AppException(
        ErrorCode.FORBIDDEN,
        'You cannot change your own role or deactivate yourself',
      );
    }
    if (
      before.role === AdminRole.SUPER_ADMIN &&
      before.isActive &&
      (role !== AdminRole.SUPER_ADMIN || !isActive)
    ) {
      await this.assertAnotherActiveSuperAdmin(id);
    }

    const roleChanged = role !== before.role;
    const marketId =
      input.marketId !== undefined || roleChanged
        ? await this.marketFor(role, input.marketId ?? before.marketId ?? undefined)
        : before.marketId;

    const data: Prisma.AdminUserUpdateInput = {
      displayName: input.displayName,
      role,
      isActive,
      market: marketId ? { connect: { id: marketId } } : { disconnect: true },
      ...(input.password && { passwordHash: await hashPassword(input.password) }),
    };

    const after = await this.prisma.$transaction(async (tx) => {
      const row = await tx.adminUser.update({ where: { id }, data, select: PUBLIC_FIELDS });
      await this.audit.log(
        {
          actorType: 'ADMIN',
          actorId: actor.id,
          action: 'admin_user.update',
          entity: { type: 'admin_user', id },
          before,
          // ไม่เก็บรหัสใหม่ (แม้เป็น hash) — บันทึกแค่ว่ามีการเปลี่ยน
          after: { ...row, ...(input.password && { passwordChanged: true }) },
        },
        tx,
      );
      return row;
    });

    // สิทธิ์/รหัสเปลี่ยน → บังคับ login ใหม่ทุกเครื่อง (access token เดิมยังใช้ได้จนหมดอายุ ≤ 15 นาที)
    if (roleChanged || !isActive || input.password || after.marketId !== before.marketId) {
      await this.refreshTokens.revokeAll({ type: 'ADMIN', id });
    }
    return toDto(after);
  }

  private async findOrThrow(id: string): Promise<AdminUserRow> {
    const row = await this.prisma.adminUser.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Admin user not found');
    return row;
  }

  /** SUPER_ADMIN ดูแลทุกตลาด (null); role อื่นต้องผูกตลาด — ไม่ระบุ = ตลาดหลัก */
  private async marketFor(role: AdminRole, marketId: string | undefined): Promise<string | null> {
    if (role === AdminRole.SUPER_ADMIN) return null;
    if (!marketId) return this.markets.getDefaultMarketId();
    await this.markets.assertExists(marketId);
    return marketId;
  }

  private async assertAnotherActiveSuperAdmin(excludeId: string): Promise<void> {
    const others = await this.prisma.adminUser.count({
      where: { role: AdminRole.SUPER_ADMIN, isActive: true, id: { not: excludeId } },
    });
    if (others === 0) {
      throw new AppException(ErrorCode.CONFLICT, 'At least one active SUPER_ADMIN is required');
    }
  }
}
