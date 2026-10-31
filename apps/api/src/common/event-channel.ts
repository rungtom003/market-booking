import type { Logger } from '@nestjs/common';

type Listener<T> = (event: T) => void | Promise<void>;

/**
 * event ภายใน process (เช่น `booking.changed`) — ผู้ส่งไม่ต้องรู้ว่าใครฟัง (queue, realtime, …)
 * ส่งหลัง commit เท่านั้น; listener พัง (sync หรือ async) แค่ log ไม่กระทบ request
 */
export class EventChannel<T> {
  private readonly listeners = new Set<Listener<T>>();

  constructor(
    private readonly name: string,
    private readonly logger: Logger,
  ) {}

  /** คืนฟังก์ชันยกเลิกการ subscribe */
  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(events: readonly T[]): void {
    for (const event of events) {
      for (const listener of this.listeners) {
        try {
          void Promise.resolve(listener(event)).catch((error: unknown) => this.fail(error));
        } catch (error) {
          this.fail(error);
        }
      }
    }
  }

  private fail(error: unknown) {
    this.logger.error(
      `${this.name} listener failed: ${String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
  }
}
