import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  type VendorDataExport,
  deleteMyAccountSchema,
  eraseVendorSchema,
} from '@market-booking/shared';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { AppConfigService } from '../../config/app-config.service';
import { ActorTypes, CurrentAdmin, CurrentVendor, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal, VendorPrincipal } from '../auth/principal';
import { clearRefreshCookie } from '../auth/refresh-cookie';
import { PrivacyService } from './privacy.service';

class DeleteMyAccountDto extends createZodDto(deleteMyAccountSchema) {}
class EraseVendorDto extends createZodDto(eraseVendorSchema) {}

/** ผู้ค้าทุกสถานะ (รวมที่ถูกปฏิเสธ/ระงับ) ใช้สิทธิ์ตาม PDPA ได้ */
@ApiTags('vendors')
@ApiBearerAuth()
@ActorTypes('VENDOR')
@Controller('vendors/me')
export class PrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly config: AppConfigService,
  ) {}

  @Get('export')
  @ApiOperation({ summary: 'สำเนาข้อมูลส่วนบุคคลของฉัน (JSON) — ลง audit log' })
  export(@CurrentVendor() vendor: VendorPrincipal): Promise<VendorDataExport> {
    return this.privacy.export(vendor);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'ลบบัญชีและข้อมูลส่วนบุคคล (ยืนยันด้วยเบอร์โทร) — ยังมีการจองที่ยังไม่ถึงวัน → ACCOUNT_HAS_ACTIVE_BOOKINGS',
  })
  async erase(
    @CurrentVendor() vendor: VendorPrincipal,
    @Body() body: DeleteMyAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.privacy.eraseSelf(vendor, body);
    clearRefreshCookie(res, 'VENDOR', this.config.isProduction);
  }
}

@ApiTags('admin / vendors')
@ApiBearerAuth()
@RequirePermission(Permission.VENDOR_DATA_ERASE)
@Controller('admin/vendors')
export class PrivacyAdminController {
  constructor(private readonly privacy: PrivacyService) {}

  @Post(':id/erase')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบข้อมูลส่วนบุคคลของผู้ค้าตามคำขอ (PDPA) — ย้อนกลับไม่ได้' })
  erase(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: EraseVendorDto,
  ): Promise<void> {
    return this.privacy.eraseByAdmin(admin, id, body);
  }
}
