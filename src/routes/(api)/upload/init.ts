import { createFileRoute } from "@tanstack/react-router";
import { createUploadSession } from "@/services/onedrive";
import { createUploadSessionToken } from "@/utils/upload-session-token";
import { formatError } from "@/utils/fmt";
import {
  MAX_SESSION_AGE_MS,
  resolveChunkSize,
  initPreflight,
} from "@/utils/upload-preflight";

export const Route = createFileRoute("/(api)/upload/init")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const pre = initPreflight(request);
          if (pre.error) return pre.error;

          const body = (await request.json().catch(() => null)) as {
            filename?: string;
            fileSize?: number;
            mimeType?: string;
            folderPath?: string;
            chunkMultiplier?: number;
          } | null;

          const filename = body?.filename?.trim();
          const fileSize = Number(body?.fileSize || 0);
          const mimeType = body?.mimeType?.trim() || null;
          const folderPath = body?.folderPath?.trim() || null;
          const chunkSize = resolveChunkSize(body?.chunkMultiplier);

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
              folderPath,
              exp: expiresAt,
            },
            pre.secret,
          );

          return Response.json({
            uploadId,
            filename,
            fileSize,
            chunkSize,
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
