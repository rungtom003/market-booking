import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Booking,
  Permission,
  adminCancelBookingSchema,
  cancelBookingSchema,
  holdBookingSchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { CurrentAdmin, CurrentVendor, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { RequireApprovedVendor } from '../vendor/vendor-approved.guard';
import { BookingService } from './booking.service';

class HoldBookingDto extends createZodDto(holdBookingSchema) {}
class CancelBookingDto extends createZodDto(cancelBookingSchema) {}
class AdminCancelBookingDto extends createZodDto(adminCancelBookingSchema) {}

@ApiTags('bookings')
@ApiBearerAuth()
@RequireApprovedVendor()
@Controller('bookings')
export class BookingController {
  constructor(private readonly bookings: BookingService) {}

  @Post('hold')
  @ApiOperation({
    summary:
      'จองล็อค (HOLD) — STALL_TAKEN / STALL_UNAVAILABLE / QUOTA_EXCEEDED / CATEGORY_NOT_ALLOWED / ROUND_NOT_OPEN',
  })
  hold(@CurrentVendor() vendor: VendorPrincipal, @Body() body: HoldBookingDto): Promise<Booking> {
    return this.bookings.hold(vendor, body);
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ยืนยัน HOLD → CONFIRMED หรือ PENDING_PAYMENT (หมดเวลา → HOLD_EXPIRED)',
  })
  confirm(
    @CurrentVendor() vendor: VendorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Booking> {
    return this.bookings.confirm(vendor, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ยกเลิกเอง — เลย cancel_before_hours แล้ว → CANCEL_WINDOW_PASSED' })
  cancel(
    @CurrentVendor() vendor: VendorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelBookingDto,
  ): Promise<Booking> {
    return this.bookings.cancelByVendor(vendor, id, body);
  }

  @Get('me')
  @ApiOperation({ summary: 'การจองของฉัน (วันขายล่าสุดก่อน ไม่เกิน 100 รายการ)' })
  mine(@CurrentVendor() vendor: VendorPrincipal): Promise<Booking[]> {
    return this.bookings.listMine(vendor);
  }
}

@ApiTags('admin / bookings')
@ApiBearerAuth()
@RequirePermission(Permission.BOOKINGS_CANCEL)
@Controller('admin/bookings')
export class BookingAdminController {
  constructor(private readonly bookings: BookingService) {}

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ยกเลิกแทนผู้ค้าได้ทุกเวลา (ต้องระบุเหตุผล, ลง audit log)' })
  cancel(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AdminCancelBookingDto,
  ): Promise<Booking> {
    return this.bookings.cancelByAdmin(admin, id, body);
  }
}
