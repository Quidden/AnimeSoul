-- Keep existing integer scores and allow the explicit lowest rating, zero.
ALTER TABLE "LibraryItem" DROP CONSTRAINT "LibraryItem_score_check";
ALTER TABLE "LibraryItem" ADD CONSTRAINT "LibraryItem_score_check" CHECK ("score" IS NULL OR "score" BETWEEN 0 AND 10);
ALTER TABLE "LibraryRating" DROP CONSTRAINT "LibraryRating_score_check";
ALTER TABLE "LibraryRating" ADD CONSTRAINT "LibraryRating_score_check" CHECK ("score" BETWEEN 0 AND 10);
