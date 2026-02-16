import { createFileRoute } from "@tanstack/react-router";
import { createUploadSession } from "@/services/onedrive";
import { uploadToken } from "@/utils/env";
import { createUploadSessionToken } from "@/utils/upload-session-token";

const MAX_SESSION_AGE_MS = 2 * 60 * 60 * 1000;
const CHUNK_SIZE = 10 * 320 * 1024;

export const Route = createFileRoute("/(api)/upload/init")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization");

        // TODO: secure token
        if (token !== `Bearer ${uploadToken}`) {
          return Response.json(
            {
              error: "Unauthorized",
            },
            { status: 401 },
          );
        }

        const body = (await request
          .json()
          .catch(() => null)) as
          | {
              filename?: string;
              fileSize?: number;
              mimeType?: string;
            }
          | null;

        const filename = body?.filename?.trim();
        const fileSize = Number(body?.fileSize || 0);
        const mimeType = body?.mimeType?.trim() || null;

        if (!filename) {
          return Response.json({ error: "filename is required" }, { status: 400 });
        }

        if (!Number.isFinite(fileSize) || fileSize <= 0) {
          return Response.json({ error: "fileSize is invalid" }, { status: 400 });
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
          uploadToken,
        );

        return Response.json({
          uploadId,
          filename,
          fileSize,
          chunkSize: CHUNK_SIZE,
          expiresAt,
        });
      },
    },
  },
});
