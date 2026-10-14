-- Preserve a provider's episode label when a canonical Episode ID is not available.
ALTER TABLE "AnalyticsEvent" ADD COLUMN "episode" TEXT;
