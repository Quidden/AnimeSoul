ALTER TABLE "AnalyticsEvent" ADD COLUMN "value" INTEGER;
ALTER TABLE "AnalyticsEvent" ADD COLUMN "limit" INTEGER;
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationCampaign" ADD CONSTRAINT "NotificationCampaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
