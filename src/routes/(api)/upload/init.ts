import { createFileRoute } from "@tanstack/react-router";
import { createUploadSession } from "@/services/onedrive";
import { createUploadSessionToken } from "@/utils/upload-session-token";
import { formatError } from "@/utils/fmt";
import { getMissingOnedriveSettings } from "@/utils/env";
import {
  getUploadTokenSecret,
  requireUploadAuthorization,
} from "@/utils/upload-auth";

const MAX_SESSION_AGE_MS = 2 * 60 * 60 * 1000;
const CHUNK_SIZE = 10 * 320 * 1024;

export const Route = createFileRoute("/(api)/upload/init")({
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
            filename?: string;
            fileSize?: number;
            mimeType?: string;
          } | null;

          const filename = body?.filename?.trim();
          const fileSize = Number(body?.fileSize || 0);
          const mimeType = body?.mimeType?.trim() || null;

          if (!filename) {
            return Response.json(
              { error: "filename is required" },
              { status: 400 },
            );
          }

          if (!Number.isFinite(fileSize) || fileSize <= 0) {
            return Response.json(
              { error: "fileSize is invalid" },
              { status: 400 },
            );
          }

          const uploadUrl = await createUploadSession(filename);
          const expiresAt = Date.now() + MAX_SESSION_AGE_MS;
          const uploadId = await createUploadSessionToken(
            {
              uploadUrl,
              fileSize,
              filename,
              mimeType,
              fileId: crypto.randomUUID(),
              exp: expiresAt,
            },
            secret,
          );

          return Response.json({
            uploadId,
            filename,
            fileSize,
            chunkSize: CHUNK_SIZE,
            expiresAt,
          });
        } catch (error) {
          const detail = formatError(error);
          console.error("[upload/init] failed:", detail);
          return Response.json(
            {
              error: "upload init failed",
              detail,
            },
            { status: 500 },
          );
        }
      },
    },
  },
});
