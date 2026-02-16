import { uploadFile } from "@/services/onedrive";
import { createFileRoute } from "@tanstack/react-router";
import { kysely } from "@/lib/kysely";
import { uploadToken } from "@/utils/env";

export const Route = createFileRoute("/(api)/upload")({
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

        const formData = await request.formData();
        const file = formData.get("file") as File;

        const result = await uploadFile(
          Buffer.from(await file.arrayBuffer()),
          file.name,
        );

        const inserted = await kysely
          .insertInto("files")
          .values({
            id: crypto.randomUUID(),
            file_name: result.name,
            file_size: result.size,
            mime_type: result.file?.mimeType,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        return Response.json(inserted);
      },
    },
  },
});
