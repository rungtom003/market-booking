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

/** เจ้าหน้าที่ check-in การจองแล้ว (Phase 10) — realtime ส่ง `checkin:updated` */
export interface BookingCheckedInEvent {
  bookingId: string;
  marketId: string;
  marketDayId: string;
  stallId: string;
  vendorId: string;
  checkedInAt: Date;
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

  private readonly checkedInChannel = new EventChannel<BookingCheckedInEvent>(
    'booking.checked_in',
    new Logger(BookingEvents.name),
  );

  onCheckedIn(listener: (event: BookingCheckedInEvent) => void | Promise<void>): () => void {
    return this.checkedInChannel.on(listener);
  }

  emitCheckedIn(event: BookingCheckedInEvent): void {
    this.checkedInChannel.emit([event]);
  }
}
