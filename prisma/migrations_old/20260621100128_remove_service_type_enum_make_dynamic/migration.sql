-- First resolve the failed migration
ALTER TABLE "orders" ALTER COLUMN "service_type" DROP NOT NULL;
ALTER TABLE "price_history" ALTER COLUMN "service_type" DROP NOT NULL;

-- Convert serviceType enum to text on orders table
ALTER TABLE "orders" ALTER COLUMN "service_type" TYPE TEXT USING COALESCE("service_type"::TEXT, 'GROCERY');

-- Convert serviceType enum to text on price_history table  
ALTER TABLE "price_history" ALTER COLUMN "service_type" TYPE TEXT USING COALESCE("service_type"::TEXT, 'GROCERY');

-- Make NOT NULL again now that we have values
ALTER TABLE "orders" ALTER COLUMN "service_type" SET NOT NULL;
ALTER TABLE "price_history" ALTER COLUMN "service_type" SET NOT NULL;

-- Convert serviceTypes enum array to text array on buddies table
ALTER TABLE "buddies" ALTER COLUMN "service_types" TYPE TEXT[] USING "service_types"::TEXT[];

-- Add flowScreensCache column to service_configs
ALTER TABLE "service_configs" ADD COLUMN IF NOT EXISTS "flow_screens_cache" JSONB;

-- Drop the ServiceType enum now that nothing references it
DROP TYPE IF EXISTS "ServiceType";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "price_history_itemName_serviceType_idx" ON "price_history"("itemName", "serviceType");