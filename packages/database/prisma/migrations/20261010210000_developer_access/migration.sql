ALTER TABLE "Session" ADD COLUMN "developerAccessMode" TEXT NOT NULL DEFAULT 'actual';
ALTER TABLE "Session" ADD CONSTRAINT "Session_developerAccessMode_check"
  CHECK ("developerAccessMode" IN ('actual', 'guest', 'user', 'trial', 'subscriber'));
