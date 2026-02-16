import { createFileRoute } from "@tanstack/react-router";
import { uploadChunkToSession } from "@/services/onedrive";
import { kysely } from "@/lib/kysely";
import { chunkPreflight } from "@/utils/upload-preflight";

export const Route = createFileRoute("/(api)/cache/chunk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const pre = await chunkPreflight(request);
        if (pre.error) return pre.error;

        const { session, range, bytes } = pre;

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
