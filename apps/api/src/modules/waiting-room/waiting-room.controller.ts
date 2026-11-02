import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, type WaitingRoomStats, type WaitingRoomStatus } from '@market-booking/shared';
import { CurrentAdmin, CurrentVendor, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { RequireApprovedVendor } from '../vendor/vendor-approved.guard';
import { WaitingRoomService } from './waiting-room.service';

@ApiTags('rounds')
@ApiBearerAuth()
@RequireApprovedVendor()
@Controller('rounds/:id/waiting-room')
export class WaitingRoomController {
  constructor(private readonly room: WaitingRoomService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'เข้าคิว Waiting Room (ซ้ำได้) — รอบที่ไม่เปิดใช้ตอบ NOT_REQUIRED' })
  join(
    @CurrentVendor() vendor: VendorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WaitingRoomStatus> {
    return this.room.join(vendor, id);
  }

  @Get()
  @ApiOperation({ summary: 'สถานะคิว — หน้าเว็บถามทุก 5 วินาที (ไม่ถามนาน = ถือว่าออกจากคิว)' })
  status(
    @CurrentVendor() vendor: VendorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WaitingRoomStatus> {
    return this.room.status(vendor, id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ออกจากคิว/หน้าจอง — คืนที่ให้คนถัดไป' })
  leave(
    @CurrentVendor() vendor: VendorPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.room.leave(vendor, id);
  }
}

@ApiTags('admin / rounds')
@ApiBearerAuth()
@RequirePermission(Permission.ROUNDS_MANAGE)
@Controller('admin/rounds/:id/waiting-room')
export class WaitingRoomAdminController {
  constructor(private readonly room: WaitingRoomService) {}

  @Get()
  @ApiOperation({ summary: 'จำนวนคนในคิว/ในหน้าจองตอนนี้' })
  stats(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WaitingRoomStats> {
    return this.room.stats(admin, id);
  }
}
