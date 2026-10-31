import { Body, Controller, HttpCode, HttpStatus, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  OtpRequestResponse,
  VendorAuthResult,
  VendorSummary,
  lineLoginSchema,
  otpRequestSchema,
  otpVerifySchema,
} from '@market-booking/shared';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { AppConfigService } from '../../config/app-config.service';
import { OTP_RATE_LIMIT } from './auth.constants';
import { ActorTypes, CurrentVendor, Public } from './decorators';
import type { VendorPrincipal } from './principal';
import { setRefreshCookie } from './refresh-cookie';
import { VendorAuthOutcome, VendorAuthService } from './vendor-auth.service';

class OtpRequestDto extends createZodDto(otpRequestSchema) {}
class OtpVerifyDto extends createZodDto(otpVerifySchema) {}
class LineLoginDto extends createZodDto(lineLoginSchema) {}

@ApiTags('auth / vendor')
@Controller('auth')
export class VendorAuthController {
  constructor(
    private readonly vendorAuth: VendorAuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: OTP_RATE_LIMIT })
  @ApiOperation({ summary: 'ส่ง OTP ทาง SMS (ขอใหม่ได้ทุก 60 วินาที, 5 ครั้ง/ชั่วโมง/เบอร์)' })
  requestOtp(@Body() body: OtpRequestDto): Promise<OtpRequestResponse> {
    return this.vendorAuth.requestOtp(body.phone);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: OTP_RATE_LIMIT })
  @ApiOperation({
    summary:
      'ยืนยัน OTP → LOGGED_IN (+ refresh cookie) หรือ REGISTRATION_REQUIRED (+ registrationToken)',
  })
  async verifyOtp(
    @Body() body: OtpVerifyDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VendorAuthResult> {
    return this.respond(res, await this.vendorAuth.verifyOtp(body));
  }

  @Public()
  @Post('line')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: OTP_RATE_LIMIT })
  @ApiOperation({ summary: 'Login ด้วย LIFF ID token (ตรวจกับ LINE)' })
  async line(
    @Body() body: LineLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<VendorAuthResult> {
    return this.respond(res, await this.vendorAuth.loginWithLine(body.idToken));
  }

  @ActorTypes('VENDOR')
  @ApiBearerAuth()
  @Post('line/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ผูก LINE กับบัญชีผู้ค้าที่ login อยู่' })
  linkLine(
    @CurrentVendor() vendor: VendorPrincipal,
    @Body() body: LineLoginDto,
  ): Promise<VendorSummary> {
    return this.vendorAuth.linkLineToVendor(vendor, body.idToken);
  }

  private respond(res: Response, outcome: VendorAuthOutcome): VendorAuthResult {
    const { refreshToken, ...result } = outcome;
    if (refreshToken) setRefreshCookie(res, 'VENDOR', refreshToken, this.config.isProduction);
    return result;
  }
}
