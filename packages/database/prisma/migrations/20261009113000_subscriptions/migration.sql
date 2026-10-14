CREATE TABLE "SubscriptionTrial" (
  "userId" UUID PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "discountRedeemedAt" TIMESTAMP(3),
  CONSTRAINT "SubscriptionTrial_dates_check" CHECK ("expiresAt" > "startedAt")
);
CREATE TABLE "SubscriptionPlan" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL,
  "months" INTEGER NOT NULL CHECK ("months" BETWEEN 1 AND 24),
  "amountMinor" INTEGER CHECK ("amountMinor" BETWEEN 1 AND 10000000),
  "currency" CHAR(3) NOT NULL CHECK ("currency" IN ('UAH','USD','EUR')),
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE, "updatedAt" TIMESTAMP(3) NOT NULL
);
INSERT INTO "SubscriptionPlan" ("id","name","months","currency","updatedAt") VALUES
('monthly','На месяц',1,'UAH',CURRENT_TIMESTAMP),
('quarterly','На три месяца',3,'UAH',CURRENT_TIMESTAMP),
('yearly','На год',12,'UAH',CURRENT_TIMESTAMP);
CREATE TABLE "SubscriptionPromotion" (
  "id" UUID PRIMARY KEY, "name" TEXT NOT NULL,
  "percent" INTEGER NOT NULL CHECK ("percent" BETWEEN 1 AND 100),
  "months" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionPromotion_dates_check" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "SubscriptionPromotion_months_check" CHECK (array_position("months", NULL) IS NULL AND 0 < ALL("months") AND 25 > ALL("months") AND cardinality("months") <= 24)
);
CREATE INDEX "SubscriptionPromotion_enabled_startsAt_endsAt_idx" ON "SubscriptionPromotion"("enabled","startsAt","endsAt");
