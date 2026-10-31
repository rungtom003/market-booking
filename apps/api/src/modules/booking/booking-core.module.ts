import { Module } from '@nestjs/common';
import { BookingEvents } from './booking-events';
import { BookingStateService } from './booking-state.service';

/**
 * ส่วนกลางของการจองที่ module อื่นใช้ได้โดยไม่วนกลับ (เช่น round ยกเลิกรอบ → ยกเลิกการจอง)
 * ต้องมี instance เดียวทั้งแอป — module อื่น import ตัวนี้ ห้ามใส่ใน providers เอง
 */
@Module({
  providers: [BookingStateService, BookingEvents],
  exports: [BookingStateService, BookingEvents],
})
export class BookingCoreModule {}
