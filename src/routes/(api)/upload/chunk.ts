import { createFileRoute } from "@tanstack/react-router";
import { uploadChunkToSession } from "@/services/onedrive";
import { uploadToken } from "@/utils/env";
import { verifyUploadSessionToken } from "@/utils/upload-session-token";
import { kysely } from "@/lib/kysely";

const parseContentRange = (value: string | null) => {
  if (!value) return null;
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value.trim());
  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(total) ||
    start < 0 ||
    end < start ||
    total <= 0
  ) {
    return null;
  }

  return { start, end, total };
};

export const Route = createFileRoute("/(api)/upload/chunk")({
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

        const uploadId = request.headers.get("x-upload-id");
        if (!uploadId) {
          return Response.json({ error: "Missing x-upload-id header" }, { status: 400 });
        }

        const session = await verifyUploadSessionToken(uploadId, uploadToken);
        if (!session) {
          return Response.json({ error: "Invalid or expired uploadId" }, { status: 400 });
        }

        const range = parseContentRange(request.headers.get("content-range"));
        if (!range) {
          return Response.json(
            { error: "Invalid content-range header" },
            { status: 400 },
          );
        }

        if (range.total !== session.fileSize) {
          return Response.json(
            {
              error: `content-range total mismatch, expected ${session.fileSize}, got ${range.total}`,
            },
            { status: 400 },
          );
        }

        const bytes = new Uint8Array(await request.arrayBuffer());
        const expectedLength = range.end - range.start + 1;
        if (bytes.byteLength !== expectedLength) {
          return Response.json(
            {
              error: `chunk size mismatch, expected ${expectedLength}, got ${bytes.byteLength}`,
            },
            { status: 400 },
          );
        }

        const result = await uploadChunkToSession(
          session.uploadUrl,
          bytes,
          range.start,
          range.end,
          range.total,
        );

        if (!result.done || !result.file) {
          return Response.json({
            done: false,
            nextExpectedRanges: result.nextExpectedRanges || [],
          });
        }

        let fileRow;
        try {
          fileRow = await kysely
            .insertInto("files")
            .values({
              id: session.fileId,
              file_name: result.file.name,
              file_size: result.file.size,
              mime_type: result.file.file?.mimeType || session.mimeType,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        } catch {
          fileRow = await kysely
            .selectFrom("files")
            .selectAll()
            .where("id", "=", session.fileId)
            .executeTakeFirstOrThrow();
        }

        return Response.json({
          done: true,
          file: fileRow,
        });
      },
    },
  },
});
