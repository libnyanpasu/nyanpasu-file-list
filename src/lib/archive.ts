import { z } from "zod";

const artifactSchema = z.object({
  fileName: z
    .string()
    .min(1)
    .max(240)
    .refine((name) => name === name.trim() && name !== "." && name !== "..")
    .refine((name) => !/[\\/\u0000-\u001f\u007f]/.test(name)),
  fileSize: z.number().int().positive().safe(),
  sha256: z.string().regex(/^[a-fA-F0-9]{64}$/).transform((value) => value.toLowerCase()),
  md5: z.string().regex(/^[a-fA-F0-9]{32}$/).transform((value) => value.toLowerCase()),
});

export const ArchiveBuildInputSchema = z.object({
  schemaVersion: z.literal(1),
  buildId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9._-]+$/),
  itemIdentifier: z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/),
  channel: z.enum(["release", "nightly"]),
  commit: z.string().regex(/^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/).transform((value) => value.toLowerCase()),
  publishedAt: z.string().datetime().optional(),
  tag: z.string().min(1).max(128).nullable(),
  target: z.string().min(1).max(64).optional().nullable(),
  folderPath: z.string().min(1).max(256).regex(/^[a-zA-Z0-9._+~/-]+$/).refine((path) => {
    const segments = path.split("/");
    return segments.length > 0 && segments.every((segment) => segment && segment !== "." && segment !== "..");
  }),
  artifacts: z.array(artifactSchema).min(1).max(12),
}).superRefine((build, context) => {
  if (build.channel === "release" && !build.tag) {
    context.addIssue({ code: "custom", path: ["tag"], message: "release builds require a tag" });
  }
  if (build.channel === "nightly" && build.tag !== null) {
    context.addIssue({ code: "custom", path: ["tag"], message: "nightly builds must have a null tag" });
  }
  const names = new Set<string>();
  for (const [index, artifact] of build.artifacts.entries()) {
    if (names.has(artifact.fileName)) {
      context.addIssue({ code: "custom", path: ["artifacts", index, "fileName"], message: "file names must be unique" });
    }
    names.add(artifact.fileName);
  }
});

export type ArchiveBuildInput = z.infer<typeof ArchiveBuildInputSchema>;

export const canonicalArchiveManifest = (build: ArchiveBuildInput): string =>
  JSON.stringify({
    schemaVersion: build.schemaVersion,
    buildId: build.buildId,
    itemIdentifier: build.itemIdentifier,
    channel: build.channel,
    commit: build.commit,
    ...(build.publishedAt === undefined ? {} : { publishedAt: build.publishedAt }),
    tag: build.tag,
    target: build.target ?? null,
    folderPath: build.folderPath,
    artifacts: [...build.artifacts].sort((a, b) => a.fileName.localeCompare(b.fileName)),
  });

/** Reuse a persisted timestamp for retries that omit it; old manifests remain byte-compatible. */
export const resolveArchiveBuildPublishedAt = (
  build: ArchiveBuildInput,
  existingManifestJson?: string,
  fallbackTimestamp?: string,
): ArchiveBuildInput => {
  if (build.publishedAt !== undefined) return build;
  if (existingManifestJson !== undefined) {
    try {
      const existing = ArchiveBuildInputSchema.parse(JSON.parse(existingManifestJson));
      return existing.publishedAt === undefined
        ? build
        : { ...build, publishedAt: existing.publishedAt };
    } catch {
      return build;
    }
  }
  return { ...build, publishedAt: fallbackTimestamp ?? new Date().toISOString() };
};

