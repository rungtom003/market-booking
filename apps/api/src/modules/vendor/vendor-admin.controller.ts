import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminVendorDetail,
  AdminVendorListItem,
  BulkApproveResult,
  Permission,
  VendorStatusCounts,
  adminVendorListQuerySchema,
  bulkApproveVendorsSchema,
  rejectVendorSchema,
  suspendVendorSchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { PaginatedResult } from '../../common/pagination/paginated-result';
import { CurrentAdmin, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal } from '../auth/principal';
import { VendorAdminService } from './vendor-admin.service';

class AdminVendorListQueryDto extends createZodDto(adminVendorListQuerySchema) {}
class RejectVendorDto extends createZodDto(rejectVendorSchema) {}
class SuspendVendorDto extends createZodDto(suspendVendorSchema) {}
class BulkApproveVendorsDto extends createZodDto(bulkApproveVendorsSchema) {}

@ApiTags('admin / vendors')
@ApiBearerAuth()
@RequirePermission(Permission.VENDORS_REVIEW)
@Controller('admin/vendors')
export class VendorAdminController {
  constructor(private readonly vendors: VendorAdminService) {}

  @Get()
  list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: AdminVendorListQueryDto,
  ): Promise<PaginatedResult<AdminVendorListItem>> {
    return this.vendors.list(admin, query);
  }

  @Get('counts')
  @ApiOperation({ summary: 'จำนวนผู้ค้าต่อสถานะ (badge รออนุมัติ)' })
  counts(@CurrentAdmin() admin: AdminPrincipal): Promise<VendorStatusCounts> {
    return this.vendors.counts(admin);
  }

  @Post('bulk-approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '`{ ids }` หรือ `{ allPending: true }` — รายการที่ไม่ใช่ PENDING ถูกข้าม',
  })
  bulkApprove(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: BulkApproveVendorsDto,
  ): Promise<BulkApproveResult> {
    return this.vendors.bulkApprove(admin, body);
  }

  @Get(':id')
  detail(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminVendorDetail> {
    return this.vendors.detail(admin, id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminVendorDetail> {
    return this.vendors.approve(admin, id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: RejectVendorDto,
  ): Promise<AdminVendorDetail> {
    return this.vendors.reject(admin, id, body.reason);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SuspendVendorDto,
  ): Promise<AdminVendorDetail> {
    return this.vendors.suspend(admin, id, body);
  }

  @Post(':id/unsuspend')
  @HttpCode(HttpStatus.OK)
  unsuspend(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminVendorDetail> {
    return this.vendors.unsuspend(admin, id);
  }
}
