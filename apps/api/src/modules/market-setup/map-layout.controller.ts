import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type AdminMapLayout,
  Permission,
  type UploadTicket,
  mapBackgroundUploadSchema,
  saveMapLayoutSchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { CurrentAdmin, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal } from '../auth/principal';
import { MapLayoutService } from './map-layout.service';

class SaveMapLayoutDto extends createZodDto(saveMapLayoutSchema) {}
class MapBackgroundUploadDto extends createZodDto(mapBackgroundUploadSchema) {}

/** Map Editor (Phase 9.1) — ผังทั้งชุด */
@ApiTags('admin / market setup')
@ApiBearerAuth()
@RequirePermission(Permission.MARKET_LAYOUT_MANAGE)
@Controller('admin/stalls/layout')
export class MapLayoutAdminController {
  constructor(private readonly layout: MapLayoutService) {}

  @Get()
  @ApiOperation({
    summary:
      'ผังทั้งหมดสำหรับ Map Editor: ทุกล็อค (รวมปิดใช้งาน), โซน, สัญลักษณ์, พื้นหลัง + version',
  })
  get(@CurrentAdmin() admin: AdminPrincipal): Promise<AdminMapLayout> {
    return this.layout.adminLayout(admin);
  }

  @Put()
  @ApiOperation({
    summary:
      'บันทึกผังทั้งชุดใน transaction เดียว (ตำแหน่งล็อค, ล็อคใหม่, สัญลักษณ์, พื้นหลัง) — version เก่า = LAYOUT_OUTDATED',
  })
  save(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: SaveMapLayoutDto,
  ): Promise<AdminMapLayout> {
    return this.layout.save(admin, body);
  }

  @Post('background-upload')
  @ApiOperation({ summary: 'URL อัปโหลดรูปแปลนตลาด (JPEG/PNG/WebP ≤ 5 MB) — ใช้ key ตอนบันทึกผัง' })
  backgroundUpload(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: MapBackgroundUploadDto,
  ): Promise<UploadTicket> {
    return this.layout.backgroundUpload(admin, body);
  }
}
