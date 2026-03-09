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
          .where("hidden", "=", 0)
          .selectAll()
          .executeTakeFirst();

        if (!file) {
          return Response.json({ error: "Not found" }, { status: 404 });
        }

        let onedriveFile: Awaited<ReturnType<typeof getFile>>;

        try {
          onedriveFile = await getFile(file.file_name);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Response.json({ error: message }, { status: 404 });
        }

        const downloadUrl = onedriveFile["@microsoft.graph.downloadUrl"];

        if (!downloadUrl) {
          return Response.json({ error: "Download declined" }, { status: 403 });
        }

        return Response.redirect(downloadUrl, 302);
      },
    },
  },
});
