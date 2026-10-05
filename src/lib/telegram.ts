import { z } from "zod";
import { ArchiveBuildInputSchema, artifactSchema } from "./archive";

export const telegramMessageUrl = (messageId: number): string => {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    throw new Error("Invalid Telegram message id");
  }
  return `https://t.me/ClashNyanpasu/${messageId}`;
};

// Keep Telegram identities separate from previously registered IA inventories.
export const TelegramBuildInputSchema = z
  .object({
    ...ArchiveBuildInputSchema.shape,
    schemaVersion: z.literal(2),
    storageProvider: z.literal("telegram"),
    buildId: z
      .string()
      .max(128)
      .regex(/^tg-[a-zA-Z0-9._-]+$/),
    itemIdentifier: z.literal("ClashNyanpasu"),
    publishedAt: z.string().datetime(),
    artifacts: z
      .array(
        artifactSchema.extend({
          messageId: z.number().int().positive().safe(),
          documentId: z.string().regex(/^[0-9]+$/),
        }),
      )
      .min(1)
      .max(12),
  })
  .superRefine((build, context) => {
    if (!build.folderPath.startsWith(`${build.channel}/`)) {
      context.addIssue({
        code: "custom",
        path: ["folderPath"],
        message: "folderPath must start with its channel",
      });
    }
    if (
      (build.channel === "release" && !build.tag) ||
      (build.channel === "nightly" && build.tag !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["tag"],
        message: "tag must match the publication channel",
      });
    }
    if (
      new Set(build.artifacts.map((artifact) => artifact.fileName)).size !==
      build.artifacts.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "file names must be unique",
      });
    }
    const ids = build.artifacts.map((artifact) => artifact.messageId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["artifacts"],
        message: "Telegram message ids must be unique",
      });
    }
  });

export type TelegramBuildInput = z.infer<typeof TelegramBuildInputSchema>;

export const canonicalTelegramManifest = (build: TelegramBuildInput): string =>
  JSON.stringify({
    ...build,
    artifacts: [...build.artifacts].sort((a, b) =>
      a.fileName.localeCompare(b.fileName),
    ),
  });
