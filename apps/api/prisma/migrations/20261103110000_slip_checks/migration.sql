-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "slip_check" VARCHAR(20),
ADD COLUMN     "slip_hash" CHAR(64),
ADD COLUMN     "slip_trans_ref" VARCHAR(40);

-- CreateIndex
CREATE UNIQUE INDEX "payments_slip_trans_ref_key" ON "payments"("slip_trans_ref");

-- CreateIndex
CREATE INDEX "payments_slip_hash_idx" ON "payments"("slip_hash");

