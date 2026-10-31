import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AdminProfile } from '@market-booking/shared';
import { AuthService } from './auth.service';
import { ActorTypes, CurrentAdmin } from './decorators';
import type { AdminPrincipal } from './principal';

@ApiTags('admin / me')
@ApiBearerAuth()
@ActorTypes('ADMIN')
@Controller('admin/me')
export class AdminMeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  me(@CurrentAdmin() admin: AdminPrincipal): Promise<AdminProfile> {
    return this.auth.adminProfile(admin.id);
  }
}
