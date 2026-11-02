import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { ErrorCode } from '@market-booking/shared';
import type { Request } from 'express';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { ActorTypes } from '../auth/decorators';
import { VendorStatusService } from './vendor-status.service';

/**
 * endpoint ที่ต้องเป็นผู้ค้าที่อนุมัติแล้วและไม่ถูกระงับ (§8.1: "จองได้เฉพาะ APPROVED และ suspended_until ว่างหรือผ่านไปแล้ว")
 * อ่านสถานะจาก DB ทุกครั้ง (ไม่เชื่อ token) — admin อนุมัติ/ระงับแล้วมีผลทันที
 */
@Injectable()
export class VendorApprovedGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly status: VendorStatusService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const principal = context.switchToHttp().getRequest<Request>().principal;
    if (principal?.actorType !== 'VENDOR') throw new AppException(ErrorCode.FORBIDDEN);

    // อ่านก่อน แล้วเขียนเฉพาะเมื่อการระงับหมดเวลาแล้วจริง (เดิม UPDATE ทุก request — เจอใน load test 4.6)
    let vendor = await this.prisma.vendor.findUnique({
      where: { id: principal.id },
      select: { status: true, suspendedUntil: true, deletedAt: true },
    });
    // ลบข้อมูลแล้ว (PDPA) — access token เดิมที่ยังไม่หมดอายุใช้ต่อไม่ได้
    if (!vendor || vendor.deletedAt) {
      throw new AppException(ErrorCode.UNAUTHORIZED, 'Vendor account not found');
    }
    if (
      vendor.status === 'SUSPENDED' &&
      vendor.suspendedUntil &&
      vendor.suspendedUntil <= new Date()
    ) {
      await this.status.liftExpiredSuspension(principal.id);
      vendor = { status: 'APPROVED', suspendedUntil: null, deletedAt: null };
    }

    if (vendor.status === 'SUSPENDED') {
      throw new AppException(ErrorCode.VENDOR_SUSPENDED, 'Your account is suspended', {
        until: vendor.suspendedUntil?.toISOString() ?? null,
      });
    }
    if (vendor.status !== 'APPROVED') {
      throw new AppException(ErrorCode.VENDOR_NOT_APPROVED, 'Your account is not approved yet', {
        status: vendor.status,
      });
    }
    return true;
  }
}

/** ใส่ที่ controller/method ของผู้ค้าที่ต้องอนุมัติแล้ว เช่น การจอง (Phase 4) */
export const RequireApprovedVendor = () =>
  applyDecorators(ActorTypes('VENDOR'), UseGuards(VendorApprovedGuard));
