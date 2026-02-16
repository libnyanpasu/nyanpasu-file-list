import { getMissingOnedriveSettings } from "@/utils/env";
import {
  getUploadTokenSecret,
  requireUploadAuthorization,
} from "@/utils/upload-auth";
import { verifyUploadSessionToken } from "@/utils/upload-session-token";
import { parseContentRange } from "@/utils/content-range";

// OneDrive requires chunk size to be a multiple of 320 KiB
export const CHUNK_BASE = 320 * 1024;
export const DEFAULT_CHUNK_MULTIPLIER = 10;
export const MAX_CHUNK_MULTIPLIER = Math.floor(
  (100 * 1024 * 1024) / CHUNK_BASE,
); // 100 MB cap
export const MAX_SESSION_AGE_MS = 2 * 60 * 60 * 1000;

export function resolveChunkSize(multiplier?: number | null): number {
  const raw = Number(multiplier || DEFAULT_CHUNK_MULTIPLIER);
  const clamped = Math.max(1, Math.min(MAX_CHUNK_MULTIPLIER, Math.floor(raw)));
  return clamped * CHUNK_BASE;
}

/**
 * Common preflight for init endpoints: auth, secret, OneDrive settings.
 * Returns `{ secret }` on success or `{ error: Response }` on failure.
 */
export function initPreflight(
  request: Request,
): { secret: string; error?: never } | { secret?: never; error: Response } {
  const authError = requireUploadAuthorization(request);
  if (authError) return { error: authError };

  const secret = getUploadTokenSecret();
  if (!secret) {
    return {
      error: Response.json(
        { error: "Server misconfigured: UPLOAD_TOKEN is empty" },
        { status: 500 },
      ),
    };
  }

  const missing = getMissingOnedriveSettings();
  if (missing.length > 0) {
    return {
      error: Response.json(
        { error: "Server misconfigured: missing OneDrive settings", missing },
        { status: 500 },
      ),
    };
  }

  return { secret };
}

/**
 * Common preflight for chunk endpoints: auth, secret, session token, content-range, body size.
 * Returns parsed session + range + bytes on success or `{ error: Response }` on failure.
 */
export async function chunkPreflight(request: Request): Promise<
  | {
      session: NonNullable<
        Awaited<ReturnType<typeof verifyUploadSessionToken>>
      >;
      range: NonNullable<ReturnType<typeof parseContentRange>>;
      bytes: Uint8Array;
      error?: never;
    }
  | { error: Response; session?: never; range?: never; bytes?: never }
> {
  const authError = requireUploadAuthorization(request);
  if (authError) return { error: authError };

  const secret = getUploadTokenSecret();
  if (!secret) {
    return {
      error: Response.json(
        { error: "Server misconfigured: UPLOAD_TOKEN is empty" },
        { status: 500 },
      ),
    };
  }

  const uploadId = request.headers.get("x-upload-id");
  if (!uploadId) {
    return {
      error: Response.json(
        { error: "Missing x-upload-id header" },
        { status: 400 },
      ),
    };
  }

  const session = await verifyUploadSessionToken(uploadId, secret);
  if (!session) {
    return {
      error: Response.json(
        { error: "Invalid or expired uploadId" },
        { status: 400 },
      ),
    };
  }

  const range = parseContentRange(request.headers.get("content-range"));
  if (!range) {
    return {
      error: Response.json(
        { error: "Invalid content-range header" },
        { status: 400 },
      ),
    };
  }

  if (range.total !== session.fileSize) {
    return {
      error: Response.json(
        {
          error: `content-range total mismatch, expected ${session.fileSize}, got ${range.total}`,
        },
        { status: 400 },
      ),
    };
  }

  const bytes = new Uint8Array(await request.arrayBuffer());
  const expectedLength = range.end - range.start + 1;
  if (bytes.byteLength !== expectedLength) {
    return {
      error: Response.json(
        {
          error: `chunk size mismatch, expected ${expectedLength}, got ${bytes.byteLength}`,
        },
        { status: 400 },
      ),
    };
  }

  return { session, range, bytes };
}
