import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessGuard } from './guards/access.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginAttemptService } from './login-attempt.service';
import { RefreshTokenService } from './refresh-token.service';
import { TokenService } from './token.service';

@Global()
@Module({
  // secret ส่งตอน sign/verify (TokenService) — ไม่ผูกไว้ที่ module
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    RefreshTokenService,
    LoginAttemptService,
    // ลำดับสำคัญ: ตรวจ token ก่อน แล้วค่อยตรวจสิทธิ์
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [AuthService, RefreshTokenService],
})
export class AuthModule {}
