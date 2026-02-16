import { createFileRoute } from "@tanstack/react-router";
import { kysely } from "@/lib/kysely";
import { requireUploadAuthorization } from "@/utils/upload-auth";
import {
  uploadCacheFile,
  getCacheFile,
  deleteCacheFile,
} from "@/services/onedrive";

export const Route = createFileRoute("/(api)/cache/$key")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        const authError = requireUploadAuthorization(request);
        if (authError) return authError;

        if (!request.body) {
          return Response.json(
            { error: "Request body is empty" },
            { status: 400 },
          );
        }

        const key = params.key;

        // Read body into Uint8Array
        const reader = request.body.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value || value.byteLength === 0) continue;
          chunks.push(value.slice());
          total += value.byteLength;
        }
        reader.releaseLock();

        const body = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.byteLength;
        }

        const result = await uploadCacheFile(body, key);

        // Upsert DB record with hidden=1
        await kysely
          .insertInto("files")
          .values({
            id: key,
            file_name: key,
            file_size: result.size,
            mime_type: "application/octet-stream",
            hidden: 1,
          })
          .onConflict((oc) =>
            oc.column("id").doUpdateSet({
              file_size: result.size,
              updated_at: new Date().toISOString(),
            }),
          )
          .execute();

        return Response.json({ key, size: result.size });
      },

      GET: async ({ request, params }) => {
        const authError = requireUploadAuthorization(request);
        if (authError) return authError;

        const key = params.key;

        // Check DB for hidden cache entry
        const file = await kysely
          .selectFrom("files")
          .where("id", "=", key)
          .where("hidden", "=", 1)
          .selectAll()
          .executeTakeFirst();

        if (!file) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }

        const onedriveFile = await getCacheFile(key);
        const downloadUrl = onedriveFile["@microsoft.graph.downloadUrl"];

        if (!downloadUrl) {
          return Response.json(
            { error: "Download URL not found" },
            { status: 500 },
          );
        }

        return Response.redirect(downloadUrl, 302);
      },

      DELETE: async ({ request, params }) => {
        const authError = requireUploadAuthorization(request);
        if (authError) return authError;

        const key = params.key;

        // Delete from OneDrive (ignores 404)
        await deleteCacheFile(key);

        // Delete from DB
        await kysely.deleteFrom("files").where("id", "=", key).execute();

        return Response.json({ deleted: key });
      },
    },
  },
});
