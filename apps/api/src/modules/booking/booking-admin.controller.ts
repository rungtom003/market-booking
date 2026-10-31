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
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  AdminBooking,
  AdminMarketDayOption,
  AdminMarketDayStalls,
  Booking,
  Permission,
  adminBookingListQuerySchema,
  adminCancelBookingSchema,
  adminCreateBookingSchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import type { PaginatedResult } from '../../common/pagination/paginated-result';
import { CurrentAdmin, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal } from '../auth/principal';
import { BookingAdminService } from './booking-admin.service';
import { BookingService } from './booking.service';

class AdminBookingListQueryDto extends createZodDto(adminBookingListQuerySchema) {}
class AdminCreateBookingDto extends createZodDto(adminCreateBookingSchema) {}
class AdminCancelBookingDto extends createZodDto(adminCancelBookingSchema) {}

/** สิทธิ์เดียวกับ "ยกเลิกการจองแทนผู้ค้า" (Overview §2) — กลุ่มที่ดูแลการจองหน้างาน */
@ApiTags('admin / bookings')
@ApiBearerAuth()
@RequirePermission(Permission.BOOKINGS_CANCEL)
@Controller('admin/bookings')
export class BookingAdminController {
  constructor(
    private readonly bookings: BookingService,
    private readonly admin: BookingAdminService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'รายการจอง — กรองวันขาย/สถานะ (ACTIVE = ยังมีผล)/ค้นหาผู้ค้าหรือรหัสล็อค',
  })
  list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: AdminBookingListQueryDto,
  ): Promise<PaginatedResult<AdminBooking>> {
    return this.admin.list(admin, query);
  }

  @Post()
  @ApiOperation({
    summary: 'จองแทนผู้ค้า — ข้ามรอบ/โควตา/ล็อคสงวนได้ แต่ล็อคที่มีการจองอยู่ = STALL_TAKEN',
  })
  create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: AdminCreateBookingDto,
  ): Promise<AdminBooking> {
    return this.admin.create(admin, body);
  }

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

@ApiTags('admin / bookings')
@ApiBearerAuth()
@RequirePermission(Permission.BOOKINGS_CANCEL)
@Controller('admin/market-days')
export class BookingAdminDayController {
  constructor(private readonly admin: BookingAdminService) {}

  @Get()
  @ApiOperation({ summary: 'วันขายของรอบที่เผยแพร่แล้ว (ตั้งแต่ 30 วันก่อน) + จำนวนการจอง' })
  days(@CurrentAdmin() admin: AdminPrincipal): Promise<AdminMarketDayOption[]> {
    return this.admin.days(admin);
  }

  @Get(':id/stalls')
  @ApiOperation({ summary: 'ผังวันขายพร้อมการจองและชื่อผู้ค้าของแต่ละล็อค' })
  stalls(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminMarketDayStalls> {
    return this.admin.dayStalls(admin, id);
  }

  @Get(':id/bookings.xlsx')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'รายชื่อผู้ค้าของวันขาย (xlsx) — ลง audit log' })
  async export(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { filename, buffer } = await this.admin.exportDay(admin, id);
    return new StreamableFile(buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
