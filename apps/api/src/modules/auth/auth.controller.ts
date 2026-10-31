import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AccessTokenResponse, AdminLoginResponse, ErrorCode } from '@market-booking/shared';
import type { Request, Response } from 'express';
import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { LOGIN_RATE_LIMIT } from './auth.constants';
import { AuthService } from './auth.service';
import { Public } from './decorators';
import { AdminLoginDto, SessionActorDto } from './dto';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie';

@ApiTags('auth')
@Public()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: LOGIN_RATE_LIMIT })
  @ApiOperation({ summary: 'Admin login — ตั้ง refresh token เป็น httpOnly cookie' })
  async adminLogin(
    @Body() body: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminLoginResponse> {
    const { refreshToken, ...result } = await this.auth.adminLogin(body);
    setRefreshCookie(res, 'ADMIN', refreshToken, this.config.isProduction);
    return result;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'แลก refresh cookie เป็น access token ใหม่ (cookie ถูกหมุนใหม่ทุกครั้ง)',
  })
  async refresh(
    @Body() body: SessionActorDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenResponse> {
    const cookie = readRefreshCookie(req, body.actorType);
    if (!cookie) throw new AppException(ErrorCode.UNAUTHORIZED, 'Missing refresh token');

    try {
      const { refreshToken, ...result } = await this.auth.refresh(body.actorType, cookie);
      setRefreshCookie(res, body.actorType, refreshToken, this.config.isProduction);
      return result;
    } catch (error) {
      // token ใช้ไม่ได้แล้ว — ลบ cookie ทิ้งให้ client ไปหน้า login
      clearRefreshCookie(res, body.actorType, this.config.isProduction);
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'ยกเลิก refresh token ของเครื่องนี้ (access token หมดอายุเองใน 15 นาที)',
  })
  async logout(
    @Body() body: SessionActorDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<null> {
    await this.auth.logout(readRefreshCookie(req, body.actorType));
    clearRefreshCookie(res, body.actorType, this.config.isProduction);
    return null;
  }
}
