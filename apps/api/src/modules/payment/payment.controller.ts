import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminPayment,
  BookingPaymentInfo,
  Permission,
  UploadTicket,
  adminPaymentListQuerySchema,
  recordCashPaymentSchema,
  rejectPaymentSchema,
  slipUploadRequestSchema,
  submitSlipSchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import type { PaginatedResult } from '../../common/pagination/paginated-result';
import { CurrentAdmin, CurrentVendor, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { RequireApprovedVendor } from '../vendor/vendor-approved.guard';
import { PaymentReviewService } from './payment-review.service';
import { PaymentService } from './payment.service';

class SlipUploadRequestDto extends createZodDto(slipUploadRequestSchema) {}
class SubmitSlipDto extends createZodDto(submitSlipSchema) {}
class AdminPaymentListQueryDto extends createZodDto(adminPaymentListQuerySchema) {}
class RejectPaymentDto extends createZodDto(rejectPaymentSchema) {}
class RecordCashPaymentDto extends createZodDto(recordCashPaymentSchema) {}

@ApiTags('payments')
@ApiBearerAuth()
@RequireApprovedVendor()
@Controller('bookings/:id')
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Get('payment')
  @ApiOperation({ summary: 'ยอด, กำหนดชำระ, PromptPay payload (วาด QR) และประวัติการชำระ' })
  info(
    @CurrentVendor() vendor: VendorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BookingPaymentInfo> {
    return this.payments.info(vendor, id);
  }

  @Post('payments/slip-upload')
  @ApiOperation({ summary: 'ขอ URL อัปโหลดสลิป (presigned PUT) — การจองต้องรอชำระ' })
  slipUpload(
    @CurrentVendor() vendor: VendorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SlipUploadRequestDto,
  ): Promise<UploadTicket> {
    return this.payments.createSlipUpload(vendor, id, body);
  }

  @Post('payments')
  @ApiOperation({
    summary: 'ส่งสลิปที่อัปโหลดแล้ว → PENDING_VERIFY (เลยกำหนด → PAYMENT_DUE_PASSED)',
  })
  submit(
    @CurrentVendor() vendor: VendorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SubmitSlipDto,
  ): Promise<BookingPaymentInfo> {
    return this.payments.submitSlip(vendor, id, body);
  }
}

@ApiTags('admin / payments')
@ApiBearerAuth()
@RequirePermission(Permission.PAYMENTS_VERIFY)
@Controller('admin/payments')
export class PaymentAdminController {
  constructor(private readonly review: PaymentReviewService) {}

  @Get()
  @ApiOperation({
    summary: 'รายการชำระเงิน (status=PENDING = คิวรอตรวจ เก่าสุดก่อน) + URL รูปสลิป',
  })
  list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: AdminPaymentListQueryDto,
  ): Promise<PaginatedResult<AdminPayment>> {
    return this.review.list(admin, query);
  }

  @Post('cash')
  @ApiOperation({ summary: 'บันทึกรับเงินสดหน้างาน → การจอง CONFIRMED' })
  cash(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: RecordCashPaymentDto,
  ): Promise<AdminPayment> {
    return this.review.recordCash(admin, body);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'อนุมัติสลิป → การจอง CONFIRMED + checkin token' })
  approve(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminPayment> {
    return this.review.approve({ type: 'ADMIN', admin }, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ไม่ผ่าน (ต้องมีเหตุผล) → การจองกลับเป็นรอชำระ + กำหนดชำระใหม่' })
  reject(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectPaymentDto,
  ): Promise<AdminPayment> {
    return this.review.reject({ type: 'ADMIN', admin }, id, body.reason);
  }
}
