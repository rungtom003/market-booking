import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AdminMeController } from './admin-me.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessGuard } from './guards/access.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { HttpLineIdTokenVerifier, LINE_ID_TOKEN_VERIFIER } from './line/line-id-token.verifier';
import { LoginAttemptService } from './login-attempt.service';
import { OtpService } from './otp.service';
import { RefreshTokenService } from './refresh-token.service';
import { RegistrationTokenService } from './registration-token.service';
import { TokenService } from './token.service';
import { VendorAuthController } from './vendor-auth.controller';
import { VendorAuthService } from './vendor-auth.service';

@Global()
@Module({
  // secret ส่งตอน sign/verify (TokenService) — ไม่ผูกไว้ที่ module
  imports: [JwtModule.register({})],
  controllers: [AuthController, AdminMeController, VendorAuthController],
  providers: [
    AuthService,
    TokenService,
    RefreshTokenService,
    LoginAttemptService,
    OtpService,
    RegistrationTokenService,
    VendorAuthService,
    // test override ด้วย .overrideProvider(LINE_ID_TOKEN_VERIFIER) ได้
    { provide: LINE_ID_TOKEN_VERIFIER, useClass: HttpLineIdTokenVerifier },
    // ลำดับสำคัญ: ตรวจ token ก่อน แล้วค่อยตรวจสิทธิ์
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  // RegistrationTokenService: POST /vendors/register (Phase 2.1) ใช้ตรวจ token
  exports: [AuthService, RefreshTokenService, RegistrationTokenService],
})
export class AuthModule {}
