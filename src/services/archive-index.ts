import { env } from "cloudflare:workers";
import { kysely } from "@/lib/kysely";
import {
  ArchiveBuildInput,
  archiveFileId,
  checkArchiveIndexIntegrity,
  canonicalArchiveManifest,
  checkIaMetadata,
  ExpectedArchiveFile,
  IaMetadataResponse,
  iaPublicDownloadUrl,
  probeIaPublicFile,
  resolveArchiveBuildPublishedAt,
} from "@/lib/archive";

interface ArchiveBuildRow {
  build_id: string;
  item_identifier: string;
  channel: "release" | "nightly";
  commit_sha: string;
  tag: string | null;
  target: string | null;
  folder_path: string;
  artifact_count: number;
  manifest_json: string;
  status: "pending" | "ready" | "failed";
  diagnostics_json: string;
  created_at: string;
  updated_at: string;
}

interface ArchiveFileRow {
  id: string;
  file_name: string;
  file_size: number;
  storage_key: string;
  status: "pending" | "ready" | "failed";
  sha256: string;
  md5: string;
}

const configValue = (key: string): string | undefined => {
  const value = (env as unknown as Record<string, string | undefined>)[key] ?? process.env[key];
  return value?.trim() || undefined;
};

const requiredConfig = () => {
  const itemPrefix = configValue("IA_ITEM_PREFIX");
  const uploader = configValue("IA_UPLOADER");
  if (!itemPrefix || !uploader) {
    throw new Error("IA_ITEM_PREFIX and IA_UPLOADER must be configured");
  }
  return { itemPrefix, uploader };
};

const itemMatchesProject = (item: string, prefix: string) =>
  item.startsWith(`${prefix}-`);

const mapWithConcurrency = async <T, R>(
  values: T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> => {
  const result = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await map(values[index]);
    }
  }));
  return result;
};

const responseForBuild = async (buildId: string) => {
  const build = await kysely
    .selectFrom("archive_builds")
    .selectAll()
    .where("build_id", "=", buildId)
    .executeTakeFirst() as ArchiveBuildRow | undefined;
  if (!build) return null;

  const files = await kysely
    .selectFrom("files")
    .select(["id", "file_name", "file_size", "storage_key", "status", "sha256", "md5"])
    .where("build_id", "=", buildId)
    .orderBy("file_name", "asc")
    .execute() as ArchiveFileRow[];

  let diagnostics: string[] = [];
  try {
    diagnostics = JSON.parse(build.diagnostics_json) as string[];
  } catch {
    diagnostics = ["Stored diagnostics could not be decoded"];
  }

  return {
    buildId: build.build_id,
    itemIdentifier: build.item_identifier,
    schemaVersion: 1 as const,
    target: build.target,
    channel: build.channel,
    commit: build.commit_sha,
    publishedAt: build.created_at,
    folderPath: build.folder_path,
    status: build.status,
    diagnostics,
    artifacts: files.map((file) => ({
      fileId: file.id,
      fileName: file.file_name,
      fileSize: file.file_size,
      storageKey: file.storage_key,
      downloadUrl: `https://archive.nyanpasu.org/bin/${file.id}`,
      status: file.status,
      sha256: file.sha256,
      md5: file.md5,
    })),
  };
};

const sameManifest = async (build: ArchiveBuildInput) => {
  const existing = await kysely
    .selectFrom("archive_builds")
    .select(["manifest_json"])
    .where("build_id", "=", build.buildId)
    .executeTakeFirst();
  if (!existing) return false;
  const retryManifest = resolveArchiveBuildPublishedAt(build, existing.manifest_json);
  return existing.manifest_json === canonicalArchiveManifest(retryManifest);
};

export class ArchiveConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveConflictError";
  }
}

