ALTER TABLE "UserProfile" ADD COLUMN "profileAccess" TEXT NOT NULL DEFAULT 'private', ADD COLUMN "friendRequests" TEXT NOT NULL DEFAULT 'everyone';
UPDATE "UserProfile" SET "profileAccess" = 'public' WHERE "isPublic" = true;
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_access_check" CHECK ("profileAccess" IN ('public', 'friends', 'private')),
ADD CONSTRAINT "UserProfile_requests_check" CHECK ("friendRequests" IN ('everyone', 'nobody'));
CREATE TABLE "FriendRequest" (
  "lowId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "highId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "requestedBy" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("lowId", "highId"),
  CHECK ("lowId" < "highId"), CHECK ("requestedBy" = "lowId" OR "requestedBy" = "highId")
);
CREATE INDEX "FriendRequest_highId_idx" ON "FriendRequest"("highId");
CREATE TABLE "Friendship" (
  "lowId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "highId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("lowId", "highId"), CHECK ("lowId" < "highId")
);
CREATE INDEX "Friendship_highId_idx" ON "Friendship"("highId");
CREATE TABLE "Follow" (
  "followerId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "targetId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("followerId", "targetId"), CHECK ("followerId" <> "targetId")
);
CREATE INDEX "Follow_targetId_idx" ON "Follow"("targetId");
CREATE TABLE "UserBlock" (
  "blockerId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "targetId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("blockerId", "targetId"), CHECK ("blockerId" <> "targetId")
);
CREATE INDEX "UserBlock_targetId_idx" ON "UserBlock"("targetId");
