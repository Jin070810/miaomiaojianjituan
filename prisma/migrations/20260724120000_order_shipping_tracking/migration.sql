-- Add optional fulfillment timestamps and courier tracking for redemption orders.
ALTER TABLE "RedemptionOrder"
  ADD COLUMN "fulfilledAt" TIMESTAMP(3),
  ADD COLUMN "trackingNumber" TEXT;
