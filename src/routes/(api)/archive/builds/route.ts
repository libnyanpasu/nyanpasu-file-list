import { createFileRoute } from "@tanstack/react-router";
import { ArchiveBuildInputSchema } from "@/lib/archive";
import { formatError } from "@/utils/fmt";
import { requireUploadAuthorization } from "@/utils/upload-auth";
import {
  ArchiveConflictError,
  registerArchiveBuild,
} from "@/services/archive-index";

export const Route = createFileRoute("/(api)/archive/builds")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const authError = requireUploadAuthorization(request);
        if (authError) return authError;

        const body = await request.json().catch(() => null);
        const parsed = ArchiveBuildInputSchema.safeParse(body);
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid build manifest", detail: parsed.error.message },
            { status: 400 },
          );
        }

        try {
          const build = await registerArchiveBuild(parsed.data);
          return Response.json(build, { status: 200 });
        } catch (error) {
          if (error instanceof ArchiveConflictError) {
            return Response.json({ error: error.message }, { status: 409 });
          }
          const detail = formatError(error);
          console.error("[archive/builds] registration failed:", detail);
          return Response.json(
            { error: "Archive registration failed", detail },
            { status: 500 },
          );
        }
      },
    },
  },
});