/** RFC 4122 name-based UUID for stable ids across concurrent registration retries. */
export const archiveFileId = async (buildId: string, fileName: string): Promise<string> => {
  const namespace = Uint8Array.from([
    0x6b, 0xa7, 0xb8, 0x10, 0x9d, 0xad, 0x11, 0xd1,
    0x80, 0xb4, 0x00, 0xc0, 0x4f, 0xd4, 0x30, 0xc8,
  ]);
  const name = new TextEncoder().encode(`${buildId}\0${fileName}`);
  const input = new Uint8Array(namespace.length + name.length);
  input.set(namespace);
  input.set(name, namespace.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const iaPublicDownloadUrl = (item: string, key: string): string =>
  `https://archive.org/download/${encodeURIComponent(item)}/${key
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;

export interface IaMetadataFile {
  name: string;
  size?: string | number;
  md5?: string;
}

export interface IaMetadataResponse {
  metadata?: { identifier?: string; uploader?: string };
  files?: IaMetadataFile[];
}

export interface ExpectedArchiveFile {
  fileName: string;
  fileSize: number;
  md5: string;
}

export type MetadataCheck =
  | { status: "ready"; diagnostics: string[] }
  | { status: "pending"; diagnostics: string[] }
  | { status: "failed"; diagnostics: string[] };

export const checkIaMetadata = (
  itemIdentifier: string,
  expectedUploader: string,
  expectedFiles: ExpectedArchiveFile[],
  metadata: IaMetadataResponse,
): MetadataCheck => {
  if (metadata.metadata?.identifier && metadata.metadata.identifier !== itemIdentifier) {
    return { status: "failed", diagnostics: ["IA item identifier does not match the registered item"] };
  }
  if (!metadata.metadata?.identifier || !metadata.metadata.uploader) {
    return { status: "pending", diagnostics: ["IA has not published complete item metadata"] };
  }
  if (!expectedUploader || metadata.metadata.uploader !== expectedUploader) {
    return { status: "failed", diagnostics: ["IA item uploader does not match the configured uploader"] };
  }

  const remoteFiles = new Map((metadata.files ?? []).map((file) => [file.name, file]));
  const pending: string[] = [];
  const failed: string[] = [];
  for (const expected of expectedFiles) {
    const remote = remoteFiles.get(expected.fileName);
    if (!remote) {
      pending.push(`IA has not indexed ${expected.fileName}`);
      continue;
    }
    if (remote.size === undefined || !remote.md5) {
      pending.push(`IA has not indexed size and MD5 for ${expected.fileName}`);
      continue;
    }
    if (Number(remote.size) !== expected.fileSize) {
      failed.push(`IA size mismatch for ${expected.fileName}`);
    }
    if (remote.md5?.toLowerCase() !== expected.md5.toLowerCase()) {
      failed.push(`IA MD5 mismatch for ${expected.fileName}`);
    }
  }
  if (failed.length) return { status: "failed", diagnostics: failed };
  if (pending.length) return { status: "pending", diagnostics: pending };
  return { status: "ready", diagnostics: [] };
};

const allowedDownloadHost = (host: string) =>
  host === "archive.org" ||
  host === "www.archive.org" ||
  /^ia\d+\.us\.archive\.org$/i.test(host) ||
  /^dn\d+\.ca\.archive\.org$/i.test(host);

const followIaHead = async (
  initialUrl: string,
  method: "HEAD" | "GET",
  fetcher: typeof fetch,
  signal: AbortSignal,
): Promise<Response> => {
  let url = new URL(initialUrl);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (url.protocol !== "https:" || !allowedDownloadHost(url.hostname)) {
      throw new Error("IA download redirected to a non-IA host");
    }
    const response = await fetcher(url, {
      method,
      redirect: "manual",
      signal,
      ...(method === "GET" ? { headers: { Range: "bytes=0-0" } } : {}),
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects === 3) throw new Error("Invalid IA redirect response");
    url = new URL(location, url);
  }
  throw new Error("Too many IA download redirects");
};

export type DownloadProbe = { status: "ready" } | { status: "pending"; diagnostic: string } | { status: "failed"; diagnostic: string };

export interface ArchiveFileIntegrityRecord {
  id: string;
  file_name: string;
  file_size: number;
  storage_provider: string;
  storage_item: string | null;
  storage_key: string | null;
  build_id: string | null;
  status: string;
  sha256: string | null;
  md5: string | null;
}

export const checkArchiveIndexIntegrity = async (
  buildId: string,
  itemIdentifier: string,
  artifactCount: number,
  manifestJson: string,
  files: ArchiveFileIntegrityRecord[],
): Promise<string[]> => {
  const diagnostics: string[] = [];
  let manifest: ArchiveBuildInput;
  try {
    const parsed = ArchiveBuildInputSchema.safeParse(JSON.parse(manifestJson));
    if (!parsed.success) throw new Error(parsed.error.message);
    manifest = parsed.data;
  } catch (error) {
    return [`Stored build manifest is invalid: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (
    manifest.buildId !== buildId ||
    manifest.itemIdentifier !== itemIdentifier ||
    manifest.artifacts.length !== artifactCount ||
    canonicalArchiveManifest(manifest) !== manifestJson
  ) {
    diagnostics.push("Stored build metadata does not match its immutable manifest");
  }
  if (files.length !== artifactCount) {
    diagnostics.push(`Indexed file count ${files.length} does not match manifest count ${artifactCount}`);
  }

  const filesByName = new Map<string, ArchiveFileIntegrityRecord>();
  for (const file of files) {
    if (filesByName.has(file.file_name)) diagnostics.push(`Duplicate indexed file ${file.file_name}`);
    filesByName.set(file.file_name, file);
  }
  for (const artifact of manifest.artifacts) {
    const file = filesByName.get(artifact.fileName);
    if (!file) {
      diagnostics.push(`Indexed file row is missing for ${artifact.fileName}`);
      continue;
    }
    if (
      file.file_size !== artifact.fileSize ||
      file.storage_provider !== "ia" ||
      file.storage_item !== itemIdentifier ||
      file.storage_key !== artifact.fileName ||
      file.build_id !== buildId ||
      file.sha256 !== artifact.sha256 ||
      file.md5 !== artifact.md5 ||
      file.status !== "pending"
    ) {
      diagnostics.push(`Indexed file row does not match immutable manifest for ${artifact.fileName}`);
    }
    if (file.id !== await archiveFileId(buildId, artifact.fileName)) {
      diagnostics.push(`Indexed file ID is not deterministic for ${artifact.fileName}`);
    }
  }
  return [...new Set(diagnostics)];
};

export const probeIaPublicFile = async (
  url: string,
  expectedSize: number,
  fetcher: typeof fetch = fetch,
): Promise<DownloadProbe> => {
  try {
    const signal = AbortSignal.timeout(8_000);
    let response = await followIaHead(url, "HEAD", fetcher, signal);
    if (response.status === 405 || response.status === 501) {
      await response.body?.cancel();
      response = await followIaHead(url, "GET", fetcher, signal);
    }
    if (response.status === 404 || response.status === 403 || response.status >= 500) {
      await response.body?.cancel();
      return { status: "pending", diagnostic: `IA download probe returned HTTP ${response.status}` };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { status: "failed", diagnostic: `IA download probe returned HTTP ${response.status}` };
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/html")) {
      await response.body?.cancel();
      return { status: "failed", diagnostic: "IA download probe returned an HTML page" };
    }
    const lengthHeader = response.headers.get("content-length");
    const isRangeResponse = response.status === 206;
    if (lengthHeader && Number(lengthHeader) !== (isRangeResponse ? 1 : expectedSize)) {
      await response.body?.cancel();
      return { status: "failed", diagnostic: "IA download probe size does not match the manifest" };
    }
    if (response.status === 206) {
      const range = response.headers.get("content-range");
      if (!range || range !== `bytes 0-0/${expectedSize}`) {
        await response.body?.cancel();
        return { status: "failed", diagnostic: "IA range probe returned an invalid content range" };
      }
    }
    if (response.status !== 200 && response.status !== 206) {
      await response.body?.cancel();
      return { status: "failed", diagnostic: `IA download probe returned unexpected HTTP ${response.status}` };
    }
    await response.body?.cancel();
    return { status: "ready" };
  } catch (error) {
    return {
      status: "pending",
      diagnostic: error instanceof Error ? error.message : String(error),
    };
  }
};
