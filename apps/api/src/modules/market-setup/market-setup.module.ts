import { Module } from '@nestjs/common';
import { VendorModule } from '../vendor/vendor.module';
import {
  ProductCategoryAdminController,
  StallAdminController,
  ZoneAdminController,
} from './market-setup-admin.controller';
import { MarketLayoutController } from './market-layout.controller';
import { MarketLayoutService } from './market-layout.service';
import { ProductCategoryService } from './product-category.service';
import { StallService } from './stall.service';
import { ZoneService } from './zone.service';

/** ตั้งค่าตลาด: ประเภทสินค้า, โซน, ล็อค และผังตลาดสำหรับผู้ค้า (Phase 3.1) */
@Module({
  imports: [VendorModule],
  controllers: [
    ProductCategoryAdminController,
    ZoneAdminController,
    StallAdminController,
    MarketLayoutController,
  ],
  providers: [ProductCategoryService, ZoneService, StallService, MarketLayoutService],
  exports: [MarketLayoutService],
})
export class MarketSetupModule {}
