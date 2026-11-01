import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AdminAnnouncement,
  type Announcement,
  Permission,
  createAnnouncementSchema,
  updateAnnouncementSchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { CurrentAdmin, CurrentVendor, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { AnnouncementService } from './announcement.service';

class CreateAnnouncementDto extends createZodDto(createAnnouncementSchema) {}
class UpdateAnnouncementDto extends createZodDto(updateAnnouncementSchema) {}

/** ผู้ค้าทุกสถานะเห็นประกาศ (รวมที่รออนุมัติ — เช่น แจ้งเอกสารที่ต้องใช้) */
@ApiTags('announcements')
@ApiBearerAuth()
@Controller('announcements')
export class AnnouncementController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  @ApiOperation({ summary: 'ประกาศที่กำลังแสดงของตลาด — ปักหมุดก่อน แล้วใหม่สุดก่อน (สูงสุด 20)' })
  list(@CurrentVendor() vendor: VendorPrincipal): Promise<Announcement[]> {
    return this.announcements.active(vendor.marketId);
  }
}

@ApiTags('admin / announcements')
@ApiBearerAuth()
@RequirePermission(Permission.ANNOUNCEMENTS_MANAGE)
@Controller('admin/announcements')
export class AnnouncementAdminController {
  constructor(private readonly announcements: AnnouncementService) {}

  @Get()
  @ApiOperation({ summary: 'ประกาศทั้งหมด (ล่าสุดก่อน) พร้อมสถานะตามเวลาและสถานะการส่ง LINE' })
  list(@CurrentAdmin() admin: AdminPrincipal): Promise<AdminAnnouncement[]> {
    return this.announcements.list(admin);
  }

  @Post()
  @ApiOperation({
    summary:
      'สร้างประกาศ — broadcastLine = ส่ง LINE ถึงผู้ค้าที่เชื่อม LINE ครั้งเดียวเมื่อถึงเวลาเผยแพร่',
  })
  create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: CreateAnnouncementDto,
  ): Promise<AdminAnnouncement> {
    return this.announcements.create(admin, body);
  }

  @Patch(':id')
  update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAnnouncementDto,
  ): Promise<AdminAnnouncement> {
    return this.announcements.update(admin, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.announcements.remove(admin, id);
  }
}
