import { createFileRoute } from "@tanstack/react-router";
import { uploadChunkToSession } from "@/services/onedrive";
import { kysely } from "@/lib/kysely";
import { getOrCreateFolderByPath } from "@/query/folders";
import { chunkPreflight } from "@/utils/upload-preflight";

export const Route = createFileRoute("/(api)/upload/chunk")({
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

        let folderId: string | null = null;
        if (session.folderPath) {
          folderId = await getOrCreateFolderByPath(session.folderPath);
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
              folder_id: folderId,
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
