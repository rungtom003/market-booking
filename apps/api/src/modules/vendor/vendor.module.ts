import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { VendorAdminController } from './vendor-admin.controller';
import { VendorAdminService } from './vendor-admin.service';
import { VendorApprovedGuard } from './vendor-approved.guard';
import { VendorImageService } from './vendor-image.service';
import { VendorStatusService } from './vendor-status.service';
import { VendorController } from './vendor.controller';
import { VendorService } from './vendor.service';

@Module({
  imports: [SettingsModule],
  controllers: [VendorController, VendorAdminController],
  providers: [
    VendorService,
    VendorAdminService,
    VendorStatusService,
    VendorImageService,
    VendorApprovedGuard,
  ],
  // module อื่นที่ใช้ @RequireApprovedVendor() ต้อง import VendorModule
  exports: [VendorStatusService, VendorApprovedGuard],
})
export class VendorModule {}
