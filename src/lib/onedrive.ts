import { z } from "zod";
import { formatError } from "@/utils/fmt";
import { fetchWithRetry, retry } from "@/utils/retry";

interface MicrosoftAuthenticationResponse {
  token_type: string;
  expires_in: string;
  ext_expires_in: string;
  expires_on: string;
  not_before: string;
  resource: string;
  access_token: string;
  error_description?: string;
}

export interface OneDriveFile {
  id: string;
  name: string;
  size: number;
  lastModifiedDateTime: string;
  file?: {
    mimeType: string;
  };
  parentReference?: {
    id: string;
    path: string;
  };
  "@microsoft.graph.downloadUrl"?: string;
}

export const OnedriveConfigSchema = z.object({
  clientID: z.string().nonempty(),
  clientSecret: z.string().nonempty(),
  tenantID: z.string().nonempty(),
  userEmail: z.email(),
  storagePath: z.string().nonempty(),
});

export type OnedriveConfig = z.infer<typeof OnedriveConfigSchema>;

const HOST = {
  oauth: "https://login.microsoftonline.com",
  api: "https://graph.microsoft.com",
};

const encodeGraphPath = (path: string) =>
  path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

const toHexPrefix = (bytes: Uint8Array, length: number = 16) =>
  Array.from(bytes.slice(0, length))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const isAsciiBytes = (bytes: Uint8Array) => bytes.every((b) => b <= 0x7f);

const toBytesFromBinaryString = (binary: string) => {
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i) & 0xff;
  }
  return out;
};

// Add Microsoft Graph error response interface
interface MicrosoftGraphErrorResponse {
  error?: {
    code?: string;
    message?: string;

    innerError?: any;
  };
}

interface UploadSessionResponse {
  uploadUrl?: string;
}

interface UploadChunkProgressResponse {
  nextExpectedRanges?: string[];
}

class UploadChunkError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadChunkError";
    this.status = status;
  }
}

export class OnedriveService {
  private config: OnedriveConfig;
  private msAuth?: MicrosoftAuthenticationResponse;
  private tenantUrl: string;
  private tokenExpiry: number = 0; // Track token expiration time

  constructor(config: OnedriveConfig) {
    this.config = config;

    this.tenantUrl = `${HOST.api}/v1.0/users/${this.config.userEmail}/drive/root`;
  }

