import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  ALLOWED_IMAGE_TYPES,
  AllowedImageType,
  ErrorCode,
  MAX_UPLOAD_BYTES,
  UploadRequestInput,
  UploadTicket,
  VendorImageKind,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { StorageService } from '../storage/storage.service';

/**
 * เจ้าของไฟล์ — ไฟล์ของใครอยู่ใต้ prefix ของคนนั้น ตรวจทุกครั้งก่อนผูก key กับบัญชี
 * (กันส่ง key ของคนอื่นมาแอบอ้างเป็นรูปบัตรตัวเอง)
 */
export type ImageOwner = { registrationId: string } | { vendorId: string };

const EXTENSION: Record<AllowedImageType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const KIND_PATH: Record<VendorImageKind, string> = { ID_CARD: 'id-card', SHOP: 'shop' };

// ไฟล์ขึ้นต้นด้วย byte เหล่านี้ — ตรวจว่าเป็นรูปจริง ไม่ใช่ไฟล์อื่นที่ตั้ง Content-Type หลอก
const MAGIC: Record<AllowedImageType, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) =>
    b.length >= 8 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) =>
    b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};

const KEY_PATTERN =
  /^vendors\/(reg-[0-9a-f-]{36}|[0-9a-f-]{36})\/(id-card|shop)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

@Injectable()
export class VendorImageService {
  private readonly logger = new Logger(VendorImageService.name);

  constructor(private readonly storage: StorageService) {}

  async createUpload(owner: ImageOwner, input: UploadRequestInput): Promise<UploadTicket> {
    const key = `${this.prefix(owner)}${KIND_PATH[input.kind]}/${randomUUID()}.${EXTENSION[input.contentType]}`;
    return this.storage.createUploadUrl(key, input.contentType, input.size);
  }

  /**
   * ตรวจก่อนบันทึก key ลงบัญชี: เป็นของ owner นี้, ประเภทรูปตรง kind, ไฟล์มีจริง, ≤ 5 MB, เป็นรูปจริง
   * ไฟล์ที่ไม่ผ่าน (ขนาด/ชนิด) ถูกลบทิ้ง
   */
  async assertUsable(owners: ImageOwner[], kind: VendorImageKind, key: string): Promise<void> {
    const match = KEY_PATTERN.exec(key);
    const ownedBy = owners.some((owner) => key.startsWith(this.prefix(owner)));
    if (!match || !ownedBy || match[2] !== KIND_PATH[kind]) {
      throw this.invalid(kind, 'File does not belong to you');
    }

    const info = await this.storage.stat(key);
    if (!info) throw this.invalid(kind, 'File has not been uploaded');

    const type = info.contentType as AllowedImageType | undefined;
    const typeOk = type !== undefined && (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
    const sizeOk = info.size > 0 && info.size <= MAX_UPLOAD_BYTES;
    const contentOk = typeOk && sizeOk && MAGIC[type](await this.storage.readStart(key, 12));
    if (!contentOk) {
      await this.storage.delete(key).catch((e) => this.logger.warn(`Delete ${key} failed: ${e}`));
      throw this.invalid(kind, 'File must be a JPEG, PNG or WebP image of 5 MB or less');
    }
  }

  /** presigned GET อายุสั้น; null ถ้าไม่มี key */
  downloadUrl(key: string | null): Promise<string | null> {
    return key ? this.storage.createDownloadUrl(key) : Promise.resolve(null);
  }

  private prefix(owner: ImageOwner): string {
    return 'registrationId' in owner
      ? `vendors/reg-${owner.registrationId}/`
      : `vendors/${owner.vendorId}/`;
  }

  private invalid(kind: VendorImageKind, message: string): AppException {
    return new AppException(ErrorCode.UPLOAD_INVALID, message, {
      field: kind === 'ID_CARD' ? 'idCardImageKey' : 'shopImageKey',
    });
  }
}
