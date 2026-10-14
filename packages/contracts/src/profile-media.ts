export const avatarPresets = [
  { path: "/profile-presets/avatar-cat.svg", label: "Кот" },
  { path: "/profile-presets/avatar-kitsune.svg", label: "Кицунэ" },
  { path: "/profile-presets/avatar-moon.svg", label: "Луна" },
  { path: "/profile-presets/avatar-orbit.svg", label: "Орбита" },
] as const;
export const bannerPresets = [
  { path: "/profile-presets/banner-dawn.svg", label: "Рассвет" },
  { path: "/profile-presets/banner-night.svg", label: "Ночь" },
  { path: "/profile-presets/banner-sakura.svg", label: "Сакура" },
  { path: "/profile-presets/banner-stars.svg", label: "Звёзды" },
] as const;
import { z } from "zod";

export const profileMediaKindSchema = z.enum(["avatar", "banner"]);
export type ProfileMediaKind = z.infer<typeof profileMediaKindSchema>;
export const profileMediaLimits = {
  avatar: 5 * 1024 * 1024,
  banner: 10 * 1024 * 1024,
  dimension: 4096,
  pixels: 40_000_000,
  frames: 300,
} as const;
export const profileMediaTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const profileMediaAccept = ".jpg,.jpeg,.png,.webp,.gif";
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
export const uploadedProfileMediaPattern = new RegExp(
  `^/api/profile-media/(${uuid})/(avatar|banner)/(${uuid}\\.(?:jpg|png|webp|gif))$`,
);
export const uploadedProfileMediaSchema = z.string().regex(uploadedProfileMediaPattern);
export const giphyProfileMediaPattern = /^giphy:([a-zA-Z0-9]{1,64})$/;
export const giphyIdSchema = z.string().regex(/^[a-zA-Z0-9]{1,64}$/);

export function profileMediaValueSchema(kind: ProfileMediaKind) {
  const presets = kind === "avatar" ? avatarPresets : bannerPresets;
  return z.string().refine((value) => {
    const uploaded = uploadedProfileMediaPattern.exec(value);
    return (
      presets.some((preset) => preset.path === value) ||
      uploaded?.[2] === kind ||
      giphyProfileMediaPattern.test(value)
    );
  });
}
export const profileMediaEditSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("avatar"), value: profileMediaValueSchema("avatar").nullable() })
    .strict(),
  z
    .object({ kind: z.literal("banner"), value: profileMediaValueSchema("banner").nullable() })
    .strict(),
]);
export const profileMediaResultSchema = z.object({
  avatar: z.string().nullable(),
  banner: z.string().nullable(),
});
export type ProfileMedia = z.infer<typeof profileMediaResultSchema>;
