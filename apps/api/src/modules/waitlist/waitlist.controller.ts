import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AdminWaitlistEntry,
  Permission,
  type WaitlistEntry,
  joinWaitlistSchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { CurrentAdmin, CurrentVendor, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { RequireApprovedVendor } from '../vendor/vendor-approved.guard';
import { WaitlistService } from './waitlist.service';

class JoinWaitlistDto extends createZodDto(joinWaitlistSchema) {}

@ApiTags('waitlist')
@ApiBearerAuth()
@RequireApprovedVendor()
@Controller('waitlists')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get()
  @ApiOperation({ summary: 'คิวรอของฉัน (วันขายวันนี้เป็นต้นไป) พร้อมจำนวนคิวก่อนหน้า' })
  list(@CurrentVendor() vendor: VendorPrincipal): Promise<WaitlistEntry[]> {
    return this.waitlist.listMine(vendor);
  }

  @Post()
  @ApiOperation({
    summary:
      'เข้าคิวล็อคที่ไม่ว่าง (stallId) หรือทั้งโซนที่เต็ม (zoneId) — ว่างอยู่ = WAITLIST_NOT_NEEDED',
  })
  join(
    @CurrentVendor() vendor: VendorPrincipal,
    @Body() body: JoinWaitlistDto,
  ): Promise<WaitlistEntry> {
    return this.waitlist.join(vendor, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'ออกจากคิว — ได้สิทธิ์อยู่ = สละ HOLD นั้น (ส่งต่อคิวถัดไป)' })
  leave(
    @CurrentVendor() vendor: VendorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WaitlistEntry> {
    return this.waitlist.leave(vendor, id);
  }
}

@ApiTags('admin / waitlist')
@ApiBearerAuth()
@RequirePermission(Permission.BOOKINGS_CANCEL)
@Controller('admin')
export class WaitlistAdminController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get('market-days/:id/waitlists')
  @ApiOperation({ summary: 'คิวรอทั้งหมดของวันขาย (ทุกสถานะ) เรียงตามลำดับเข้าคิว' })
  list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminWaitlistEntry[]> {
    return this.waitlist.listForDay(admin, id);
  }

  @Delete('waitlists/:id')
  @ApiOperation({
    summary: 'นำผู้ค้าออกจากคิว (ได้สิทธิ์อยู่ = ยกเลิก HOLD นั้นด้วย) — ลง audit log',
  })
  remove(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminWaitlistEntry> {
    return this.waitlist.removeByAdmin(admin, id);
  }
}
