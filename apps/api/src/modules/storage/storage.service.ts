import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import type { UploadTicket } from '@market-booking/shared';
import { AppConfigService } from '../../config/app-config.service';

/** presigned URL อายุสั้น (Overview §13) */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export interface StoredObjectInfo {
  size: number;
  contentType: string | undefined;
}

/**
 * ไฟล์ใน MinIO (S3-compatible) — bucket เป็น private, เข้าถึงผ่าน presigned URL เท่านั้น
 * ใช้ client 2 ตัว: ตัวภายในคุยกับ MinIO ตรง, ตัว signer ลงลายเซ็นด้วย host ที่ browser เห็น
 * (ลายเซ็นผูกกับ host — ถ้า browser เข้าผ่าน URL อื่น ต้องเซ็นด้วย URL นั้น)
 */
@Injectable()
export class StorageService implements OnApplicationShutdown {
  private readonly client: S3Client;
  private readonly signer: S3Client;
  readonly bucket: string;

  constructor(config: AppConfigService) {
    const scheme = config.get('MINIO_USE_SSL') ? 'https' : 'http';
    const internalUrl = `${scheme}://${config.get('MINIO_ENDPOINT')}:${config.get('MINIO_PORT')}`;
    const base = {
      region: 'us-east-1', // MinIO ไม่สนใจ region แต่ SDK บังคับให้มี
      forcePathStyle: true, // http://host/bucket/key (MinIO ไม่ใช้ subdomain ต่อ bucket)
      credentials: {
        accessKeyId: config.get('MINIO_ACCESS_KEY'),
        secretAccessKey: config.get('MINIO_SECRET_KEY'),
      },
      // SDK รุ่นใหม่ใส่ checksum (CRC32) ใน presigned PUT โดยอัตโนมัติ → browser ต้องส่ง checksum ด้วยถึงจะผ่าน
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    } as const;

    this.bucket = config.get('MINIO_BUCKET');
    this.client = new S3Client({ ...base, endpoint: internalUrl });
    this.signer = new S3Client({
      ...base,
      endpoint: config.get('MINIO_PUBLIC_URL') ?? internalUrl,
    });
  }

  /**
   * URL สำหรับ PUT ไฟล์ตรงจาก browser — Content-Type และ Content-Length อยู่ในลายเซ็น
   * จึงส่งไฟล์ที่ใหญ่กว่า/คนละชนิดกับที่ขอไว้ไม่ได้
   */
  async createUploadUrl(key: string, contentType: string, size: number): Promise<UploadTicket> {
    const url = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      key,
      url,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    };
  }

  createDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    });
  }

  /** null = ไม่มีไฟล์ */
  async stat(key: string): Promise<StoredObjectInfo | null> {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: head.ContentLength ?? 0, contentType: head.ContentType };
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404)
        return null;
      throw error;
    }
  }

  /** อ่าน n byte แรก (ตรวจ magic bytes ว่าเป็นรูปจริง) */
  async readStart(key: string, bytes: number): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    return Buffer.from((await res.Body?.transformToByteArray()) ?? []);
  }

  /** อ่านทั้งไฟล์ — ใช้กับไฟล์เล็กที่ตรวจขนาดแล้ว (เช่น สลิป ≤ 5 MB) */
  async read(key: string): Promise<{ body: Buffer; contentType: string }> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      body: Buffer.from((await res.Body?.transformToByteArray()) ?? []),
      contentType: res.ContentType ?? 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  onApplicationShutdown(): void {
    this.client.destroy();
    this.signer.destroy();
  }
}