export const registerArchiveBuild = async (build: ArchiveBuildInput) => {
  const { itemPrefix } = requiredConfig();
  if (!itemMatchesProject(build.itemIdentifier, itemPrefix)) {
    throw new ArchiveConflictError("itemIdentifier is outside the configured IA project prefix");
  }
  if (!build.folderPath.startsWith(`${build.channel}/`)) {
    throw new ArchiveConflictError("folderPath must start with its channel");
  }

  const alreadyRegistered = await sameManifest(build);
  if (alreadyRegistered) return responseForBuild(build.buildId);
  const existingBuild = await responseForBuild(build.buildId);
  if (existingBuild) {
    throw new ArchiveConflictError("buildId is already registered with a different manifest");
  }
  const existingItem = await kysely
    .selectFrom("archive_builds")
    .select("build_id")
    .where("item_identifier", "=", build.itemIdentifier)
    .executeTakeFirst();
  if (existingItem) {
    throw new ArchiveConflictError("itemIdentifier is already registered to another build");
  }

  const registeredBuild = resolveArchiveBuildPublishedAt(build);
  const manifestJson = canonicalArchiveManifest(registeredBuild);
  const { folderId, folderStatements } = await planArchiveFolderPath(build.folderPath);
  const fileIds = await Promise.all(build.artifacts.map(({ fileName }) => archiveFileId(build.buildId, fileName)));
  const statements = [
    ...folderStatements,
    env.D1.prepare(`INSERT INTO archive_builds
      (build_id, item_identifier, channel, commit_sha, tag, target, folder_path,
       artifact_count, manifest_json, status, diagnostics_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '[]', ?)`)
      .bind(
        registeredBuild.buildId,
        registeredBuild.itemIdentifier,
        registeredBuild.channel,
        registeredBuild.commit,
        registeredBuild.tag,
        registeredBuild.target ?? null,
        registeredBuild.folderPath,
        registeredBuild.artifacts.length,
        manifestJson,
        registeredBuild.publishedAt,
      ),
    ...build.artifacts.map((artifact, index) => env.D1.prepare(`INSERT INTO files
      (id, file_name, file_size, mime_type, hidden, folder_id, storage_provider,
       storage_item, storage_key, build_id, status, sha256, md5, created_at)
      VALUES (?, ?, ?, 'application/octet-stream', 0, ?, 'ia', ?, ?, ?, 'pending', ?, ?, ?)`)
      .bind(
        fileIds[index],
        artifact.fileName,
        artifact.fileSize,
        folderId,
        build.itemIdentifier,
        artifact.fileName,
        build.buildId,
        artifact.sha256,
        artifact.md5,
        registeredBuild.publishedAt,
      )),
  ];

  try {
    await env.D1.batch(statements);
  } catch (error) {
    // UUIDs are deterministic, so racing identical registrations converge on
    // one build and one set of file rows. Re-read after a uniqueness race.
    if (await sameManifest(build)) {
      return responseForBuild(build.buildId);
    }
    const itemOwner = await kysely
      .selectFrom("archive_builds")
      .select("build_id")
      .where("item_identifier", "=", build.itemIdentifier)
      .executeTakeFirst();
    if (itemOwner || (await responseForBuild(build.buildId))) {
      throw new ArchiveConflictError("buildId or itemIdentifier is already registered with a different manifest");
    }
    throw error;
  }

  return responseForBuild(build.buildId);
};

const planArchiveFolderPath = async (path: string): Promise<{ folderId: string; folderStatements: D1PreparedStatement[] }> => {
  const segments = path.split("/");
  let parentId: string | null = null;
  const accumulated: string[] = [];
  const folderStatements: D1PreparedStatement[] = [];
  for (const name of segments) {
    accumulated.push(name);
    let existing: { id: string } | undefined;
    if (parentId === null) {
      existing = await kysely.selectFrom("folders").select("id")
        .where("name", "=", name).where("parent_id", "is", null)
        .executeTakeFirst();
    } else {
      existing = await kysely.selectFrom("folders").select("id")
        .where("name", "=", name).where("parent_id", "=", parentId)
        .executeTakeFirst();
    }
    if (existing) {
      parentId = existing.id;
      continue;
    }

    const deterministicId = await archiveFileId(`archive-folder:${accumulated.join("/")}`, "folder");
    folderStatements.push(env.D1.prepare(`INSERT INTO folders (id, name, parent_id)
      VALUES (?, ?, ?) ON CONFLICT DO NOTHING`)
      .bind(deterministicId, name, parentId));
    parentId = deterministicId;
  }
  if (!parentId) throw new Error("Archive folder path cannot be empty");
  return { folderId: parentId, folderStatements };
};

export const getArchiveBuild = (buildId: string) => responseForBuild(buildId);

const setPendingDiagnostics = async (buildId: string, diagnostics: string[]) => {
  await env.D1.prepare(`UPDATE archive_builds SET diagnostics_json = ?
    WHERE build_id = ? AND status = 'pending'`)
    .bind(JSON.stringify(diagnostics), buildId)
    .run();
};

const setFailed = async (buildId: string, diagnostics: string[]) => {
  await env.D1.batch([
    env.D1.prepare(`UPDATE archive_builds SET status = 'failed', diagnostics_json = ?
      WHERE build_id = ? AND status = 'pending'`)
      .bind(JSON.stringify(diagnostics), buildId),
    env.D1.prepare(`UPDATE files SET status = 'failed'
      WHERE build_id = ? AND status IN ('pending', 'ready')
        AND EXISTS (SELECT 1 FROM archive_builds WHERE build_id = ? AND status = 'failed')`)
      .bind(buildId, buildId),
  ]);
};

