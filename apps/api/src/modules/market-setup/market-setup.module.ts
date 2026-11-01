import { Module } from '@nestjs/common';
import { VendorModule } from '../vendor/vendor.module';
import {
  ProductCategoryAdminController,
  StallAdminController,
  ZoneAdminController,
} from './market-setup-admin.controller';
import { MapLayoutAdminController } from './map-layout.controller';
import { MapLayoutService } from './map-layout.service';
import { MarketLayoutController } from './market-layout.controller';
import { MarketLayoutService } from './market-layout.service';
import { ProductCategoryService } from './product-category.service';
import { StallService } from './stall.service';
import { ZoneService } from './zone.service';

/** ตั้งค่าตลาด: ประเภทสินค้า, โซน, ล็อค และผังตลาดสำหรับผู้ค้า (Phase 3.1) + Map Editor (9.1) */
@Module({
  imports: [VendorModule],
  controllers: [
    ProductCategoryAdminController,
    ZoneAdminController,
    // ก่อน StallAdminController: path admin/stalls/layout ต้องไม่ถูกจับเป็น :id
    MapLayoutAdminController,
    StallAdminController,
    MarketLayoutController,
  ],
  providers: [
    ProductCategoryService,
    ZoneService,
    StallService,
    MarketLayoutService,
    MapLayoutService,
  ],
  exports: [MarketLayoutService],
})
export class MarketSetupModule {}
