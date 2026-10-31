import { Injectable, Logger } from '@nestjs/common';
import type { BookingStatus } from '@market-booking/shared';
import { EventChannel } from '../../common/event-channel';

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

/** Event ภายในของการจอง (`booking.changed`) — Service ไม่เรียก Gateway/Queue ตรง */
@Injectable()
export class BookingEvents {
  private readonly channel = new EventChannel<BookingChangedEvent>(
    'booking.changed',
    new Logger(BookingEvents.name),
  );

  /** คืนฟังก์ชันยกเลิกการ subscribe */
  onChanged(listener: (event: BookingChangedEvent) => void | Promise<void>): () => void {
    return this.channel.on(listener);
  }

  emitChanged(events: readonly BookingChangedEvent[]): void {
    this.channel.emit(events);
  }
}
