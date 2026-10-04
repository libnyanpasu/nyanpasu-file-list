import { createFileRoute } from "@tanstack/react-router";
import { ArchiveConflictError, verifyArchiveBuild } from "@/services/archive-index";
import { formatError } from "@/utils/fmt";
import { requireUploadAuthorization } from "@/utils/upload-auth";

export const Route = createFileRoute("/(api)/archive/builds/$buildId/verify")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const authError = requireUploadAuthorization(request);
        if (authError) return authError;

        try {
          const build = await verifyArchiveBuild(params.buildId);
          if (!build) return Response.json({ error: "Build not found" }, { status: 404 });
          return Response.json(build);
        } catch (error) {
          if (error instanceof ArchiveConflictError) {
            return Response.json({ error: error.message }, { status: 409 });
          }
          const detail = formatError(error);
          console.error(`[archive/builds/${params.buildId}/verify] verification failed:`, detail);
          return Response.json(
            { error: "Archive verification failed", detail },
            { status: 500 },
          );
        }
      },
    },
  },
});
