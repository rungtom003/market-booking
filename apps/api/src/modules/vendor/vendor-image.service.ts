import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import {
  ErrorCode,
  UploadRequestInput,
  UploadTicket,
  VendorImageKind,
} from '@market-booking/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { IMAGE_EXTENSION, checkUploadedImage } from '../storage/image-file';
import { StorageService } from '../storage/storage.service';

/**
 * เจ้าของไฟล์ — ไฟล์ของใครอยู่ใต้ prefix ของคนนั้น ตรวจทุกครั้งก่อนผูก key กับบัญชี
 * (กันส่ง key ของคนอื่นมาแอบอ้างเป็นรูปบัตรตัวเอง)
 */
export type ImageOwner = { registrationId: string } | { vendorId: string };

const KIND_PATH: Record<VendorImageKind, string> = { ID_CARD: 'id-card', SHOP: 'shop' };

const KEY_PATTERN =
  /^vendors\/(reg-[0-9a-f-]{36}|[0-9a-f-]{36})\/(id-card|shop)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

@Injectable()
export class VendorImageService {
  private readonly logger = new Logger(VendorImageService.name);

  constructor(private readonly storage: StorageService) {}

  async createUpload(owner: ImageOwner, input: UploadRequestInput): Promise<UploadTicket> {
    const key = `${this.prefix(owner)}${KIND_PATH[input.kind]}/${randomUUID()}.${IMAGE_EXTENSION[input.contentType]}`;
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

    const result = await checkUploadedImage(this.storage, key, (e) =>
      this.logger.warn(`Delete ${key} failed: ${String(e)}`),
    );
    if (result === 'missing') throw this.invalid(kind, 'File has not been uploaded');
    if (result === 'invalid') {
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
