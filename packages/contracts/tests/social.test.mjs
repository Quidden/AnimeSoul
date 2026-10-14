import test from "node:test";
import assert from "node:assert/strict";
import { canSee, readVisibility, socialActionSchema } from "../dist/social.js";
test("legacy visibility never becomes friends/public accidentally and invalid visibility fails closed", () => {
  assert.deepEqual(
    readVisibility({
      about: true,
      favorites: false,
      folders: false,
      ratings: false,
      statistics: false,
    }),
    {
      about: "public",
      favorites: "private",
      folders: "private",
      ratings: "private",
      statistics: "private",
      friends: "private",
      posts: "private",
      reviews: "private",
      comments: "private",
    },
  );
  assert.equal(readVisibility({ about: "everyone" }).about, "private");
  assert.equal(canSee("friends", false, false), false);
  assert.equal(canSee("friends", false, true), true);
  assert.equal(canSee("private", true, false), true);
  assert.equal(
    socialActionSchema.safeParse({ targetId: "fake", action: "request" }).success,
    false,
  );
});
