import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AppConfigService } from '../../config/app-config.service';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { isRetryable } from './delivery-error';
import { LineMessagingProvider, toFlexMessage } from './line/line-messaging.provider';
import { NotificationQueue, SEND_ATTEMPTS, SEND_JOB, type SendJobData } from './notification.queue';
import { SMS_PROVIDER } from './sms/sms.provider';
import type { SmsProvider } from './sms/sms.provider';
import { type NotificationTemplate, renderTemplate } from './templates';

export const NotificationChannel = { LINE: 'LINE', SMS: 'SMS' } as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = {
  PENDING: 'PENDING',
  /** ส่งไม่ผ่านแบบชั่วคราว รอ BullMQ ลองใหม่ */
  RETRYING: 'RETRYING',
  SENT: 'SENT',
  FAILED: 'FAILED',
} as const;

/** ค้างนานกว่านี้โดยไม่มี job (Redis หาย/ใส่ job ไม่สำเร็จ) → ใส่ job ใหม่ */
export const STALE_AFTER_MS = 5 * 60_000;

/** ผู้ค้าที่จะรับข้อความ — มี LINE (และเปิดใช้ LINE OA) ส่ง LINE, ไม่มีส่ง SMS */
export interface VendorTarget {
  id: string;
  phone: string;
  lineUserId: string | null;
}

export interface VendorMessage {
  message: NotificationTemplate;
  /** กันส่งซ้ำ (unique ใน notification_logs) เช่น `booking.confirmed:<bookingId>` */
  dedupeKey?: string;
}

type LogRow = Prisma.NotificationLogGetPayload<object>;

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

/**
 * ส่งแจ้งเตือนผ่าน queue (Phase 7): บันทึก notification_logs ก่อน แล้วค่อยให้ worker ส่ง
 * → ผู้ให้บริการล่มไม่กระทบ flow หลัก, ส่งใหม่อัตโนมัติ, มี log ทุกข้อความ
 * เมธอดฝั่งใส่ข้อความไม่ throw (แจ้งเตือนล้มห้ามทำให้การจอง/อนุมัติล้ม)
 */
