-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'STAFF', 'FINANCE');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('HOLD', 'PENDING_PAYMENT', 'PENDING_VERIFY', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'FULFILLED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "markets" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "address" TEXT NOT NULL,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Bangkok',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "allowed_category_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "width_m" DECIMAL(5,2) NOT NULL,
    "length_m" DECIMAL(5,2) NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "pos_x" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pos_y" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "rot" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "shape_w" DECIMAL(10,2) NOT NULL,
    "shape_h" DECIMAL(10,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_reserved" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stalls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "phone_verified_at" TIMESTAMPTZ(6),
    "line_user_id" VARCHAR(64),
    "address" TEXT NOT NULL,
    "shop_name" VARCHAR(200),
    "product_category_id" UUID,
    "id_card_image_key" VARCHAR(255),
    "shop_image_key" VARCHAR(255),
    "pdpa_consent_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "VendorStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMPTZ(6),
    "reject_reason" TEXT,
    "suspended_until" TIMESTAMPTZ(6),
    "noshow_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "market_id" UUID,
    "username" VARCHAR(50) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "role" "AdminRole" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_rounds" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "open_at" TIMESTAMPTZ(6) NOT NULL,
    "close_at" TIMESTAMPTZ(6) NOT NULL,
    "max_stalls_per_vendor" INTEGER NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_days" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "market_date" DATE NOT NULL,
    "checkin_open_at" TIMESTAMPTZ(6),
    "checkin_close_at" TIMESTAMPTZ(6),
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "market_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stall_day_overrides" (
    "id" UUID NOT NULL,
    "stall_id" UUID NOT NULL,
    "market_day_id" UUID NOT NULL,
    "price_override" DECIMAL(10,2),
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "stall_day_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "stall_id" UUID NOT NULL,
    "market_day_id" UUID NOT NULL,
    "status" "BookingStatus" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "hold_expires_at" TIMESTAMPTZ(6),
    "payment_due_at" TIMESTAMPTZ(6),
    "confirmed_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "cancelled_by_admin_id" UUID,
    "checked_in_at" TIMESTAMPTZ(6),
    "checkin_token" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "booking_id" UUID NOT NULL,
    "method" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "slip_image_key" VARCHAR(255),
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "verified_by" UUID,
    "verified_at" TIMESTAMPTZ(6),
    "reject_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlists" (
    "id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "market_day_id" UUID NOT NULL,
    "stall_id" UUID,
    "zone_id" UUID,
    "position" INTEGER NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "notified_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "waitlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "publish_at" TIMESTAMPTZ(6) NOT NULL,
    "expire_at" TIMESTAMPTZ(6),
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50) NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "recipient" VARCHAR(100) NOT NULL,
    "template" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_categories_market_id_sort_order_idx" ON "product_categories"("market_id", "sort_order");

-- CreateIndex
CREATE INDEX "zones_market_id_sort_order_idx" ON "zones"("market_id", "sort_order");

-- CreateIndex
CREATE INDEX "stalls_zone_id_idx" ON "stalls"("zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "stalls_market_id_code_key" ON "stalls"("market_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_line_user_id_key" ON "vendors"("line_user_id");

-- CreateIndex
CREATE INDEX "vendors_market_id_status_created_at_idx" ON "vendors"("market_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "vendors_market_id_phone_key" ON "vendors"("market_id", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_username_key" ON "admin_users"("username");

-- CreateIndex
CREATE INDEX "booking_rounds_market_id_status_open_at_idx" ON "booking_rounds"("market_id", "status", "open_at");

-- CreateIndex
CREATE INDEX "market_days_round_id_idx" ON "market_days"("round_id");

-- CreateIndex
CREATE UNIQUE INDEX "market_days_market_id_market_date_key" ON "market_days"("market_id", "market_date");

-- CreateIndex
CREATE INDEX "stall_day_overrides_market_day_id_idx" ON "stall_day_overrides"("market_day_id");

-- CreateIndex
CREATE UNIQUE INDEX "stall_day_overrides_stall_id_market_day_id_key" ON "stall_day_overrides"("stall_id", "market_day_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_checkin_token_key" ON "bookings"("checkin_token");

-- CreateIndex
CREATE INDEX "ix_bookings_vendor_day" ON "bookings"("vendor_id", "market_day_id") WHERE (status IN ('HOLD','PENDING_PAYMENT','PENDING_VERIFY','CONFIRMED'));

-- CreateIndex
CREATE INDEX "ix_bookings_hold_exp" ON "bookings"("hold_expires_at") WHERE (status = 'HOLD');

-- CreateIndex
CREATE INDEX "ix_bookings_pay_due" ON "bookings"("payment_due_at") WHERE (status = 'PENDING_PAYMENT');

-- CreateIndex
CREATE INDEX "bookings_market_day_id_status_idx" ON "bookings"("market_day_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_active_booking" ON "bookings"("stall_id", "market_day_id") WHERE (status IN ('HOLD','PENDING_PAYMENT','PENDING_VERIFY','CONFIRMED'));

-- CreateIndex
CREATE INDEX "payments_booking_id_idx" ON "payments"("booking_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "waitlists_market_day_id_status_position_idx" ON "waitlists"("market_day_id", "status", "position");

-- CreateIndex
CREATE INDEX "waitlists_vendor_id_idx" ON "waitlists"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_market_id_key_key" ON "system_settings"("market_id", "key");

-- CreateIndex
CREATE INDEX "announcements_market_id_publish_at_idx" ON "announcements"("market_id", "publish_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_actor_id_idx" ON "audit_logs"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "notification_logs_status_created_at_idx" ON "notification_logs"("status", "created_at");

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zones" ADD CONSTRAINT "zones_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls" ADD CONSTRAINT "stalls_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls" ADD CONSTRAINT "stalls_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_product_category_id_fkey" FOREIGN KEY ("product_category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_users" ADD CONSTRAINT "admin_users_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_rounds" ADD CONSTRAINT "booking_rounds_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_rounds" ADD CONSTRAINT "booking_rounds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_days" ADD CONSTRAINT "market_days_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_days" ADD CONSTRAINT "market_days_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "booking_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stall_day_overrides" ADD CONSTRAINT "stall_day_overrides_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stall_day_overrides" ADD CONSTRAINT "stall_day_overrides_market_day_id_fkey" FOREIGN KEY ("market_day_id") REFERENCES "market_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_market_day_id_fkey" FOREIGN KEY ("market_day_id") REFERENCES "market_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_admin_id_fkey" FOREIGN KEY ("cancelled_by_admin_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_fkey" FOREIGN KEY ("verified_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlists" ADD CONSTRAINT "waitlists_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlists" ADD CONSTRAINT "waitlists_market_day_id_fkey" FOREIGN KEY ("market_day_id") REFERENCES "market_days"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlists" ADD CONSTRAINT "waitlists_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlists" ADD CONSTRAINT "waitlists_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_settings" ADD CONSTRAINT "system_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
