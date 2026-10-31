import { Injectable, Logger } from '@nestjs/common';
import type { VendorStatus } from '@market-booking/shared';

export interface VendorStatusChangedEvent {
  vendorId: string;
  marketId: string;
  /** null = เพิ่งสมัคร */
  from: VendorStatus | null;
  to: VendorStatus;
  reason?: string | null;
  suspendedUntil?: Date | null;
}

/**
 * จุดเดียวที่ business logic เรียกเมื่อต้องแจ้งเตือน — Phase 7 จะใส่ queue + LINE/SMS template
 * ตอนนี้เป็น hook ว่าง (ห้าม throw: การแจ้งเตือนล้มต้องไม่ทำให้ flow หลักล้ม)
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);

  async vendorStatusChanged(event: VendorStatusChangedEvent): Promise<void> {
    this.logger.debug(
      `vendorStatusChanged ${event.vendorId}: ${event.from ?? 'NEW'} → ${event.to} (not sent yet — Phase 7)`,
    );
  }
}
