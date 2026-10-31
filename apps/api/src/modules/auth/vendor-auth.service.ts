import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, OtpVerifyInput, VendorAuthResult, VendorSummary } from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { MarketService } from '../market/market.service';
import { REGISTRATION_TOKEN_TTL_SECONDS } from './auth.constants';
import { AuthService, IssuedTokens } from './auth.service';
import { LINE_ID_TOKEN_VERIFIER } from './line/line-id-token.verifier';
import type { LineIdTokenVerifier } from './line/line-id-token.verifier';
import { OtpService } from './otp.service';
import type { VendorPrincipal } from './principal';
import { RegistrationClaims, RegistrationTokenService } from './registration-token.service';

const VENDOR_FIELDS = {
  id: true,
  marketId: true,
  firstName: true,
  lastName: true,
  phone: true,
  status: true,
  lineUserId: true,
  phoneVerifiedAt: true,
} satisfies Prisma.VendorSelect;

type VendorRow = Prisma.VendorGetPayload<{ select: typeof VENDOR_FIELDS }>;

/** ผลลัพธ์ให้ controller — refreshToken ไปเป็น cookie ไม่อยู่ใน body */
export type VendorAuthOutcome = VendorAuthResult & { refreshToken?: string };

@Injectable()
export class VendorAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly auth: AuthService,
    private readonly registrationTokens: RegistrationTokenService,
    private readonly markets: MarketService,
    private readonly audit: AuditService,
    @Inject(LINE_ID_TOKEN_VERIFIER) private readonly line: LineIdTokenVerifier,
  ) {}

  requestOtp(phone: string) {
    return this.otp.request(phone);
  }

  /**
   * ยืนยัน OTP: มีบัญชี → login (และผูก LINE ถ้ามาจากขั้นตอน LINE), ยังไม่มี → registrationToken
   */
  async verifyOtp(input: OtpVerifyInput): Promise<VendorAuthOutcome> {
    // ตรวจ token ของขั้นตอน LINE ก่อนใช้ OTP — token เสียจะได้ไม่เปลือง OTP
    const fromLine = input.registrationToken
      ? this.registrationTokens.verify(input.registrationToken)
      : undefined;

    await this.otp.verify(input.phone, input.code);

    const marketId = fromLine?.marketId ?? (await this.markets.getDefaultMarketId());
    let vendor = await this.prisma.vendor.findUnique({
      where: { marketId_phone: { marketId, phone: input.phone } },
      select: VENDOR_FIELDS,
    });

    if (!vendor) {
      return this.registrationRequired({
        marketId,
        verifiedPhone: input.phone,
        lineUserId: fromLine?.lineUserId,
        lineDisplayName: fromLine?.lineDisplayName,
      });
    }

    if (!vendor.phoneVerifiedAt) {
      vendor = await this.prisma.vendor.update({
        where: { id: vendor.id },
        data: { phoneVerifiedAt: new Date() },
        select: VENDOR_FIELDS,
      });
    }
    // สมัครด้วยเบอร์ไว้แล้ว ภายหลังมาทาง LINE → ผูก LINE เข้าบัญชีเดิม
    if (fromLine?.lineUserId && vendor.lineUserId !== fromLine.lineUserId) {
      vendor = await this.linkLine(vendor, fromLine.lineUserId);
    }
    return this.login(vendor, 'otp');
  }

  async loginWithLine(idToken: string): Promise<VendorAuthOutcome> {
    const identity = await this.line.verify(idToken);
    const vendor = await this.prisma.vendor.findUnique({
      where: { lineUserId: identity.userId },
      select: VENDOR_FIELDS,
    });
    if (vendor) return this.login(vendor, 'line');

    return this.registrationRequired({
      marketId: await this.markets.getDefaultMarketId(),
      lineUserId: identity.userId,
      lineDisplayName: identity.displayName,
    });
  }

  /** ผู้ค้าที่ login อยู่ (ด้วยเบอร์) ผูก LINE เพิ่ม */
  async linkLineToVendor(principal: VendorPrincipal, idToken: string): Promise<VendorSummary> {
    const identity = await this.line.verify(idToken);
    const vendor = await this.prisma.vendor.findUniqueOrThrow({
      where: { id: principal.id },
      select: VENDOR_FIELDS,
    });
    return toSummary(await this.linkLine(vendor, identity.userId));
  }

  private async linkLine(vendor: VendorRow, lineUserId: string): Promise<VendorRow> {
    if (vendor.lineUserId === lineUserId) return vendor;
    try {
      const updated = await this.prisma.vendor.update({
        where: { id: vendor.id },
        data: { lineUserId },
        select: VENDOR_FIELDS,
      });
      await this.audit.log({
        actorType: 'VENDOR',
        actorId: vendor.id,
        action: 'vendor.link_line',
        entity: { type: 'vendor', id: vendor.id },
        // line_user_id เป็นข้อมูลระบุตัวตน — บันทึกแค่ว่ามี/ไม่มี
        before: { lineLinked: vendor.lineUserId !== null },
        after: { lineLinked: true },
      });
      return updated;
    } catch (error) {
      // unique ของ line_user_id: LINE นี้ผูกกับผู้ค้าคนอื่นแล้ว
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppException(
          ErrorCode.LINE_ALREADY_LINKED,
          'This LINE account is linked to another vendor',
        );
      }
      throw error;
    }
  }

  private async login(vendor: VendorRow, method: 'otp' | 'line'): Promise<VendorAuthOutcome> {
    const tokens: IssuedTokens = await this.auth.issue({
      actorType: 'VENDOR',
      id: vendor.id,
      marketId: vendor.marketId,
    });
    await this.audit.log({
      actorType: 'VENDOR',
      actorId: vendor.id,
      action: 'auth.login',
      entity: { type: 'vendor', id: vendor.id },
      after: { method },
    });
    return {
      status: 'LOGGED_IN',
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      refreshToken: tokens.refreshToken,
      vendor: toSummary(vendor),
    };
  }

  private registrationRequired(claims: RegistrationClaims): VendorAuthOutcome {
    return {
      status: 'REGISTRATION_REQUIRED',
      registrationToken: this.registrationTokens.sign(claims),
      expiresIn: REGISTRATION_TOKEN_TTL_SECONDS,
      prefill: { phone: claims.verifiedPhone, displayName: claims.lineDisplayName },
    };
  }
}

function toSummary(v: VendorRow): VendorSummary {
  return {
    id: v.id,
    firstName: v.firstName,
    lastName: v.lastName,
    phone: v.phone,
    status: v.status,
    lineLinked: v.lineUserId !== null,
  };
}
