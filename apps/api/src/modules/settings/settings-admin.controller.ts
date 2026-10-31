import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, Settings, updateSettingsSchema } from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { CurrentAdmin, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';
import { SettingsService } from './settings.service';

class UpdateSettingsDto extends createZodDto(updateSettingsSchema) {}

@ApiTags('admin / settings')
@ApiBearerAuth()
@RequirePermission(Permission.SETTINGS_MANAGE)
@Controller('admin/settings')
export class SettingsAdminController {
  constructor(
    private readonly settings: SettingsService,
    private readonly markets: MarketService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'ค่าทั้งหมดของตลาด (key ที่ไม่เคยตั้งเป็นค่า default)' })
  async getAll(@CurrentAdmin() admin: AdminPrincipal): Promise<Settings> {
    return this.settings.getAll(await this.markets.resolveForAdmin(admin));
  }

  @Put()
  @ApiOperation({
    summary:
      'แก้ค่า — ส่งเฉพาะ key ที่จะเปลี่ยน คืนค่าทั้งชุดหลังแก้ (key ที่ไม่รู้จัก/ค่าผิดประเภท → 400)',
  })
  async update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: UpdateSettingsDto,
  ): Promise<Settings> {
    return this.settings.update(admin, await this.markets.resolveForAdmin(admin), body);
  }
}
