import { SETTING_DEFAULTS } from '@market-booking/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '../src/generated/prisma/client';

/** bcrypt cost ตาม Overview §7.2 (admin_users.password_hash) */
const BCRYPT_COST = 12;

export interface SeedOptions {
  adminUsername: string;
  adminPassword: string;
}

export interface SeedResult {
  skipped: boolean;
  marketId: string;
}

const CATEGORIES = ['อาหาร', 'เครื่องดื่ม', 'เสื้อผ้า', 'ของใช้', 'อื่นๆ'];

/**
 * ข้อมูลเริ่มต้น: 1 ตลาด, SUPER_ADMIN 1 คน, ประเภทสินค้า, 2 โซน, 20 ล็อค, settings ค่า default
 * รันซ้ำได้ — ถ้ามีตลาดอยู่แล้วจะไม่สร้างซ้ำ
 */
export async function seed(prisma: PrismaClient, options: SeedOptions): Promise<SeedResult> {
  const existing = await prisma.market.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return { skipped: true, marketId: existing.id };

  const passwordHash = await bcrypt.hash(options.adminPassword, BCRYPT_COST);

  const marketId = await prisma.$transaction(async (tx) => {
    const market = await tx.market.create({
      data: { name: 'ตลาดนัดตัวอย่าง', address: 'กรุงเทพมหานคร' },
    });

    await tx.adminUser.create({
      data: {
        // SUPER_ADMIN ดูแลทุกตลาด จึงไม่ผูก market_id
        username: options.adminUsername,
        passwordHash,
        displayName: 'ผู้ดูแลระบบสูงสุด',
        role: 'SUPER_ADMIN',
      },
    });

    const categories = await Promise.all(
      CATEGORIES.map((name, sortOrder) =>
        tx.productCategory.create({ data: { marketId: market.id, name, sortOrder } }),
      ),
    );
    const foodCategoryIds = categories
      .filter((c) => c.name === 'อาหาร' || c.name === 'เครื่องดื่ม')
      .map((c) => c.id);

    const zones = [
      {
        prefix: 'A',
        name: 'โซนอาหาร',
        color: '#F59E0B',
        allowedCategoryIds: foodCategoryIds,
        price: 150,
      },
      // ว่าง = ขายได้ทุกประเภท
      { prefix: 'B', name: 'โซนทั่วไป', color: '#3B82F6', allowedCategoryIds: [], price: 120 },
    ];

    for (const [zoneIndex, z] of zones.entries()) {
      const zone = await tx.zone.create({
        data: {
          marketId: market.id,
          name: z.name,
          color: z.color,
          allowedCategoryIds: z.allowedCategoryIds,
          sortOrder: zoneIndex,
        },
      });

      // 10 ล็อคต่อโซน เรียงเป็นแถวเดียว ขนาดบนผัง 60x60 px เว้นช่อง 10 px
      await tx.stall.createMany({
        data: Array.from({ length: 10 }, (_, i) => ({
          marketId: market.id,
          zoneId: zone.id,
          code: `${z.prefix}${i + 1}`,
          widthM: 2,
          lengthM: 2,
          price: z.price,
          posX: 20 + i * 70,
          posY: 20 + zoneIndex * 120,
          shapeW: 60,
          shapeH: 60,
        })),
      });
    }

    await tx.systemSetting.createMany({
      data: Object.entries(SETTING_DEFAULTS).map(([key, value]) => ({
        marketId: market.id,
        key,
        // null ของ JSON ต้องใช้ Prisma.JsonNull (ไม่งั้น Prisma ถือว่าเป็น SQL NULL ซึ่ง column ไม่ยอม)
        value: value === null ? Prisma.JsonNull : value,
      })),
    });

    return market.id;
  });

  return { skipped: false, marketId };
}

function readOptions(): SeedOptions {
  const adminUsername = process.env.SEED_ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? '';
  const minLength = process.env.NODE_ENV === 'production' ? 12 : 8;
  if (adminPassword.length < minLength) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${minLength} characters`);
  }
  return { adminUsername, adminPassword };
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const options = readOptions();
    const result = await seed(prisma, options);
    console.log(
      result.skipped
        ? `Seed skipped: market ${result.marketId} already exists`
        : `Seeded market ${result.marketId} (SUPER_ADMIN: ${options.adminUsername})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
