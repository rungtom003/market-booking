-- AlterTable
ALTER TABLE "markets" ADD COLUMN     "layout_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "map_background_h" INTEGER,
ADD COLUMN     "map_background_key" VARCHAR(300),
ADD COLUMN     "map_background_w" INTEGER;

-- CreateTable
CREATE TABLE "map_features" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "label" VARCHAR(100),
    "pos_x" DECIMAL(10,2) NOT NULL,
    "pos_y" DECIMAL(10,2) NOT NULL,
    "width" DECIMAL(10,2) NOT NULL,
    "height" DECIMAL(10,2) NOT NULL,
    "rot" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "map_features_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "map_features_market_id_sort_order_idx" ON "map_features"("market_id", "sort_order");

-- AddForeignKey
ALTER TABLE "map_features" ADD CONSTRAINT "map_features_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

