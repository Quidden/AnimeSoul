ALTER TABLE "User"
  ADD COLUMN "emailVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "googleSubject" TEXT,
  ADD COLUMN "authVersion" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");
CREATE TYPE "AccountTokenPurpose" AS ENUM ('verify', 'reset', 'change');
CREATE TABLE "AccountToken" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "purpose" "AccountTokenPurpose" NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "targetEmail" TEXT NOT NULL,
  "issuedVersion" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "AccountToken_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AccountToken_tokenHash_key" ON "AccountToken"("tokenHash");
CREATE UNIQUE INDEX "AccountToken_userId_purpose_key" ON "AccountToken"("userId", "purpose");
CREATE INDEX "AccountToken_expiresAt_idx" ON "AccountToken"("expiresAt");
CREATE TABLE "OAuthAttempt" (
  "stateHash" TEXT NOT NULL,
  "browserHash" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "verifierEncrypted" TEXT NOT NULL,
  "userId" UUID,
  "sessionHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  CONSTRAINT "OAuthAttempt_pkey" PRIMARY KEY ("stateHash"),
  CONSTRAINT "OAuthAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OAuthAttempt_expiresAt_idx" ON "OAuthAttempt"("expiresAt");
