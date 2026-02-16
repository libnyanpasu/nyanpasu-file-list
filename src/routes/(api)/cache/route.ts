import { createFileRoute } from "@tanstack/react-router";
import { kysely } from "@/lib/kysely";
import { requireUploadAuthorization } from "@/utils/upload-auth";

export const Route = createFileRoute("/(api)/cache")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const authError = requireUploadAuthorization(request);
        if (authError) return authError;

        const url = new URL(request.url);
        const prefix = url.searchParams.get("prefix") || "";

        let query = kysely
          .selectFrom("files")
          .where("hidden", "=", 1)
          .select("id")
          .orderBy("updated_at", "desc");

        if (prefix) {
          query = query.where("id", "like", `${prefix}%`);
        }

        const rows = await query.execute();
        const keys = rows.map((r) => r.id);

        return Response.json(keys);
      },
    },
  },
});
