import type { VendorProfile, VendorSummary } from '@market-booking/shared';
import { Prisma } from '../../generated/prisma/client';
import type { VendorImageService } from './vendor-image.service';

export const VENDOR_PROFILE_SELECT = {
  id: true,
  marketId: true,
  firstName: true,
  lastName: true,
  phone: true,
  phoneVerifiedAt: true,
  lineUserId: true,
  address: true,
  shopName: true,
  productCategory: { select: { id: true, name: true } },
  status: true,
  rejectReason: true,
  suspendedUntil: true,
  idCardImageKey: true,
  shopImageKey: true,
  createdAt: true,
} satisfies Prisma.VendorSelect;

export type VendorProfileRow = Prisma.VendorGetPayload<{ select: typeof VENDOR_PROFILE_SELECT }>;

export async function toVendorProfile(
  row: VendorProfileRow,
  images: VendorImageService,
): Promise<VendorProfile> {
  return {
    id: row.id,
    marketId: row.marketId,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    phoneVerified: row.phoneVerifiedAt !== null,
    // ไม่ส่ง LINE user id ออกไป — บอกแค่ว่าผูกแล้วหรือยัง
    lineLinked: row.lineUserId !== null,
    address: row.address,
    shopName: row.shopName,
    productCategory: row.productCategory,
    status: row.status,
    rejectReason: row.rejectReason,
    suspendedUntil: row.suspendedUntil?.toISOString() ?? null,
    idCardImageUrl: await images.downloadUrl(row.idCardImageKey),
    shopImageUrl: await images.downloadUrl(row.shopImageKey),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toVendorSummary(row: {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  status: VendorSummary['status'];
  lineUserId: string | null;
}): VendorSummary {
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    status: row.status,
    lineLinked: row.lineUserId !== null,
  };
}
