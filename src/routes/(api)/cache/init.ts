import { createFileRoute } from "@tanstack/react-router";
import { createCacheUploadSession } from "@/services/onedrive";
import { createUploadSessionToken } from "@/utils/upload-session-token";
import { formatError } from "@/utils/fmt";
import {
  MAX_SESSION_AGE_MS,
  resolveChunkSize,
  initPreflight,
} from "@/utils/upload-preflight";

export const Route = createFileRoute("/(api)/cache/init")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const pre = initPreflight(request);
          if (pre.error) return pre.error;

          const body = (await request.json().catch(() => null)) as {
            key?: string;
            fileSize?: number;
            chunkMultiplier?: number;
          } | null;

          const key = body?.key?.trim();
          const fileSize = Number(body?.fileSize || 0);
          const chunkSize = resolveChunkSize(body?.chunkMultiplier);

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
            pre.secret,
          );

          return Response.json({
            uploadId,
            key,
            fileSize,
            chunkSize,
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
