import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  profileMediaLimits,
  uploadedProfileMediaPattern,
  type ProfileMediaKind,
} from "@animesoul/contracts";
import { AuthService, type AuthRequest } from "../auth/auth.service.js";
import { visiblePeople } from "../social/access.js";

const formats = { jpeg: "jpg", png: "png", webp: "webp", gif: "gif" } as const;
export const profileMediaMime = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
} as const;

/** Decode every frame for validation, then retain the original bytes and animation. */
export async function validateProfileMedia(bytes: Buffer, kind: ProfileMediaKind) {
  if (!bytes.length) throw new BadRequestException("Выберите непустой файл.");
  if (bytes.length > profileMediaLimits[kind])
    throw new HttpException(
      `Файл слишком большой. Максимум ${profileMediaLimits[kind] / 1024 / 1024} МБ.`,
      413,
    );
  // Reject vector/document inputs before asking the image decoder to open them.
  const signature = bytes.subarray(0, 12);
  const raster =
    signature.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ||
    signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    ["GIF87a", "GIF89a"].includes(signature.subarray(0, 6).toString("ascii")) ||
    (signature.subarray(0, 4).toString("ascii") === "RIFF" &&
      signature.subarray(8, 12).toString("ascii") === "WEBP");
  if (!raster) throw new BadRequestException("Поддерживаются только JPEG, PNG, WebP и GIF.");
  try {
    const image = sharp(bytes, {
      animated: true,
      limitInputPixels: profileMediaLimits.pixels,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.pageHeight ?? metadata.height ?? 0;
    const frames = metadata.pages ?? 1;
    if (
      !width ||
      !height ||
      width > profileMediaLimits.dimension ||
      height > profileMediaLimits.dimension ||
      frames > profileMediaLimits.frames ||
      width * height * frames > profileMediaLimits.pixels ||
      !(metadata.format && metadata.format in formats)
    )
      throw new Error("Image limits exceeded.");
    await image.timeout({ seconds: 10 }).stats();
    return formats[metadata.format as keyof typeof formats];
  } catch {
    throw new BadRequestException(
      "Изображение повреждено или превышает лимиты: 4096 × 4096, 300 кадров и 40 млн пикселей суммарно.",
    );
  }
}

@Injectable()
export class ProfileMediaService {
  private readonly root: string;
  private processing = 0;
  constructor(@Inject(AuthService) private readonly auth: AuthService) {
    this.root = auth.config.PROFILE_MEDIA_DIR
      ? path.resolve(auth.config.PROFILE_MEDIA_DIR)
      : fileURLToPath(new URL("../../../../artifacts/profile-media/", import.meta.url));
  }
  private filename(value: string) {
    const match = uploadedProfileMediaPattern.exec(value);
    if (!match) throw new NotFoundException();
    return path.join(this.root, match[1]!, match[2]!, match[3]!);
  }
  async assertOwned(value: string | null | undefined, userId: string, kind: ProfileMediaKind) {
    if (!value?.startsWith("/api/profile-media/")) return;
    const match = uploadedProfileMediaPattern.exec(value);
    if (!match || match[1] !== userId || match[2] !== kind)
      throw new BadRequestException(
        "Можно использовать только собственные загруженные изображения.",
      );
    try {
      if (!(await stat(this.filename(value))).isFile()) throw new Error("Missing image.");
    } catch {
      throw new BadRequestException("Изображение больше недоступно. Загрузите его снова.");
    }
  }
  assertCurrent(value: string | null | undefined, current: string | null) {
    if (value?.startsWith("/api/profile-media/") && value !== current)
      throw new BadRequestException(
        "Изображение уже заменено. Обновите страницу или загрузите файл снова.",
      );
  }
  async removeOwned(value: string | null, userId: string, kind: ProfileMediaKind) {
    const match = value && uploadedProfileMediaPattern.exec(value);
    if (!match || match[1] !== userId || match[2] !== kind) return;
    await unlink(this.filename(value!)).catch(() => {});
  }
  private async save(userId: string, kind: ProfileMediaKind, value: string | null, upload = false) {
    return this.auth.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR UPDATE`;
      const previous = await tx.userProfile.findUniqueOrThrow({
        where: { userId },
        select: { avatar: true, banner: true },
      });
      await this.assertOwned(value, userId, kind);
      if (!upload) this.assertCurrent(value, previous[kind]);
      const media = await tx.userProfile.update({
        where: { userId },
        data: { [kind]: value },
        select: { avatar: true, banner: true },
      });
      await tx.auditEvent.create({
        data: { actorId: userId, action: "profile.media-updated", objectId: userId },
      });
      return { previous: previous[kind], media };
    });
  }
  async change(request: AuthRequest, kind: ProfileMediaKind, value: string | null) {
    const { userId } = await this.auth.writeSession(request);
    const result = await this.save(userId, kind, value);
    if (result.previous !== value) await this.removeOwned(result.previous, userId, kind);
    return result.media;
  }
  async upload(request: AuthRequest, kind: ProfileMediaKind, bytes: unknown) {
    const { userId } = await this.auth.writeSession(request);
    if (!Buffer.isBuffer(bytes)) throw new BadRequestException("Ожидается файл изображения.");
    if (this.processing >= 2)
      throw new HttpException(
        "Обработка изображений занята. Повторите через несколько секунд.",
        429,
      );
    this.processing++;
    let value: string | undefined;
    let committed = false;
    try {
      const extension = await validateProfileMedia(bytes, kind);
      value = `/api/profile-media/${userId}/${kind}/${randomUUID()}.${extension}`;
      const filename = this.filename(value);
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(filename, bytes, { flag: "wx" });
      const result = await this.save(userId, kind, value, true);
      committed = true;
      await this.removeOwned(result.previous, userId, kind);
      return result.media;
    } finally {
      this.processing--;
      if (value && !committed) await this.removeOwned(value, userId, kind);
    }
  }
  async read(request: AuthRequest, value: string) {
    const match = uploadedProfileMediaPattern.exec(value);
    if (!match) throw new NotFoundException();
    let viewer: string | undefined;
    try {
      viewer = (await this.auth.requireSession(request)).userId;
    } catch (error) {
      if (!(error instanceof UnauthorizedException)) throw error;
    }
    const record = await this.auth.db.userProfile.findFirst({
      where: { AND: [{ userId: match[1]! }, visiblePeople(viewer)] },
      select: { avatar: true, banner: true },
    });
    const kind = match[2] as ProfileMediaKind;
    if (!record || record[kind] !== value) throw new NotFoundException();
    try {
      return {
        bytes: await readFile(this.filename(value)),
        type: profileMediaMime[match[3]!.split(".").at(-1)! as keyof typeof profileMediaMime],
      };
    } catch {
      throw new NotFoundException();
    }
  }
}
