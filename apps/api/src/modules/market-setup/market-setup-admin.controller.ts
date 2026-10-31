import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BulkCreateStallsResult,
  Permission,
  ProductCategory,
  Stall,
  Zone,
  adminStallListQuerySchema,
  bulkCreateStallsSchema,
  createProductCategorySchema,
  createStallSchema,
  createZoneSchema,
  updateProductCategorySchema,
  updateStallSchema,
  updateZoneSchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { CurrentAdmin, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal } from '../auth/principal';
import { ProductCategoryService } from './product-category.service';
import { StallService } from './stall.service';
import { ZoneService } from './zone.service';

class CreateProductCategoryDto extends createZodDto(createProductCategorySchema) {}
class UpdateProductCategoryDto extends createZodDto(updateProductCategorySchema) {}
class CreateZoneDto extends createZodDto(createZoneSchema) {}
class UpdateZoneDto extends createZodDto(updateZoneSchema) {}
class AdminStallListQueryDto extends createZodDto(adminStallListQuerySchema) {}
class CreateStallDto extends createZodDto(createStallSchema) {}
class BulkCreateStallsDto extends createZodDto(bulkCreateStallsSchema) {}
class UpdateStallDto extends createZodDto(updateStallSchema) {}

@ApiTags('admin / market setup')
@ApiBearerAuth()
@RequirePermission(Permission.MARKET_LAYOUT_MANAGE)
@Controller('admin/product-categories')
export class ProductCategoryAdminController {
  constructor(private readonly categories: ProductCategoryService) {}

  @Get()
  list(@CurrentAdmin() admin: AdminPrincipal): Promise<ProductCategory[]> {
    return this.categories.list(admin);
  }

  @Post()
  create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: CreateProductCategoryDto,
  ): Promise<ProductCategory> {
    return this.categories.create(admin, body);
  }

  @Patch(':id')
  update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProductCategoryDto,
  ): Promise<ProductCategory> {
    return this.categories.update(admin, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบได้เมื่อไม่มีผู้ค้าเลือกประเภทนี้ (ไม่งั้น RESOURCE_IN_USE)' })
  remove(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.categories.remove(admin, id);
  }
}

@ApiTags('admin / market setup')
@ApiBearerAuth()
@RequirePermission(Permission.MARKET_LAYOUT_MANAGE)
@Controller('admin/zones')
export class ZoneAdminController {
  constructor(private readonly zones: ZoneService) {}

  @Get()
  list(@CurrentAdmin() admin: AdminPrincipal): Promise<Zone[]> {
    return this.zones.list(admin);
  }

  @Post()
  create(@CurrentAdmin() admin: AdminPrincipal, @Body() body: CreateZoneDto): Promise<Zone> {
    return this.zones.create(admin, body);
  }

  @Patch(':id')
  update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateZoneDto,
  ): Promise<Zone> {
    return this.zones.update(admin, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบได้เมื่อไม่มีล็อคในโซน (ไม่งั้น RESOURCE_IN_USE)' })
  remove(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.zones.remove(admin, id);
  }
}

@ApiTags('admin / market setup')
@ApiBearerAuth()
@RequirePermission(Permission.MARKET_LAYOUT_MANAGE)
@Controller('admin/stalls')
export class StallAdminController {
  constructor(private readonly stalls: StallService) {}

  @Get()
  @ApiOperation({ summary: 'ทุกล็อคของตลาด (ไม่แบ่งหน้า) เรียงตามโซนและรหัส' })
  list(
    @CurrentAdmin() admin: AdminPrincipal,
    @Query() query: AdminStallListQueryDto,
  ): Promise<Stall[]> {
    return this.stalls.list(admin, query);
  }

  @Post()
  create(@CurrentAdmin() admin: AdminPrincipal, @Body() body: CreateStallDto): Promise<Stall> {
    return this.stalls.create(admin, body);
  }

  @Post('bulk')
  @ApiOperation({
    summary: 'สร้างหลายล็อค: prefix + ช่วงเลข (เช่น A1–A20) — รหัสซ้ำตัวเดียว = ไม่สร้างเลย',
  })
  bulkCreate(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: BulkCreateStallsDto,
  ): Promise<BulkCreateStallsResult> {
    return this.stalls.bulkCreate(admin, body);
  }

  @Patch(':id')
  update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateStallDto,
  ): Promise<Stall> {
    return this.stalls.update(admin, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'ลบได้เมื่อไม่เคยมีการจอง — มีแล้วให้ PATCH isActive=false แทน (RESOURCE_IN_USE)',
  })
  remove(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.stalls.remove(admin, id);
  }
}
