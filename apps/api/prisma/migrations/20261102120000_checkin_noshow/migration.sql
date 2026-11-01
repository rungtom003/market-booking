-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "noshow_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "market_days" ADD COLUMN     "noshow_processed_at" TIMESTAMPTZ(6);

