import { createFileRoute } from "@tanstack/react-router";
import { kysely } from "@/lib/kysely";
import { getFile } from "@/services/onedrive";

export const Route = createFileRoute("/(api)/bin/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const file = await kysely
          .selectFrom("files")
          .where("id", "=", params.id)
          .selectAll()
          .executeTakeFirst();

        if (!file) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }

        const onedriveFile = await getFile(file.file_name);

        const downloadUrl = onedriveFile["@microsoft.graph.downloadUrl"];

        if (!downloadUrl) {
          return Response.json({ error: "Download declined" }, { status: 403 });
        }

        return Response.redirect(downloadUrl, 302);
      },
    },
  },
});
