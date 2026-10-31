import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, Settings } from '@market-booking/shared';
import { CurrentAdmin, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal } from '../auth/principal';
import { MarketService } from '../market/market.service';
import { SettingsService } from './settings.service';

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
  async getAll(@CurrentAdmin() admin: AdminPrincipal): Promise<Settings> {
    return this.settings.getAll(await this.markets.resolveForAdmin(admin));
  }
}
