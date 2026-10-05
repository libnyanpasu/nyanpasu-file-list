import { env } from "cloudflare:workers";
import { kysely } from "@/lib/kysely";
import { archiveFileId } from "@/lib/archive";
import {
  canonicalTelegramManifest,
  type TelegramBuildInput,
} from "@/lib/telegram";
import {
  ArchiveConflictError,
  getArchiveBuild,
  planArchiveFolderPath,
} from "./archive-index";

/** Authenticated CI supplies receipts from successful MTProto document uploads. */
export const registerTelegramBuild = async (build: TelegramBuildInput) => {
  const manifest = canonicalTelegramManifest(build);
  const existing = await kysely
    .selectFrom("archive_builds")
    .select("manifest_json")
    .where("build_id", "=", build.buildId)
    .executeTakeFirst();
  if (existing) {
    if (existing.manifest_json !== manifest) {
      throw new ArchiveConflictError(
        "Telegram build is already registered with a different manifest",
      );
    }
    return getArchiveBuild(build.buildId);
  }
  const { folderId, folderStatements } = await planArchiveFolderPath(
    build.folderPath,
  );
  const ids = await Promise.all(
    build.artifacts.map(({ fileName }) =>
      archiveFileId(build.buildId, fileName),
    ),
  );
  const statements = [
    ...folderStatements,
    env.D1.prepare(
      `INSERT INTO archive_builds
      (build_id, item_identifier, channel, commit_sha, tag, target, folder_path,
       artifact_count, manifest_json, status, diagnostics_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', '[]', ?)`,
    ).bind(
      build.buildId,
      build.buildId,
      build.channel,
      build.commit,
      build.tag,
      build.target ?? null,
      build.folderPath,
      build.artifacts.length,
      manifest,
      build.publishedAt,
    ),
    ...build.artifacts.map((artifact, index) =>
      env.D1.prepare(
        `INSERT INTO files
      (id, file_name, file_size, mime_type, hidden, folder_id, storage_provider,
       storage_item, storage_key, build_id, status, sha256, md5, created_at)
      VALUES (?, ?, ?, 'application/octet-stream', 0, ?, 'telegram', 'ClashNyanpasu', ?, ?, 'ready', ?, ?, ?)`,
      ).bind(
        ids[index],
        artifact.fileName,
        artifact.fileSize,
        folderId,
        String(artifact.messageId),
        build.buildId,
        artifact.sha256,
        artifact.md5,
        build.publishedAt,
      ),
    ),
    // Keep legacy rows, but avoid duplicate IA entries for the same archived bytes.
    ...build.artifacts.map((artifact) =>
      env.D1.prepare(
        `UPDATE files SET hidden = 1
      WHERE storage_provider = 'ia' AND folder_id = ? AND file_name = ?
        AND file_size = ? AND sha256 = ?`,
      ).bind(folderId, artifact.fileName, artifact.fileSize, artifact.sha256),
    ),
  ];
  try {
    await env.D1.batch(statements);
  } catch (error) {
    const winner = await kysely
      .selectFrom("archive_builds")
      .select("manifest_json")
      .where("build_id", "=", build.buildId)
      .executeTakeFirst();
    if (winner?.manifest_json === manifest)
      return getArchiveBuild(build.buildId);
    if (winner)
      throw new ArchiveConflictError(
        "Telegram build is already registered with a different manifest",
      );
    throw error;
  }
  return getArchiveBuild(build.buildId);
};