  public async auth() {
    const formData = new URLSearchParams();

    formData.append("grant_type", "client_credentials");
    formData.append("client_id", this.config.clientID);
    formData.append("client_secret", this.config.clientSecret);
    formData.append("resource", `${HOST.api}/`);
    formData.append("scope", `${HOST.api}/.default`);

    try {
      const res = await fetchWithRetry(
        `${HOST.oauth}/${this.config.tenantID}/oauth2/token`,
        {
          method: "POST",
          body: formData.toString(),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      this.msAuth = (await res.json()) as MicrosoftAuthenticationResponse;

      if (!this.msAuth.access_token) {
        throw new Error("Access token is empty");
      }

      // Set token expiration time (subtract 30 seconds as safety margin)
      const expiresIn = parseInt(this.msAuth.expires_in) || 3600;
      this.tokenExpiry = Date.now() + (expiresIn - 30) * 1000;

      return this;
    } catch (err) {
      throw new Error(formatError(err) || "Error fetching access token");
    }
  }

  // Check if the token is expired
  private isTokenExpired(): boolean {
    return !this.msAuth?.access_token || Date.now() >= this.tokenExpiry;
  }

  // Ensure we have a valid token before making API calls
  private async ensureValidToken(): Promise<void> {
    if (!this.msAuth || this.isTokenExpired()) {
      await this.auth();
    }
  }

  public async getFile(path: string): Promise<OneDriveFile> {
    try {
      await this.ensureValidToken();

      const graphPath = encodeGraphPath(`${this.config.storagePath}/${path}`);
      const url = `${this.tenantUrl}:/${graphPath}`;

      const response = await fetchWithRetry(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.msAuth?.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = (await response
          .json()
          .catch(() => null)) as MicrosoftGraphErrorResponse | null;
        // Handle invalid token error
        if (
          errorData?.error?.code === "InvalidAuthenticationToken" ||
          response.status === 401
        ) {
          // Force token refresh and retry
          await this.auth();
          return this.getFile(path);
        }

        const message = JSON.stringify(errorData) || (await response.text());
        console.error(message);
        throw new Error(`Failed to get file: ${message}`);
      }

      return await response.json();
    } catch (err) {
      throw new Error(formatError(err) || "Error getting file");
    }
  }

  public async getLink(filePath: string, customHost?: string): Promise<string> {
    try {
      await this.ensureValidToken();
      const fileInfo = await this.getFile(filePath);

      if (!fileInfo.file) {
        throw new Error("Not a file");
      }

      let downloadUrl = fileInfo["@microsoft.graph.downloadUrl"];

      if (!downloadUrl) {
        throw new Error("Download URL not found");
      }

      if (customHost) {
        try {
          const urlObj = new URL(downloadUrl);
          urlObj.host = customHost;
          downloadUrl = urlObj.toString();
        } catch (error) {
          console.error("Failed to parse download URL:", error);
        }
      }

      return downloadUrl;
    } catch (err) {
      throw new Error(formatError(err) || "Error getting download link");
    }
  }

  public async upload(
    fileBuffer: Buffer,
    filename: string,
  ): Promise<OneDriveFile> {
    const uploadPath = `${this.config.storagePath}/${filename}`;

    try {
      await this.ensureValidToken();

      const graphPath = encodeGraphPath(uploadPath);
      const url = `${this.tenantUrl}:/${graphPath}:/content`;

      const response = await fetchWithRetry(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.msAuth?.access_token}`,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(fileBuffer),
      });

      if (!response.ok) {
        const errorData = (await response
          .json()
          .catch(() => null)) as MicrosoftGraphErrorResponse | null;
        // Handle invalid token error
        if (
          errorData?.error?.code === "InvalidAuthenticationToken" ||
          response.status === 401
        ) {
          // Force token refresh and retry
          await this.auth();
          return this.upload(fileBuffer, uploadPath);
        }

        const message = JSON.stringify(errorData) || (await response.text());
        console.error(message);
        throw new Error(`Failed to upload file: ${message}`);
      }

      return response.json();
    } catch (err) {
      throw new Error(formatError(err));
    }
  }

  private async createUploadSession(uploadPath: string): Promise<string> {
    await this.ensureValidToken();
    const graphPath = encodeGraphPath(uploadPath);
    const url = `${this.tenantUrl}:/${graphPath}:/createUploadSession`;

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.msAuth?.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        item: {
          // Keep the original filename stable; overwrite content on conflict.
          "@microsoft.graph.conflictBehavior": "replace",
        },
      }),
    });

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => null)) as MicrosoftGraphErrorResponse | null;

      if (
        errorData?.error?.code === "InvalidAuthenticationToken" ||
        response.status === 401
      ) {
        await this.auth();
        return this.createUploadSession(uploadPath);
      }

      const message = JSON.stringify(errorData) || (await response.text());
      throw new Error(`Failed to create upload session: ${message}`);
    }

    const session = (await response.json()) as UploadSessionResponse;
    if (!session.uploadUrl) {
      throw new Error("Upload URL not found in upload session response");
    }
    return session.uploadUrl;
  }

  public async createUploadSessionForFile(filename: string): Promise<string> {
    const uploadPath = `${this.config.storagePath}/${filename}`;
    return this.createUploadSession(uploadPath);
  }

  public async createUploadSessionWithBasePath(
    filename: string,
    basePath: string,
  ): Promise<string> {
    const uploadPath = `${basePath}/${filename}`;
    return this.createUploadSession(uploadPath);
  }

  public async uploadChunkToSession(
    uploadUrl: string,
    chunk: Uint8Array,
    start: number,
    end: number,
    totalSize: number,
  ): Promise<{
    done: boolean;
    file?: OneDriveFile;
    nextExpectedRanges?: string[];
  }> {
    const response = await retry(
      async () => {
        const res = await fetch(uploadUrl, {
          method: "PUT",
          headers: {
            "Content-Range": `bytes ${start}-${end}/${totalSize}`,
            "Content-Type": "application/octet-stream",
          },
          body: chunk,
        });

        if (res.status === 429 || (res.status >= 500 && res.status <= 504)) {
          const message = await res.text();
          throw new UploadChunkError(
            message || "Temporary upload error",
            res.status,
          );
        }

        if (![200, 201, 202].includes(res.status)) {
          const message = await res.text();
          throw new Error(
            `Failed to upload chunk (${start}-${end}): ${message || res.statusText}`,
          );
        }

        return res;
      },
      {
        maxRetries: 3,
        initialDelay: 1000,
        retryCondition: (error) =>
          error instanceof TypeError ||
          (error instanceof UploadChunkError &&
            (error.status === 429 ||
              (error.status >= 500 && error.status <= 504))),
      },
    );

    if (response.status === 202) {
      const progress = (await response.json()) as UploadChunkProgressResponse;
      return {
        done: false,
        nextExpectedRanges: progress.nextExpectedRanges || [],
      };
    }

    const uploadedFile = (await response.json()) as OneDriveFile;
    return {
      done: true,
      file: uploadedFile,
    };
  }

  private async readStreamToUint8Array(
    fileStream: ReadableStream<Uint8Array>,
  ): Promise<Uint8Array> {
    const reader = fileStream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;
        // Copy chunk to avoid potential buffer reuse by runtime stream implementations.
        const copied = value.slice();
        chunks.push(copied);
        total += copied.byteLength;
      }
    } finally {
      reader.releaseLock();
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }

  private decodeBase64IfNeeded(
    bytes: Uint8Array,
    filename: string,
  ): { bytes: Uint8Array; decoded: boolean } {
    if (!isAsciiBytes(bytes)) {
      return { bytes, decoded: false };
    }

    const rawText = new TextDecoder().decode(bytes).trim();
    if (!rawText) {
      return { bytes, decoded: false };
    }

    let base64 = rawText;
    if (rawText.startsWith("data:")) {
      const comma = rawText.indexOf(",");
      const meta = comma >= 0 ? rawText.slice(0, comma) : "";
      if (!meta.includes(";base64") || comma < 0) {
        return { bytes, decoded: false };
      }
      base64 = rawText.slice(comma + 1);
    }

    const normalized = base64.replace(/\s+/g, "");
    if (
      normalized.length === 0 ||
      normalized.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/=]+$/.test(normalized)
    ) {
      return { bytes, decoded: false };
    }

    try {
      const decoded = toBytesFromBinaryString(atob(normalized));
      if (decoded.byteLength === 0) {
        return { bytes, decoded: false };
      }
      // console.warn(
      //   `[onedrive] detected base64 payload, auto-decoded before upload: name=${filename}, encoded=${bytes.byteLength}, decoded=${decoded.byteLength}`,
      // );
      return { bytes: decoded, decoded: true };
    } catch {
      return { bytes, decoded: false };
    }
  }

  public async getFileWithBasePath(
    path: string,
    basePath: string,
  ): Promise<OneDriveFile> {
    try {
      await this.ensureValidToken();

      const graphPath = encodeGraphPath(`${basePath}/${path}`);
      const url = `${this.tenantUrl}:/${graphPath}`;

      const response = await fetchWithRetry(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.msAuth?.access_token}`,
        },
      });

      if (!response.ok) {
        const errorData = (await response
          .json()
          .catch(() => null)) as MicrosoftGraphErrorResponse | null;
        if (
          errorData?.error?.code === "InvalidAuthenticationToken" ||
          response.status === 401
        ) {
          await this.auth();
          return this.getFileWithBasePath(path, basePath);
        }

        const message = JSON.stringify(errorData) || (await response.text());
        throw new Error(`Failed to get file: ${message}`);
      }

      return await response.json();
    } catch (err) {
      throw new Error(formatError(err) || "Error getting file");
    }
  }

  public async uploadWithBasePath(
    bytes: Uint8Array,
    filename: string,
    basePath: string,
  ): Promise<OneDriveFile> {
    const uploadPath = `${basePath}/${filename}`;

    try {
      await this.ensureValidToken();

      const graphPath = encodeGraphPath(uploadPath);
      const url = `${this.tenantUrl}:/${graphPath}:/content`;

      const response = await fetchWithRetry(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.msAuth?.access_token}`,
          "Content-Type": "application/octet-stream",
        },
        body: bytes,
      });

      if (!response.ok) {
        const errorData = (await response
          .json()
          .catch(() => null)) as MicrosoftGraphErrorResponse | null;
        if (
          errorData?.error?.code === "InvalidAuthenticationToken" ||
          response.status === 401
        ) {
          await this.auth();
          return this.uploadWithBasePath(bytes, filename, basePath);
        }

        const message = JSON.stringify(errorData) || (await response.text());
        throw new Error(`Failed to upload file: ${message}`);
      }

      return response.json();
    } catch (err) {
      throw new Error(formatError(err));
    }
  }

  public async deleteFile(path: string, basePath?: string): Promise<void> {
    const base = basePath ?? this.config.storagePath;

    try {
      await this.ensureValidToken();

      const graphPath = encodeGraphPath(`${base}/${path}`);
      const url = `${this.tenantUrl}:/${graphPath}`;

      const response = await fetchWithRetry(url, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.msAuth?.access_token}`,
        },
      });

      if (!response.ok && response.status !== 404) {
        const errorData = (await response
          .json()
          .catch(() => null)) as MicrosoftGraphErrorResponse | null;
        if (
          errorData?.error?.code === "InvalidAuthenticationToken" ||
          response.status === 401
        ) {
          await this.auth();
          return this.deleteFile(path, basePath);
        }

        const message = JSON.stringify(errorData) || (await response.text());
        throw new Error(`Failed to delete file: ${message}`);
      }
    } catch (err) {
      throw new Error(formatError(err) || "Error deleting file");
    }
  }

  public async uploadReadableStream(
    fileStream: ReadableStream<Uint8Array>,
    filename: string,
    fileSize: number,
  ): Promise<OneDriveFile> {
    if (!fileSize || fileSize <= 0) {
      throw new Error("Invalid file size");
    }

    const uploadPath = `${this.config.storagePath}/${filename}`;

    // Small files use direct upload for better compatibility and simpler integrity.
    if (fileSize <= 4 * 1024 * 1024) {
      await this.ensureValidToken();
      const graphPath = encodeGraphPath(uploadPath);
      const url = `${this.tenantUrl}:/${graphPath}:/content`;
      const rawBytes = await this.readStreamToUint8Array(fileStream);
      const { bytes, decoded } = this.decodeBase64IfNeeded(rawBytes, filename);
      const effectiveSize = bytes.byteLength;

      if (decoded) {
        // console.warn(
        //   `[onedrive] x-file-size likely encoded size: declared=${fileSize}, effective=${effectiveSize}`,
        // );
      }

      if (!decoded && effectiveSize !== fileSize) {
        throw new Error(
          `Upload size mismatch before direct upload: received=${effectiveSize}, expected=${fileSize}`,
        );
      }

      const response = await fetchWithRetry(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.msAuth?.access_token}`,
          "Content-Type": "application/octet-stream",
        },
        body: bytes,
      });

      if (!response.ok) {
        const message = await response.text();
        throw new Error(
          `Failed to upload small file: ${message || response.statusText}`,
        );
      }

      const uploadedFile = (await response.json()) as OneDriveFile;
      if (uploadedFile.size !== effectiveSize) {
        throw new Error(
          `Uploaded small file size mismatch: uploaded=${uploadedFile.size}, expected=${effectiveSize}`,
        );
      }

      // console.info(
      //   `[onedrive] upload completed(direct): name=${filename}, uploaded=${uploadedFile.size}/${effectiveSize}, head=${toHexPrefix(bytes)}`,
      // );
      return uploadedFile;
    }

    const uploadUrl = await this.createUploadSession(uploadPath);
    // OneDrive requires chunk size to be a multiple of 320 KiB.
    const chunkSize = 10 * 320 * 1024;
    // const totalChunks = Math.ceil(fileSize / chunkSize);
    let uploadedFile: OneDriveFile | null = null;
    let uploadedBytes = 0;
    let offset = 0;
    let pending = new Uint8Array(0);

    // console.info(
    //   `[onedrive] upload started(stream): name=${filename}, size=${fileSize}, chunks=${totalChunks}`,
    // );

    const flushChunk = async (start: number, chunk: Uint8Array) => {
      const end = start + chunk.byteLength - 1;
      const response = await retry(
        async () => {
          const res = await fetch(uploadUrl, {
            method: "PUT",
            headers: {
              "Content-Range": `bytes ${start}-${end}/${fileSize}`,
              "Content-Type": "application/octet-stream",
            },
            body: chunk,
          });

          if (res.status === 429 || (res.status >= 500 && res.status <= 504)) {
            const message = await res.text();
            throw new UploadChunkError(
              message || "Temporary upload error",
              res.status,
            );
          }

          if (![200, 201, 202].includes(res.status)) {
            const message = await res.text();
            throw new Error(
              `Failed to upload chunk (${start}-${end}): ${message || res.statusText}`,
            );
          }

          return res;
        },
        {
          maxRetries: 3,
          initialDelay: 1000,
          retryCondition: (error) =>
            error instanceof TypeError ||
            (error instanceof UploadChunkError &&
              (error.status === 429 ||
                (error.status >= 500 && error.status <= 504))),
        },
      );

      if (response.status === 200 || response.status === 201) {
        uploadedFile = (await response.json()) as OneDriveFile;
      }

      uploadedBytes = end + 1;
      // const percent = ((uploadedBytes / fileSize) * 100).toFixed(2);
      // const chunkIndex = Math.floor(start / chunkSize) + 1;
      // console.info(
      //   `[onedrive] upload progress(stream): ${percent}% (${uploadedBytes}/${fileSize}) chunk=${chunkIndex}/${totalChunks}`,
      // );
    };

    const reader = fileStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value || value.byteLength === 0) continue;

        const merged = new Uint8Array(pending.byteLength + value.byteLength);
        merged.set(pending);
        merged.set(value, pending.byteLength);
        pending = merged;

        while (pending.byteLength >= chunkSize) {
          const chunk = pending.slice(0, chunkSize);
          pending = pending.slice(chunkSize);
          await flushChunk(offset, chunk);
          offset += chunk.byteLength;
        }
      }

      if (pending.byteLength > 0) {
        await flushChunk(offset, pending);
        offset += pending.byteLength;
      }
    } finally {
      reader.releaseLock();
    }

    if (offset !== fileSize || uploadedBytes !== fileSize) {
      throw new Error(
        `Upload size mismatch: uploaded=${uploadedBytes}, expected=${fileSize}`,
      );
    }

    // console.info(
    //   `[onedrive] upload completed(stream): name=${filename}, uploaded=${uploadedBytes}/${fileSize}`,
    // );

    const finalizedFile = uploadedFile;
    if (finalizedFile) {
      // console.info(
      //   "[onedrive] upload finalized(stream): received final metadata",
      // );
      return finalizedFile;
    }

    throw new Error(
      "Upload finished without final file metadata from OneDrive",
    );
  }
}
