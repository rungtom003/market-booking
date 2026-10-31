import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  RegistrationUploadRequestInput,
  UpdateVendorProfileInput,
  UploadRequestInput,
  UploadTicket,
  VendorImageKind,
  VendorProfile,
  VendorRegisterInput,
  VendorRegisterResponse,
} from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import type { VendorPrincipal } from '../auth/principal';
import { RegistrationTokenService } from '../auth/registration-token.service';
import { NotifyService } from '../notify/notify.service';
import { SettingsService } from '../settings/settings.service';
import { ImageOwner, VendorImageService } from './vendor-image.service';
import { VENDOR_PROFILE_SELECT, toVendorProfile, toVendorSummary } from './vendor-profile';
import { VendorStatusService } from './vendor-status.service';

const IMAGE_FIELDS = [
  { kind: VendorImageKind.ID_CARD, field: 'idCardImageKey', setting: 'require_id_card_image' },
  { kind: VendorImageKind.SHOP, field: 'shopImageKey', setting: 'require_shop_image' },
] as const;

function validationError(path: string, message: string): AppException {
  return new AppException(ErrorCode.VALIDATION_ERROR, 'Request validation failed', [
    { path, message, code: 'custom' },
  ]);
}

/** ผู้ค้าจัดการตัวเอง: สมัคร, อัปโหลดรูป, ดู/แก้โปรไฟล์ */
@Injectable()
export class VendorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registrationTokens: RegistrationTokenService,
    private readonly settings: SettingsService,
    private readonly images: VendorImageService,
    private readonly status: VendorStatusService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  /** URL อัปโหลดรูประหว่างสมัคร — ไฟล์อยู่ใต้ prefix ของการสมัครครั้งนี้ */
  createRegistrationUpload(input: RegistrationUploadRequestInput): Promise<UploadTicket> {
    const claims = this.registrationTokens.verify(input.registrationToken);
    return this.images.createUpload({ registrationId: claims.registrationId }, input);
  }

  createProfileUpload(vendor: VendorPrincipal, input: UploadRequestInput): Promise<UploadTicket> {
    return this.images.createUpload({ vendorId: vendor.id }, input);
  }

  /**
   * สมัครสมาชิก (§9.1): เบอร์/LINE มาจาก registrationToken (server ยืนยันแล้ว) ไม่ใช่จาก client
   * สถานะตาม `registration_mode`: AUTO → APPROVED, MANUAL → PENDING
   */
  async register(
    input: VendorRegisterInput,
  ): Promise<VendorRegisterResponse & { refreshToken: string }> {
    const claims = this.registrationTokens.verify(input.registrationToken);
    // มาทาง OTP: ใช้เบอร์ที่ยืนยันแล้วเสมอ (ไม่สนเบอร์ใน body); มาทาง LINE: ต้องกรอกเบอร์
    const phone = claims.verifiedPhone ?? input.phone;
    if (!phone) throw validationError('phone', 'Phone is required');

    const settings = await this.settings.getAll(claims.marketId);
    const owners: ImageOwner[] = [{ registrationId: claims.registrationId }];
    for (const { kind, field, setting } of IMAGE_FIELDS) {
      const key = input[field];
      if (!key && settings[setting]) throw validationError(field, 'This image is required');
      if (key) await this.images.assertUsable(owners, kind, key);
    }
    await this.assertCategory(claims.marketId, input.productCategoryId);
    await this.assertNotRegistered(claims.marketId, phone, claims.lineUserId);

    const status = settings.registration_mode === 'AUTO' ? 'APPROVED' : 'PENDING';
    const now = new Date();
    let vendor;
    try {
      vendor = await this.prisma.$transaction(async (tx) => {
        const created = await tx.vendor.create({
          data: {
            marketId: claims.marketId,
            firstName: input.firstName,
            lastName: input.lastName,
            phone,
            phoneVerifiedAt: claims.verifiedPhone ? now : null,
            lineUserId: claims.lineUserId ?? null,
            address: input.address,
            shopName: input.shopName ?? null,
            productCategoryId: input.productCategoryId ?? null,
            idCardImageKey: input.idCardImageKey ?? null,
            shopImageKey: input.shopImageKey ?? null,
            pdpaConsentAt: now,
            status,
            // AUTO: ระบบอนุมัติเอง (reviewed_by ว่าง = ไม่ใช่คน)
            reviewedAt: status === 'APPROVED' ? now : null,
          },
          select: VENDOR_PROFILE_SELECT,
        });
        await this.audit.log(
          {
            actorType: 'VENDOR',
            actorId: created.id,
            action: 'vendor.register',
            entity: { type: 'vendor', id: created.id },
            after: {
              status,
              registrationMode: settings.registration_mode,
              phoneVerified: !!claims.verifiedPhone,
            },
          },
          tx,
        );
        return created;
      });
    } catch (error) {
      // สมัครพร้อมกันสองครั้ง: unique index เป็นผู้ตัดสิน แล้วบอกว่าซ้ำที่อะไร
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        await this.assertNotRegistered(claims.marketId, phone, claims.lineUserId);
      }
      throw error;
    }

    await this.notify.vendorStatusChanged({
      vendorId: vendor.id,
      marketId: vendor.marketId,
      from: null,
      to: vendor.status,
    });
    const tokens = await this.auth.issue({
      actorType: 'VENDOR',
      id: vendor.id,
      marketId: vendor.marketId,
    });
    return { status: 'LOGGED_IN', ...tokens, vendor: toVendorSummary(vendor) };
  }

  async getMe(principal: VendorPrincipal): Promise<VendorProfile> {
    await this.status.liftExpiredSuspension(principal.id);
    return toVendorProfile(await this.findProfile(principal.id), this.images);
  }

  /** แก้ข้อมูล — ถ้าถูกปฏิเสธอยู่ จะกลับเป็น PENDING เพื่อให้ admin ตรวจใหม่ (§8.1) */
  async updateMe(
    principal: VendorPrincipal,
    input: UpdateVendorProfileInput,
  ): Promise<VendorProfile> {
    const before = await this.findProfile(principal.id);
    const settings = await this.settings.getAll(before.marketId);

    for (const { kind, field, setting } of IMAGE_FIELDS) {
      const key = input[field];
      if (key === undefined || key === before[field]) continue;
      if (key === null && settings[setting]) throw validationError(field, 'This image is required');
      if (key) await this.images.assertUsable([{ vendorId: principal.id }], kind, key);
    }
    if (input.productCategoryId)
      await this.assertCategory(before.marketId, input.productCategoryId);

    const after = await this.prisma.$transaction(async (tx) => {
      const row = await tx.vendor.update({
        where: { id: principal.id },
        data: input,
        select: VENDOR_PROFILE_SELECT,
      });
      await this.audit.log(
        {
          actorType: 'VENDOR',
          actorId: principal.id,
          action: 'vendor.update',
          entity: { type: 'vendor', id: principal.id },
          before: pickChanged(before, input),
          after: pickChanged(row, input),
        },
        tx,
      );
      return row;
    });

    if (after.status === 'REJECTED') {
      await this.status.transition(principal.id, 'resubmit', {
        actorType: 'VENDOR',
        actorId: principal.id,
        data: { rejectReason: null },
      });
    }
    return toVendorProfile(await this.findProfile(principal.id), this.images);
  }

  private async findProfile(id: string) {
    const row = await this.prisma.vendor.findUnique({
      where: { id },
      select: VENDOR_PROFILE_SELECT,
    });
    // token ยังไม่หมดอายุแต่บัญชีหายไป (เช่น ถูกลบตามคำขอ PDPA)
    if (!row) throw new AppException(ErrorCode.UNAUTHORIZED, 'Vendor account not found');
    return row;
  }

  private async assertCategory(marketId: string, categoryId: string | null | undefined) {
    if (!categoryId) return;
    const found = await this.prisma.productCategory.count({ where: { id: categoryId, marketId } });
    if (!found) throw validationError('productCategoryId', 'Unknown product category');
  }

  private async assertNotRegistered(marketId: string, phone: string, lineUserId?: string) {
    const byPhone = await this.prisma.vendor.count({ where: { marketId, phone } });
    if (byPhone) {
      throw new AppException(
        ErrorCode.PHONE_ALREADY_REGISTERED,
        'This phone number already has an account — verify it with OTP to log in',
      );
    }
    if (lineUserId && (await this.prisma.vendor.count({ where: { lineUserId } }))) {
      throw new AppException(
        ErrorCode.LINE_ALREADY_LINKED,
        'This LINE account is linked to another vendor',
      );
    }
  }
}

function pickChanged(row: Record<string, unknown>, input: object): Record<string, unknown> {
  return Object.fromEntries(Object.keys(input).map((k) => [k, row[k]]));
}
