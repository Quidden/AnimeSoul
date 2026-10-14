import { createHash } from "node:crypto";
import { ConflictException, ForbiddenException, BadRequestException } from "@nestjs/common";
import type { Database, DatabaseTransaction, Prisma } from "@animesoul/database";
export type Write = { operationId: string; reason: string; version?: number };
export async function operation(
  db: Database,
  actorId: string,
  action: string,
  input: Write,
  run: (
    tx: DatabaseTransaction,
    owner: boolean,
  ) => Promise<{ objectId: string; details?: Prisma.InputJsonValue }>,
) {
  const requestHash = createHash("sha256")
    .update(JSON.stringify({ actorId, action, input }))
    .digest("hex");
  await db.$transaction(async (tx) => {
    // One ordered lock protects last-admin checks, repeated requests and all administrative edits.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(1095978060)::text`;
    const actor = await tx.user.findUnique({ where: { id: actorId }, include: { roles: true } });
    if (!actor || actor.disabledAt || !actor.roles.some((r) => ["owner", "admin"].includes(r.role)))
      throw new ForbiddenException("Доступ отозван.");
    const previous = await tx.auditEvent.findUnique({ where: { operationId: input.operationId } });
    if (previous) {
      if (previous.requestHash !== requestHash)
        throw new ConflictException("Идентификатор операции уже использован.");
      return;
    }
    const change = await run(
      tx,
      actor.roles.some((r) => r.role === "owner"),
    );
    await tx.auditEvent.create({
      data: {
        actorId,
        action,
        objectId: change.objectId,
        reason: input.reason,
        operationId: input.operationId,
        requestHash,
        ...(change.details ? { details: change.details } : {}),
      },
    });
  });
}
export function version(actual: number, expected: number) {
  if (actual !== expected)
    throw new ConflictException("Данные изменились. Обновите страницу перед сохранением.");
}
export function csv(rows: (string | number | null)[][]) {
  if (rows.length > 10001) throw new BadRequestException("Сузьте выборку до 10 000 строк.");
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? "");
            if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
