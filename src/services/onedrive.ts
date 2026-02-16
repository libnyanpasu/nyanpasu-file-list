import { OnedriveService } from "@/lib/onedrive";
import { getOnedriveSetting, getCacheStoragePath } from "@/utils/env";

let cachedOnedriveClient: OnedriveService | null = null;

export const getOnedriveClient = async () => {
  if (cachedOnedriveClient) {
    return cachedOnedriveClient;
  }

  const settings = getOnedriveSetting();

  if (!settings) {
    throw new Error("Onedrive settings not found, please configure it first");
  }

  cachedOnedriveClient = new OnedriveService(settings);

  return cachedOnedriveClient;
};

export const uploadFileStream = async (
  fileStream: ReadableStream<Uint8Array>,
  fileSize: number,
  filename: string,
) => {
  const client = await getOnedriveClient();

  const result = await client.uploadReadableStream(fileStream, filename, fileSize);

  if (!result) {
    throw new Error("Failed to upload file");
  }

  return result;
};

export const createUploadSession = async (filename: string) => {
  const client = await getOnedriveClient();
  return client.createUploadSessionForFile(filename);
};

export const uploadChunkToSession = async (
  uploadUrl: string,
  chunk: Uint8Array,
  start: number,
  end: number,
  totalSize: number,
) => {
  const client = await getOnedriveClient();
  return client.uploadChunkToSession(uploadUrl, chunk, start, end, totalSize);
};

export const getFile = async (path: string) => {
  const client = await getOnedriveClient();

  const file = await client.getFile(path);

  return file;
};

const requireCacheStoragePath = (): string => {
  const path = getCacheStoragePath();
  if (!path) {
    throw new Error("ONEDRIVE_CACHE_STORAGE_PATH is not configured");
  }
  return path;
};

export const uploadCacheFile = async (body: Uint8Array, key: string) => {
  const client = await getOnedriveClient();
  const basePath = requireCacheStoragePath();
  return client.uploadWithBasePath(body, key, basePath);
};

export const getCacheFile = async (key: string) => {
  const client = await getOnedriveClient();
  const basePath = requireCacheStoragePath();
  return client.getFileWithBasePath(key, basePath);
};

export const deleteCacheFile = async (key: string) => {
  const client = await getOnedriveClient();
  const basePath = requireCacheStoragePath();
  return client.deleteFile(key, basePath);
};

// export const getFile = ac
//   .inputSchema(ImageSchema.pick({ id: true, filename: true }))
//   .action(async ({ parsedInput }) => {
//     const client = await getOnedriveClient();

//     const path = await getOnedrivePathSetting();

//     if (!path) {
//       throw new Error(
//         "Onedrive path settings not found, please configure it first",
//       );
//     }

//     const [, format] = parsedInput.filename.split(".");

//     const result = await client.getLink(
//       `${path.value}/${parsedInput.id}.${format}`,
//     );

//     if (!result) {
//       throw new Error("Failed to get file");
//     }

//     return result;
//   });
