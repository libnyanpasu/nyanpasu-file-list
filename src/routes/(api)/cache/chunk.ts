import { createFileRoute } from "@tanstack/react-router";
import { uploadChunkToSession } from "@/services/onedrive";
import { verifyUploadSessionToken } from "@/utils/upload-session-token";
import { kysely } from "@/lib/kysely";
import {
  getUploadTokenSecret,
  requireUploadAuthorization,
} from "@/utils/upload-auth";
import { parseContentRange } from "@/utils/content-range";

export const Route = createFileRoute("/(api)/cache/chunk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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

        const uploadId = request.headers.get("x-upload-id");
        if (!uploadId) {
          return Response.json(
            { error: "Missing x-upload-id header" },
            { status: 400 },
          );
        }

        const session = await verifyUploadSessionToken(uploadId, secret);
        if (!session) {
          return Response.json(
            { error: "Invalid or expired uploadId" },
            { status: 400 },
          );
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

        // Upsert DB record with hidden=1
        await kysely
          .insertInto("files")
          .values({
            id: session.fileId,
            file_name: session.fileId,
            file_size: result.file.size,
            mime_type: "application/octet-stream",
            hidden: 1,
          })
          .onConflict((oc) =>
            oc.column("id").doUpdateSet({
              file_size: result.file!.size,
              updated_at: new Date().toISOString(),
            }),
          )
          .execute();

        return Response.json({
          done: true,
          key: session.fileId,
          size: result.file.size,
        });
      },
    },
  },
});
