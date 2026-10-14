ALTER TABLE "User" ADD COLUMN "lastActiveAt" TIMESTAMP(3), ADD COLUMN "adminVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AuditEvent" ADD COLUMN "details" JSONB, ADD COLUMN "operationId" UUID, ADD COLUMN "requestHash" TEXT;
ALTER TABLE "SubscriptionPlan" ADD COLUMN "description" TEXT NOT NULL DEFAULT '', ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "permissions" TEXT[] NOT NULL DEFAULT ARRAY['player.native']::TEXT[];
ALTER TABLE "SubscriptionPromotion" ADD COLUMN "description" TEXT NOT NULL DEFAULT '', ADD COLUMN "planIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Entitlement" ADD COLUMN "planId" TEXT, ADD COLUMN "createdAt" TIMESTAMP(3), ADD COLUMN "amountMinor" INTEGER, ADD COLUMN "currency" CHAR(3);
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "User_createdAt_id_idx" ON "User"("createdAt", "id");
CREATE INDEX "User_lastActiveAt_id_idx" ON "User"("lastActiveAt", "id");
CREATE INDEX "User_disabledAt_createdAt_idx" ON "User"("disabledAt", "createdAt");
CREATE INDEX "UserRole_role_userId_idx" ON "UserRole"("role", "userId");
CREATE INDEX "UserPermission_permission_userId_idx" ON "UserPermission"("permission", "userId");
CREATE UNIQUE INDEX "AuditEvent_operationId_key" ON "AuditEvent"("operationId");
CREATE INDEX "AuditEvent_actorId_createdAt_idx" ON "AuditEvent"("actorId", "createdAt");
CREATE INDEX "AuditEvent_objectId_createdAt_idx" ON "AuditEvent"("objectId", "createdAt");
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");
CREATE INDEX "Entitlement_planId_expiresAt_idx" ON "Entitlement"("planId", "expiresAt");

CREATE TABLE "AnalyticsEvent" (
  "id" UUID NOT NULL, "userId" UUID, "visitorId" VARCHAR(64) NOT NULL, "visitId" UUID NOT NULL,
  "kind" TEXT NOT NULL, "feature" TEXT, "path" TEXT, "animeId" UUID, "episodeId" UUID,
  "season" TEXT, "player" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AnalyticsEvent_createdAt_kind_idx" ON "AnalyticsEvent"("createdAt", "kind");
CREATE INDEX "AnalyticsEvent_userId_createdAt_idx" ON "AnalyticsEvent"("userId", "createdAt");
CREATE INDEX "AnalyticsEvent_animeId_createdAt_idx" ON "AnalyticsEvent"("animeId", "createdAt");
CREATE INDEX "AnalyticsEvent_kind_userId_createdAt_idx" ON "AnalyticsEvent"("kind", "userId", "createdAt");
CREATE INDEX "AnalyticsEvent_visitId_idx" ON "AnalyticsEvent"("visitId");

CREATE TABLE "Announcement" (
  "id" UUID NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'info',
  "scope" TEXT NOT NULL DEFAULT 'global', "animeId" UUID, "audience" TEXT NOT NULL DEFAULT 'all',
  "role" TEXT, "planId" TEXT, "link" TEXT, "dismissible" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 0, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Announcement_animeId_fkey" FOREIGN KEY ("animeId") REFERENCES "Anime"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Announcement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "Announcement_enabled_startsAt_endsAt_idx" ON "Announcement"("enabled", "startsAt", "endsAt");
CREATE INDEX "Announcement_scope_animeId_idx" ON "Announcement"("scope", "animeId");
CREATE TABLE "NotificationCampaign" (
  "id" UUID NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'info',
  "audience" TEXT NOT NULL DEFAULT 'authenticated', "role" TEXT, "planId" TEXT, "userId" UUID,
  "link" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT false,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "NotificationCampaign_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "NotificationCampaign_enabled_startsAt_endsAt_idx" ON "NotificationCampaign"("enabled", "startsAt", "endsAt");
CREATE TABLE "NotificationReceipt" (
  "userId" UUID NOT NULL, "campaignId" UUID NOT NULL, "readAt" TIMESTAMP(3) NOT NULL, "dismissedAt" TIMESTAMP(3),
  CONSTRAINT "NotificationReceipt_pkey" PRIMARY KEY ("userId", "campaignId"),
  CONSTRAINT "NotificationReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NotificationReceipt_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "NotificationCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "NotificationReceipt_campaignId_readAt_idx" ON "NotificationReceipt"("campaignId", "readAt");
CREATE TABLE "SiteSetting" (
  "key" TEXT NOT NULL, "value" JSONB NOT NULL, "version" INTEGER NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteSetting_pkey" PRIMARY KEY ("key")
);
INSERT INTO "SiteSetting" ("key", "value", "updatedAt") VALUES
  ('analytics.startedAt', to_jsonb(to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')), CURRENT_TIMESTAMP),
  ('appearance.winter', '{"mode":"off","snow":true,"intensity":35,"speed":1,"garlands":true,"startsAt":null,"endsAt":null}', CURRENT_TIMESTAMP);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "User_email_admin_search_idx" ON "User" USING GIN (lower("email") gin_trgm_ops);
CREATE INDEX "UserProfile_username_admin_search_idx" ON "UserProfile" USING GIN (lower("username") gin_trgm_ops);
ALTER TABLE "SubscriptionPlan" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SubscriptionPromotion" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;
