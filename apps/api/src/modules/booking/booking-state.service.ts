import { Injectable } from '@nestjs/common';
import { BookingStatus, ErrorCode, canTransition } from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { BOOKING_FIELDS, BookingEventRow, BookingRow, EVENT_FIELDS } from './booking-mapper';

type BookingDb = Pick<Prisma.TransactionClient, 'booking'>;

/**
 * เปลี่ยนสถานะการจองตาราง Overview §8.2 — ทุกครั้งเป็น `UPDATE … WHERE status IN (from)`
 * แล้วตรวจจำนวนแถว ถ้า user กับ worker ชนกัน ฝั่งที่มาทีหลังได้ `INVALID_STATE_TRANSITION`
 */
@Injectable()
export class BookingStateService {
  async transition(
    db: BookingDb,
    bookingId: string,
    from: readonly BookingStatus[],
    to: BookingStatus,
    data: Omit<Prisma.BookingUncheckedUpdateManyInput, 'status' | 'version'> = {},
    where: Prisma.BookingWhereInput = {},
  ): Promise<BookingRow> {
    for (const f of from) {
      // ตารางผิด = bug ในโค้ด ไม่ใช่ input ของผู้ใช้
      if (!canTransition(f, to)) throw new Error(`Booking transition ${f} → ${to} is not allowed`);
    }
    const { count } = await db.booking.updateMany({
      where: { ...where, id: bookingId, status: { in: [...from] } },
      data: { ...data, status: to, version: { increment: 1 } },
    });
    if (count === 0) {
      throw new AppException(
        ErrorCode.INVALID_STATE_TRANSITION,
        `Booking is no longer ${from.join('/')}`,
        { to },
      );
    }
    return db.booking.findUniqueOrThrow({ where: { id: bookingId }, select: BOOKING_FIELDS });
  }

  /**
   * HOLD/PENDING_PAYMENT ที่หมดเวลาแล้ว → EXPIRED (เฉพาะแถวที่ตรง `where`)
   * ตอนจองเรียกก่อน INSERT ให้ล็อคที่หมดเวลาแล้วจองใหม่ได้ทันที ไม่ต้องรอ worker (4.2)
   */
  async expireLapsed(
    db: BookingDb,
    where: Prisma.BookingWhereInput,
    now: Date,
  ): Promise<BookingEventRow[]> {
    const data = { status: BookingStatus.EXPIRED, version: { increment: 1 } };
    const holds = await db.booking.updateManyAndReturn({
      where: { ...where, status: BookingStatus.HOLD, holdExpiresAt: { lte: now } },
      data,
      select: EVENT_FIELDS,
    });
    const unpaid = await db.booking.updateManyAndReturn({
      where: { ...where, status: BookingStatus.PENDING_PAYMENT, paymentDueAt: { lte: now } },
      data,
      select: EVENT_FIELDS,
    });
    return [...holds, ...unpaid];
  }
}
