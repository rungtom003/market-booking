import { Injectable, Logger } from '@nestjs/common';
import type { BookingStatus } from '@market-booking/shared';

/** การจองเปลี่ยนสถานะ (commit แล้ว) — 4.2 ตั้ง/ลบ job หมดเวลา, 4.3 ส่ง `stall:updated`/`booking:changed` */
export interface BookingChangedEvent {
  bookingId: string;
  marketId: string;
  marketDayId: string;
  stallId: string;
  vendorId: string;
  status: BookingStatus;
  holdExpiresAt: Date | null;
  paymentDueAt: Date | null;
}

type Listener = (event: BookingChangedEvent) => void | Promise<void>;

/**
 * Event ภายในของการจอง (`booking.changed`) — Service ไม่เรียก Gateway/Queue ตรง
 * ส่งหลัง transaction commit เท่านั้น; listener พังไม่ทำให้ request พัง (log ไว้)
 */
@Injectable()
export class BookingEvents {
  private readonly logger = new Logger(BookingEvents.name);
  private readonly listeners = new Set<Listener>();

  /** คืนฟังก์ชันยกเลิกการ subscribe */
  onChanged(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitChanged(events: BookingChangedEvent[]): void {
    for (const event of events) {
      for (const listener of this.listeners) {
        try {
          void Promise.resolve(listener(event)).catch((error: unknown) => this.fail(event, error));
        } catch (error) {
          this.fail(event, error);
        }
      }
    }
  }

  private fail(event: BookingChangedEvent, error: unknown) {
    this.logger.error(
      `booking.changed listener failed for ${event.bookingId}: ${String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
