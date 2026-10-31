import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  UploadTicket,
  VendorProfile,
  VendorRegisterResponse,
  registrationUploadRequestSchema,
  updateVendorProfileSchema,
  uploadRequestSchema,
  vendorRegisterSchema,
} from '@market-booking/shared';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { AppConfigService } from '../../config/app-config.service';
import { OTP_RATE_LIMIT } from '../auth/auth.constants';
import { ActorTypes, CurrentVendor, Public } from '../auth/decorators';
import type { VendorPrincipal } from '../auth/principal';
import { setRefreshCookie } from '../auth/refresh-cookie';
import { VendorService } from './vendor.service';

class RegistrationUploadDto extends createZodDto(registrationUploadRequestSchema) {}
class VendorRegisterDto extends createZodDto(vendorRegisterSchema) {}
class UpdateVendorProfileDto extends createZodDto(updateVendorProfileSchema) {}
class UploadRequestDto extends createZodDto(uploadRequestSchema) {}

@ApiTags('vendors')
@Controller('vendors')
export class VendorController {
  constructor(
    private readonly vendors: VendorService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('register/uploads')
  @Throttle({ default: OTP_RATE_LIMIT })
  @ApiOperation({ summary: 'ขอ URL อัปโหลดรูปบัตร/รูปร้านระหว่างสมัคร (ใช้ registrationToken)' })
  createRegistrationUpload(@Body() body: RegistrationUploadDto): Promise<UploadTicket> {
    return this.vendors.createRegistrationUpload(body);
  }

  @Public()
  @Post('register')
  @Throttle({ default: OTP_RATE_LIMIT })
  @ApiOperation({ summary: 'สมัครสมาชิก — สถานะตาม registration_mode, login ให้ทันที' })
  async register(
    @Body() body: VendorRegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VendorRegisterResponse> {
    const { refreshToken, ...result } = await this.vendors.register(body);
    setRefreshCookie(res, 'VENDOR', refreshToken, this.config.isProduction);
    return result;
  }

  @ActorTypes('VENDOR')
  @ApiBearerAuth()
  @Get('me')
  getMe(@CurrentVendor() vendor: VendorPrincipal): Promise<VendorProfile> {
    return this.vendors.getMe(vendor);
  }

  @ActorTypes('VENDOR')
  @ApiBearerAuth()
  @Patch('me')
  @ApiOperation({ summary: 'แก้ข้อมูลตัวเอง — ถ้าถูกปฏิเสธอยู่จะกลับเป็น PENDING' })
  updateMe(
    @CurrentVendor() vendor: VendorPrincipal,
    @Body() body: UpdateVendorProfileDto,
  ): Promise<VendorProfile> {
    return this.vendors.updateMe(vendor, body);
  }

  @ActorTypes('VENDOR')
  @ApiBearerAuth()
  @Post('me/images')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'ขอ URL อัปโหลดรูปใหม่ แล้วส่ง key ไปกับ PATCH /vendors/me' })
  createProfileUpload(
    @CurrentVendor() vendor: VendorPrincipal,
    @Body() body: UploadRequestDto,
  ): Promise<UploadTicket> {
    return this.vendors.createProfileUpload(vendor, body);
  }
}
