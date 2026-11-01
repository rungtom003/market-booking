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
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  Permission,
  Round,
  RoundDetail,
  StallDayOverride,
  addMarketDaysSchema,
  checkinWindowSchema,
  createRoundSchema,
  setStallDayOverrideSchema,
  updateMarketDaySchema,
  updateRoundSchema,
} from '@market-booking/shared';
import { createZodDto } from 'nestjs-zod';
import { CurrentAdmin, RequirePermission } from '../auth/decorators';
import type { AdminPrincipal } from '../auth/principal';
import { MarketDayService } from './market-day.service';
import { RoundService } from './round.service';

class CreateRoundDto extends createZodDto(createRoundSchema) {}
class UpdateRoundDto extends createZodDto(updateRoundSchema) {}
class AddMarketDaysDto extends createZodDto(addMarketDaysSchema) {}
class UpdateMarketDayDto extends createZodDto(updateMarketDaySchema) {}
class SetStallDayOverrideDto extends createZodDto(setStallDayOverrideSchema) {}
class CheckinWindowDto extends createZodDto(checkinWindowSchema) {}

@ApiTags('admin / rounds')
@ApiBearerAuth()
@RequirePermission(Permission.ROUNDS_MANAGE)
@Controller('admin/rounds')
export class RoundAdminController {
  constructor(
    private readonly rounds: RoundService,
    private readonly days: MarketDayService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'ทุกรอบของตลาด ใหม่สุดก่อน (ไม่แบ่งหน้า)' })
  list(@CurrentAdmin() admin: AdminPrincipal): Promise<Round[]> {
    return this.rounds.list(admin);
  }

  @Get(':id')
  get(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoundDetail> {
    return this.rounds.get(admin, id);
  }

  @Post()
  @ApiOperation({ summary: 'สร้างรอบ (DRAFT) — ไม่ระบุจำนวนล็อคต่อผู้ค้า = ใช้ค่าจาก Settings' })
  create(
    @CurrentAdmin() admin: AdminPrincipal,
    @Body() body: CreateRoundDto,
  ): Promise<RoundDetail> {
    return this.rounds.create(admin, body);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'แก้รอบ — open_at แก้ได้ก่อนเปิดจองเท่านั้น (ROUND_ALREADY_OPENED), close_at ≤ วันขายวันแรก',
  })
  update(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateRoundDto,
  ): Promise<RoundDetail> {
    return this.rounds.update(admin, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบได้เฉพาะรอบ DRAFT — รอบที่เผยแพร่แล้วใช้ยกเลิก' })
  remove(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.rounds.remove(admin, id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DRAFT → PUBLISHED (ต้องมีวันขาย และยังไม่เลยเวลาปิดจอง)' })
  publish(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoundDetail> {
    return this.rounds.publish(admin, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PUBLISHED → CANCELLED และยกเลิกทุกวันขายของรอบ' })
  cancel(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoundDetail> {
    return this.rounds.cancel(admin, id);
  }

  @Post(':id/market-days')
  @ApiOperation({
    summary:
      'เพิ่มวันขายหลายวัน (YYYY-MM-DD) — ซ้ำกับวันที่ยังไม่ยกเลิกของรอบใดๆ → MARKET_DATE_TAKEN',
  })
  addDays(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AddMarketDaysDto,
  ): Promise<RoundDetail> {
    return this.days.add(admin, id, body);
  }

  @Patch(':id/market-days/:dayId')
  @ApiOperation({ summary: 'ยกเลิก/คืนสถานะวันขาย' })
  updateDay(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Body() body: UpdateMarketDayDto,
  ): Promise<RoundDetail> {
    return this.days.update(admin, id, dayId, body);
  }

  @Put(':id/market-days/:dayId/checkin-window')
  @ApiOperation({ summary: 'ตั้งเวลาเปิด/ปิด check-in ของวันขาย (null = ทั้งวัน)' })
  setCheckinWindow(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
    @Body() body: CheckinWindowDto,
  ): Promise<RoundDetail> {
    return this.days.setCheckinWindow(admin, id, dayId, body);
  }

  @Delete(':id/market-days/:dayId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'ลบวันขายที่ไม่มีการจอง/คิว (ไม่งั้น RESOURCE_IN_USE)' })
  removeDay(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('dayId', ParseUUIDPipe) dayId: string,
  ): Promise<void> {
    return this.days.remove(admin, id, dayId);
  }
}

@ApiTags('admin / rounds')
@ApiBearerAuth()
@RequirePermission(Permission.ROUNDS_MANAGE)
@Controller('admin/market-days')
export class MarketDayAdminController {
  constructor(private readonly days: MarketDayService) {}

  @Get(':id/overrides')
  @ApiOperation({ summary: 'ล็อคที่ปิด/เปลี่ยนราคาเฉพาะวันนี้' })
  overrides(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StallDayOverride[]> {
    return this.days.overrides(admin, id);
  }

  @Put(':id/overrides/:stallId')
  @ApiOperation({
    summary: 'ตั้งค่าล็อคเฉพาะวัน — priceOverride: null + isClosed: false = ลบ (คืน null)',
  })
  setOverride(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stallId', ParseUUIDPipe) stallId: string,
    @Body() body: SetStallDayOverrideDto,
  ): Promise<StallDayOverride | null> {
    return this.days.setOverride(admin, id, stallId, body);
  }

  @Delete(':id/overrides/:stallId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeOverride(
    @CurrentAdmin() admin: AdminPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stallId', ParseUUIDPipe) stallId: string,
  ): Promise<void> {
    await this.days.setOverride(admin, id, stallId, { priceOverride: null, isClosed: false });
  }
}
