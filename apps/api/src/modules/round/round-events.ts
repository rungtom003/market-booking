import { Injectable, Logger } from '@nestjs/common';
import type { RoundStatus } from '@market-booking/shared';
import { EventChannel } from '../../common/event-channel';

/** รอบที่ผู้ค้าเห็นเปลี่ยน (เผยแพร่/แก้/ยกเลิก/วันขายเปลี่ยน) — 4.3 ส่ง `round:changed` */
export interface RoundChangedEvent {
  roundId: string;
  marketId: string;
  status: RoundStatus;
  openAt: Date;
  closeAt: Date;
}

/** Event ภายในของรอบการจอง (`round.changed`) — ส่งเฉพาะรอบที่ไม่ใช่ DRAFT (ผู้ค้าไม่เห็น DRAFT) */
@Injectable()
export class RoundEvents {
  private readonly channel = new EventChannel<RoundChangedEvent>(
    'round.changed',
    new Logger(RoundEvents.name),
  );

  onChanged(listener: (event: RoundChangedEvent) => void | Promise<void>): () => void {
    return this.channel.on(listener);
  }

  /** ไม่ส่งถ้ารอบยังเป็น DRAFT */
  emitChanged(round: RoundChangedEvent): void {
    if (round.status === 'DRAFT') return;
    this.channel.emit([round]);
  }
}
