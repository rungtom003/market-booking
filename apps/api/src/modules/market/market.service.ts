import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MarketService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ตลาดหลัก — ระยะแรกระบบมีตลาดเดียว (Overview §15 Open Questions)
   * ใช้เมื่อผู้ใช้ไม่ได้ผูกตลาด (SUPER_ADMIN) หรือไม่ได้ระบุ
   */
  async getDefaultMarketId(): Promise<string> {
    const market = await this.prisma.market.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!market) throw new AppException(ErrorCode.NOT_FOUND, 'No active market configured');
    return market.id;
  }

  /** ตลาดที่ admin คนนี้ทำงานอยู่ */
  async resolveForAdmin(admin: { marketId: string | null }): Promise<string> {
    return admin.marketId ?? this.getDefaultMarketId();
  }

  async assertExists(marketId: string): Promise<void> {
    const found = await this.prisma.market.count({ where: { id: marketId } });
    if (!found) throw new AppException(ErrorCode.NOT_FOUND, 'Market not found');
  }
}
