-- DropIndex
DROP INDEX "market_days_market_id_market_date_key";

-- CreateIndex
CREATE UNIQUE INDEX "uq_market_day_date" ON "market_days"("market_id", "market_date") WHERE (NOT is_cancelled);

