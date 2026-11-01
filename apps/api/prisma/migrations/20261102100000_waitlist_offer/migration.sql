-- AlterTable
ALTER TABLE "waitlists" ADD COLUMN     "offer_booking_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "waitlists_offer_booking_id_key" ON "waitlists"("offer_booking_id");

-- AddForeignKey
ALTER TABLE "waitlists" ADD CONSTRAINT "waitlists_offer_booking_id_fkey" FOREIGN KEY ("offer_booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

