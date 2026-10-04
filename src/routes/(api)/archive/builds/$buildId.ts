import { createFileRoute } from "@tanstack/react-router";
import { getArchiveBuild } from "@/services/archive-index";
import { requireUploadAuthorization } from "@/utils/upload-auth";

export const Route = createFileRoute("/(api)/archive/builds/$buildId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const authError = requireUploadAuthorization(request);
        if (authError) return authError;

        const build = await getArchiveBuild(params.buildId);
        if (!build) return Response.json({ error: "Build not found" }, { status: 404 });
        return Response.json(build);
      },
    },
  },
});
