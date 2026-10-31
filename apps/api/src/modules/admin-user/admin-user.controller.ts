import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AdminUser,
  Permission,
  adminUserListQuerySchema,
  createAdminUserSchema,
  updateAdminUserSchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { PaginatedResult } from '../../common/pagination/paginated-result';
import { CurrentAdmin, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal } from '../auth/principal';
import { AdminUserService } from './admin-user.service';

class AdminUserListQueryDto extends createZodDto(adminUserListQuerySchema) {}
class CreateAdminUserDto extends createZodDto(createAdminUserSchema) {}
class UpdateAdminUserDto extends createZodDto(updateAdminUserSchema) {}

/** จัดการบัญชีผู้ดูแล — SUPER_ADMIN เท่านั้น (ปิดบัญชีด้วย isActive=false แทนการลบ เพราะมี audit/รอบที่อ้างถึง) */
@ApiTags('admin / users')
@ApiBearerAuth()
@RequirePermission(Permission.ADMIN_USERS_MANAGE)
@Controller('admin/users')
export class AdminUserController {
  constructor(private readonly users: AdminUserService) {}

  @Get()
  list(@Query() query: AdminUserListQueryDto): Promise<PaginatedResult<AdminUser>> {
    return this.users.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminUser> {
    return this.users.get(id);
  }

  @Post()
  create(
    @CurrentAdmin() actor: AdminPrincipal,
    @Body() body: CreateAdminUserDto,
  ): Promise<AdminUser> {
    return this.users.create(actor, body);
  }

  @Patch(':id')
  update(
    @CurrentAdmin() actor: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminUserDto,
  ): Promise<AdminUser> {
    return this.users.update(actor, id, body);
  }
}
