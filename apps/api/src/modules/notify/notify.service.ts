import { Injectable, Logger } from '@nestjs/common';
import type { VendorStatus } from '@market-booking/shared';
import { EventChannel } from '../../common/event-channel';

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
 * ตอนนี้ยังไม่ส่ง LINE/SMS (ห้าม throw: การแจ้งเตือนล้มต้องไม่ทำให้ flow หลักล้ม)
 * ช่องทางในระบบ (realtime 4.3) subscribe ด้วย `onVendorStatusChanged`
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);
  private readonly vendorStatus = new EventChannel<VendorStatusChangedEvent>(
    'vendor.status_changed',
    this.logger,
  );

  onVendorStatusChanged(listener: (event: VendorStatusChangedEvent) => void): () => void {
    return this.vendorStatus.on(listener);
  }

  async vendorStatusChanged(event: VendorStatusChangedEvent): Promise<void> {
    this.logger.debug(
      `vendorStatusChanged ${event.vendorId}: ${event.from ?? 'NEW'} → ${event.to} (not sent yet — Phase 7)`,
    );
    this.vendorStatus.emit([event]);
  }
}