const setReadyAtomically = async (buildId: string) => {
  await env.D1.batch([
    env.D1.prepare(`UPDATE files SET status = 'ready'
      WHERE build_id = ? AND status = 'pending'
        AND EXISTS (
          SELECT 1 FROM archive_builds
          WHERE build_id = ? AND status = 'pending'
            AND (SELECT COUNT(*) FROM files WHERE build_id = ? AND status = 'pending') = artifact_count
        )`)
      .bind(buildId, buildId, buildId),
    env.D1.prepare(`UPDATE archive_builds SET status = 'ready', diagnostics_json = '[]'
      WHERE build_id = ? AND status = 'pending'
        AND (SELECT COUNT(*) FROM files WHERE build_id = ? AND status = 'ready') = artifact_count`)
      .bind(buildId, buildId),
  ]);
};

export const verifyArchiveBuild = async (buildId: string) => {
  const current = await responseForBuild(buildId);
  if (!current) return null;
  if (current.status !== "pending") return current;

  const storedBuild = await kysely
    .selectFrom("archive_builds")
    .select(["item_identifier", "artifact_count", "manifest_json"])
    .where("build_id", "=", buildId)
    .executeTakeFirst();
  if (!storedBuild) return null;
  const storedFiles = await kysely
    .selectFrom("files")
    .select([
      "id",
      "file_name",
      "file_size",
      "storage_provider",
      "storage_item",
      "storage_key",
      "build_id",
      "status",
      "sha256",
      "md5",
    ])
    .where("build_id", "=", buildId)
    .execute();
  const integrityDiagnostics = await checkArchiveIndexIntegrity(
    buildId,
    storedBuild.item_identifier,
    storedBuild.artifact_count,
    storedBuild.manifest_json,
    storedFiles,
  );
  if (integrityDiagnostics.length) {
    await setFailed(buildId, integrityDiagnostics);
    return responseForBuild(buildId);
  }

  const { itemPrefix, uploader } = requiredConfig();
  if (!itemMatchesProject(current.itemIdentifier, itemPrefix)) {
    await setFailed(buildId, ["Registered item is outside the configured IA project prefix"]);
    return responseForBuild(buildId);
  }

  let metadataResponse: Response;
  try {
    metadataResponse = await fetch(
      `https://archive.org/metadata/${encodeURIComponent(current.itemIdentifier)}`,
      { signal: AbortSignal.timeout(8_000), redirect: "error" },
    );
  } catch (error) {
    await setPendingDiagnostics(buildId, [error instanceof Error ? error.message : String(error)]);
    return responseForBuild(buildId);
  }
  if (!metadataResponse.ok) {
    await setPendingDiagnostics(buildId, [`IA metadata returned HTTP ${metadataResponse.status}`]);
    return responseForBuild(buildId);
  }

  let metadata: IaMetadataResponse;
  try {
    metadata = await metadataResponse.json() as IaMetadataResponse;
  } catch {
    await setPendingDiagnostics(buildId, ["IA metadata response was not valid JSON"]);
    return responseForBuild(buildId);
  }

  const expectedFiles: ExpectedArchiveFile[] = current.artifacts.map((artifact) => ({
    fileName: artifact.fileName,
    fileSize: artifact.fileSize,
    md5: artifact.md5,
  }));
  const metadataCheck = checkIaMetadata(current.itemIdentifier, uploader, expectedFiles, metadata);
  if (metadataCheck.status === "failed") {
    await setFailed(buildId, metadataCheck.diagnostics);
    return responseForBuild(buildId);
  }
  if (metadataCheck.status === "pending") {
    await setPendingDiagnostics(buildId, metadataCheck.diagnostics);
    return responseForBuild(buildId);
  }

  const probes = await mapWithConcurrency(current.artifacts, 3, async (artifact) => ({
    fileName: artifact.fileName,
    result: await probeIaPublicFile(
      iaPublicDownloadUrl(current.itemIdentifier, artifact.storageKey),
      artifact.fileSize,
    ),
  }));
  const failed = probes.filter(({ result }) => result.status === "failed");
  const pending = probes.filter(({ result }) => result.status === "pending");
  if (failed.length) {
    await setFailed(buildId, failed.map(({ fileName, result }) =>
      `${fileName}: ${result.status === "failed" ? result.diagnostic : ""}`
    ));
    return responseForBuild(buildId);
  }
  if (pending.length) {
    await setPendingDiagnostics(buildId, pending.map(({ fileName, result }) =>
      `${fileName}: ${result.status === "pending" ? result.diagnostic : ""}`
    ));
    return responseForBuild(buildId);
  }

  await setReadyAtomically(buildId);
  return responseForBuild(buildId);
};
