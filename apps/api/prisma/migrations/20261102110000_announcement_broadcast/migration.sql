-- AlterTable
ALTER TABLE "announcements" ADD COLUMN     "broadcast_line" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "broadcasted_at" TIMESTAMPTZ(6);