@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly settings: SettingsService,
    private readonly queue: NotificationQueue,
    private readonly line: LineMessagingProvider,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  onModuleInit(): void {
    this.queue.handle(SEND_JOB, (job) => this.deliver(job as Job<SendJobData>));
  }

  async toVendor(vendorId: string, message: NotificationTemplate, dedupeKey?: string) {
    try {
      const vendor = await this.prisma.vendor.findUnique({
        where: { id: vendorId },
        select: { id: true, phone: true, lineUserId: true },
      });
      if (vendor) await this.toVendors([vendor], () => ({ message, dedupeKey }));
    } catch (error) {
      this.logger.error(
        `Notify vendor ${vendorId} (${message.template}) failed: ${errorText(error)}`,
      );
    }
  }

  /** หลายคนในครั้งเดียว (เช่น แจ้งรอบเปิด) — คืนจำนวนข้อความใหม่ (ไม่นับที่เคยสร้างแล้วตาม dedupeKey) */
  async toVendors(
    vendors: readonly VendorTarget[],
    build: (vendor: VendorTarget) => VendorMessage,
  ): Promise<number> {
    try {
      const data = vendors.map((vendor) => {
        const { message, dedupeKey } = build(vendor);
        return {
          ...this.route(vendor),
          template: message.template,
          payload: message.params as Prisma.InputJsonObject,
          status: NotificationStatus.PENDING,
          dedupeKey: dedupeKey ?? null,
          vendorId: vendor.id,
        };
      });
      return await this.insertAndEnqueue(data);
    } catch (error) {
      this.logger.error(`Notify ${vendors.length} vendor(s) failed: ${errorText(error)}`);
      return 0;
    }
  }

  /** กลุ่ม LINE ของเจ้าหน้าที่ (`line_admin_group_id`) — ไม่ได้ตั้ง/ไม่มี LINE OA = ไม่ส่ง */
  async toAdminGroup(marketId: string, message: NotificationTemplate, dedupeKey?: string) {
    try {
      const groupId = await this.settings.get(marketId, 'line_admin_group_id');
      if (!groupId || !this.line.enabled) return;
      await this.insertAndEnqueue([
        {
          channel: NotificationChannel.LINE,
          recipient: groupId,
          template: message.template,
          payload: message.params as Prisma.InputJsonObject,
          status: NotificationStatus.PENDING,
          dedupeKey: dedupeKey ?? null,
          vendorId: null,
        },
      ]);
    } catch (error) {
      this.logger.error(`Notify admin group (${message.template}) failed: ${errorText(error)}`);
    }
  }

  /** worker: ส่ง 1 ข้อความ — ชั่วคราว → throw ให้ BullMQ ลองใหม่, ถาวร/ครบรอบ → FAILED (+ SMS แทน LINE) */
  async deliver(job: Job<SendJobData>): Promise<string> {
    const log = await this.prisma.notificationLog.findUnique({ where: { id: job.data.logId } });
    if (
      !log ||
      log.status === NotificationStatus.SENT ||
      log.status === NotificationStatus.FAILED
    ) {
      return 'skipped';
    }
    const attempts = log.attempts + 1;

    try {
      await this.dispatch(log);
    } catch (error) {
      const message = errorText(error);
      const final = !isRetryable(error) || job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: {
          attempts,
          error: message,
          status: final ? NotificationStatus.FAILED : NotificationStatus.RETRYING,
        },
      });
      if (!final) throw error;
      await this.fallbackToSms(log);
      return `failed: ${message}`;
    }

    await this.prisma.notificationLog.update({
      where: { id: log.id },
      data: { attempts, status: NotificationStatus.SENT, sentAt: new Date(), error: null },
    });
    return 'sent';
  }

  /** ข้อความที่ค้าง (ไม่มี job — Redis หาย/ใส่ job ไม่สำเร็จ) → ใส่ job ใหม่; คืนจำนวนที่ใส่ */
  async recoverStale(now: Date = new Date()): Promise<number> {
    const stale = await this.prisma.notificationLog.findMany({
      where: {
        status: { in: [NotificationStatus.PENDING, NotificationStatus.RETRYING] },
        updatedAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) },
      },
      select: { id: true, attempts: true },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    let requeued = 0;
    for (const log of stale) {
      // ลองมาแล้วเกิน 2 รอบเต็ม (เช่น render พังทุกครั้ง) — เลิก
      if (log.attempts >= SEND_ATTEMPTS * 2) {
        await this.prisma.notificationLog.update({
          where: { id: log.id },
          data: { status: NotificationStatus.FAILED },
        });
        continue;
      }
      await this.queue.enqueueSend(log.id);
      // updatedAt ขยับ — ไม่ถูกหยิบซ้ำทุกนาทีระหว่างรอ job
      await this.prisma.notificationLog.update({
        where: { id: log.id },
        data: { updatedAt: new Date() },
      });
      requeued += 1;
    }
    return requeued;
  }

  private route(vendor: VendorTarget): { channel: NotificationChannel; recipient: string } {
    return this.line.enabled && vendor.lineUserId
      ? { channel: NotificationChannel.LINE, recipient: vendor.lineUserId }
      : { channel: NotificationChannel.SMS, recipient: vendor.phone };
  }

  private async insertAndEnqueue(data: Prisma.NotificationLogCreateManyInput[]): Promise<number> {
    if (data.length === 0) return 0;
    // dedupeKey ซ้ำ = เคยสร้างแล้ว ข้ามไป (ส่งครั้งเดียวแม้ event/รอบเวลาซ้ำ)
    const created = await this.prisma.notificationLog.createManyAndReturn({
      data,
      skipDuplicates: true,
      select: { id: true },
    });
    for (const { id } of created) {
      // ใส่ job ไม่สำเร็จ (Redis ล่ม) — แถวยังเป็น PENDING, recoverStale ใส่ให้ภายหลัง
      await this.queue
        .enqueueSend(id)
        .catch((error: unknown) => this.logger.warn(`Enqueue ${id} failed: ${errorText(error)}`));
    }
    return created.length;
  }

  private async dispatch(log: LogRow): Promise<void> {
    const message = renderTemplate(
      { template: log.template, params: log.payload } as NotificationTemplate,
      { webOrigin: this.config.get('WEB_ORIGIN'), adminOrigin: this.config.get('ADMIN_ORIGIN') },
    );
    if (log.channel === NotificationChannel.LINE) {
      // id ของ log เป็น UUID — ใช้เป็น retry key ให้ LINE ไม่ส่งซ้ำเมื่อเราลองใหม่หลัง timeout
      await this.line.push(log.recipient, [toFlexMessage(message)], log.id);
    } else {
      await this.sms.send({ to: log.recipient, text: message.sms });
    }
  }

  /** LINE ส่งไม่ได้ (เช่น ผู้ค้ายังไม่เพิ่ม LINE OA เป็นเพื่อน) → ส่ง SMS แทน 1 ครั้ง */
  private async fallbackToSms(log: LogRow): Promise<void> {
    if (log.channel !== NotificationChannel.LINE || !log.vendorId) return;
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: log.vendorId },
      select: { phone: true },
    });
    if (!vendor) return;
    await this.insertAndEnqueue([
      {
        channel: NotificationChannel.SMS,
        recipient: vendor.phone,
        template: log.template,
        payload: log.payload as Prisma.InputJsonObject,
        status: NotificationStatus.PENDING,
        dedupeKey: `${log.dedupeKey ?? log.id}:sms`,
        vendorId: log.vendorId,
      },
    ]);
  }
}
