import { createFileRoute } from "@tanstack/react-router";
import { createCacheUploadSession } from "@/services/onedrive";
import { createUploadSessionToken } from "@/utils/upload-session-token";
import { formatError } from "@/utils/fmt";
import { getMissingOnedriveSettings } from "@/utils/env";
import {
  getUploadTokenSecret,
  requireUploadAuthorization,
} from "@/utils/upload-auth";

const MAX_SESSION_AGE_MS = 2 * 60 * 60 * 1000;
const CHUNK_SIZE = 10 * 320 * 1024;

export const Route = createFileRoute("/(api)/cache/init")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const authError = requireUploadAuthorization(request);
          if (authError) {
            return authError;
          }

          const secret = getUploadTokenSecret();
          if (!secret) {
            return Response.json(
              { error: "Server misconfigured: UPLOAD_TOKEN is empty" },
              { status: 500 },
            );
          }

          const missingOnedriveSettings = getMissingOnedriveSettings();
          if (missingOnedriveSettings.length > 0) {
            return Response.json(
              {
                error: "Server misconfigured: missing OneDrive settings",
                missing: missingOnedriveSettings,
              },
              { status: 500 },
            );
          }

          const body = (await request.json().catch(() => null)) as {
            key?: string;
            fileSize?: number;
          } | null;

          const key = body?.key?.trim();
          const fileSize = Number(body?.fileSize || 0);

          if (!key) {
            return Response.json(
              { error: "key is required" },
              { status: 400 },
            );
          }

          if (!Number.isFinite(fileSize) || fileSize <= 0) {
            return Response.json(
              { error: "fileSize is invalid" },
              { status: 400 },
            );
          }

          const uploadUrl = await createCacheUploadSession(key);
          const expiresAt = Date.now() + MAX_SESSION_AGE_MS;
          const uploadId = await createUploadSessionToken(
            {
              uploadUrl,
              fileSize,
              filename: key,
              mimeType: null,
              fileId: key,
              folderPath: null,
              exp: expiresAt,
            },
            secret,
          );

          return Response.json({
            uploadId,
            key,
            fileSize,
            chunkSize: CHUNK_SIZE,
            expiresAt,
          });
        } catch (error) {
          const detail = formatError(error);
          console.error("[cache/init] failed:", detail);
          return Response.json(
            {
              error: "cache upload init failed",
              detail,
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
