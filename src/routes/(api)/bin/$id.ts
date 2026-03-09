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
          console.warn(
            `[bin] file not found in DB or is hidden: id=${params.id}`,
          );
          return Response.json({ error: "Not found" }, { status: 404 });
        }

        // Resolve full path by walking up the folder hierarchy
        let filePath = file.file_name;
        if (file.folder_id) {
          const segments: string[] = [];
          let currentId: string | null = file.folder_id;
          while (currentId) {
            const folder = await kysely
              .selectFrom("folders")
              .where("id", "=", currentId)
              .select(["name", "parent_id"])
              .executeTakeFirst();
            if (!folder) break;
            segments.unshift(folder.name);
            currentId = folder.parent_id;
          }
          filePath = [...segments, file.file_name].join("/");
        }

        let onedriveFile: Awaited<ReturnType<typeof getFile>>;

        try {
          onedriveFile = await getFile(filePath);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[bin] OneDrive fetch failed: id=${params.id}, resolved_path=${filePath}, error=${message}`,
          );
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
