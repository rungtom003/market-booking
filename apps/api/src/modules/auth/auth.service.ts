import { Injectable, Logger } from '@nestjs/common';
import { AdminLoginInput, AdminProfile, ErrorCode, permissionsOf } from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { verifyPassword } from '../../common/password';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants';
import { LoginAttemptService } from './login-attempt.service';
import type { AdminPrincipal, Principal } from './principal';
import { RefreshTokenService, SessionActor } from './refresh-token.service';
import { TokenService } from './token.service';

export interface IssuedTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

const ADMIN_SELECT = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  marketId: true,
  isActive: true,
  passwordHash: true,
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly loginAttempts: LoginAttemptService,
    private readonly audit: AuditService,
  ) {}

  async adminLogin(input: AdminLoginInput): Promise<IssuedTokens & { admin: AdminProfile }> {
    const username = input.username.toLowerCase();
    await this.loginAttempts.assertNotLocked('admin', username);

    const admin = await this.prisma.adminUser.findUnique({
      where: { username },
      select: ADMIN_SELECT,
    });
    // เทียบรหัสเสมอแม้ไม่พบผู้ใช้ (เวลาตอบเท่ากัน) และตอบ error เดียวกันทุกกรณี — ไม่บอกว่าผิดที่ username หรือรหัส
    const passwordOk = await verifyPassword(input.password, admin?.passwordHash ?? null);
    if (!admin || !passwordOk || !admin.isActive) {
      await this.loginAttempts.recordFailure('admin', username);
      this.logger.warn(`Admin login failed for "${username}"`);
      throw new AppException(ErrorCode.INVALID_CREDENTIALS, 'Invalid username or password');
    }

    await this.loginAttempts.reset('admin', username);
    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: { lastLoginAt: new Date() },
    });

    const principal: AdminPrincipal = {
      actorType: 'ADMIN',
      id: admin.id,
      role: admin.role,
      marketId: admin.marketId,
    };
    await this.audit.log({
      actorType: 'ADMIN',
      actorId: admin.id,
      action: 'auth.login',
      entity: { type: 'admin_user', id: admin.id },
    });

    return {
      ...(await this.issue(principal)),
      admin: {
        id: admin.id,
        username: admin.username,
        displayName: admin.displayName,
        role: admin.role,
        marketId: admin.marketId,
        permissions: permissionsOf(admin.role),
      },
    };
  }

  /** โปรไฟล์ admin ที่ login อยู่ (หน้า admin ใช้ซ่อนเมนูตามสิทธิ์หลังรีเฟรชหน้า) */
  async adminProfile(id: string): Promise<AdminProfile> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id }, select: ADMIN_SELECT });
    if (!admin?.isActive)
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Account is no longer active');
    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.displayName,
      role: admin.role,
      marketId: admin.marketId,
      permissions: permissionsOf(admin.role),
    };
  }

  /** ออก access + refresh token ใหม่ (login) — ใช้กับ vendor ใน Phase 1.4 ด้วย */
  async issue(principal: Principal): Promise<IssuedTokens> {
    return {
      accessToken: this.tokens.signAccessToken(principal),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: await this.refreshTokens.issue({
        type: principal.actorType,
        id: principal.id,
      }),
    };
  }

  /**
   * แลก refresh token เป็นชุดใหม่ (rotation) — โหลดข้อมูลผู้ใช้ใหม่ทุกครั้ง
   * เพื่อให้การเปลี่ยน role/ปิดบัญชีมีผลภายในอายุ access token (15 นาที)
   */
  async refresh(actorType: SessionActor['type'], refreshToken: string): Promise<IssuedTokens> {
    const { actor, token } = await this.refreshTokens.rotate(refreshToken);
    // cookie ของแอปหนึ่งต้องไม่ถูกใช้แทนอีกประเภท
    if (actor.type !== actorType) {
      await this.refreshTokens.revoke(token);
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Invalid or expired refresh token');
    }

    const principal = await this.loadPrincipal(actor);
    if (!principal) {
      await this.refreshTokens.revokeAll(actor);
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Account is no longer active');
    }

    return {
      accessToken: this.tokens.signAccessToken(principal),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      refreshToken: token,
    };
  }

  async logout(refreshToken: string | null): Promise<void> {
    if (refreshToken) await this.refreshTokens.revoke(refreshToken);
  }

  private async loadPrincipal(actor: SessionActor): Promise<Principal | null> {
    if (actor.type === 'ADMIN') {
      const admin = await this.prisma.adminUser.findUnique({
        where: { id: actor.id },
        select: { id: true, role: true, marketId: true, isActive: true },
      });
      if (!admin?.isActive) return null;
      return { actorType: 'ADMIN', id: admin.id, role: admin.role, marketId: admin.marketId };
    }

    // สถานะการอนุมัติตรวจที่ VendorApprovedGuard (Phase 2.1) — ผู้ค้า PENDING ยัง login ได้ (§9.1 ข้อ 5)
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: actor.id },
      select: { id: true, marketId: true },
    });
    return vendor ? { actorType: 'VENDOR', id: vendor.id, marketId: vendor.marketId } : null;
  }
}
