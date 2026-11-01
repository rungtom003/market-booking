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
  type CheckinDay,
  type CheckinQr,
  type CheckinResult,
  Permission,
  checkinScanSchema,
  isoDateSchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { CurrentAdmin, CurrentVendor, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { RequireApprovedVendor } from '../vendor/vendor-approved.guard';
import { CheckinService } from './checkin.service';

class CheckinScanDto extends createZodDto(checkinScanSchema) {}
class CheckinDayQueryDto extends createZodDto(z.object({ date: isoDateSchema })) {}

@ApiTags('bookings')
@ApiBearerAuth()
@RequireApprovedVendor()
@Controller('bookings')
export class CheckinVendorController {
  constructor(private readonly checkin: CheckinService) {}

  @Get(':id/checkin-qr')
  @ApiOperation({ summary: 'QR check-in ของการจองที่ยืนยันแล้ว + ช่วงเวลา check-in' })
  qr(
    @CurrentVendor() vendor: VendorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CheckinQr> {
    return this.checkin.qr(vendor, id);
  }
}

@ApiTags('admin / checkin')
@ApiBearerAuth()
@RequirePermission(Permission.CHECKIN)
@Controller('admin/checkin')
export class CheckinAdminController {
  constructor(private readonly checkin: CheckinService) {}

  @Get()
  @ApiOperation({
    summary: 'วันขายของวันที่ (YYYY-MM-DD) + การจองที่ยืนยันแล้วพร้อมสถานะ check-in',
  })
  day(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() q: CheckinDayQueryDto,
  ): Promise<CheckinDay | null> {
    return this.checkin.day(admin, q.date);
  }

  @Post('scan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'สแกน QR — สแกนซ้ำได้ alreadyCheckedIn; CHECKIN_INVALID / CHECKIN_WRONG_DAY / CHECKIN_NOT_OPEN / CHECKIN_CLOSED',
  })
  scan(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: CheckinScanDto,
  ): Promise<CheckinResult> {
    return this.checkin.scan(admin, body);
  }

  @Post('bookings/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'check-in จากการค้นหา (สำรองเมื่อสแกนไม่ได้)' })
  manual(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CheckinResult> {
    return this.checkin.manual(admin, id);
  }
}
