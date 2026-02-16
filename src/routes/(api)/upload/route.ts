import { uploadFileStream } from "@/services/onedrive";
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

        if (!request.body) {
          return Response.json(
            { error: "Request body is empty" },
            { status: 400 },
          );
        }

        const filenameHeader = request.headers.get("x-file-name");
        if (!filenameHeader) {
          return Response.json(
            { error: "Missing x-file-name header" },
            { status: 400 },
          );
        }

        let filename = "";
        try {
          filename = decodeURIComponent(filenameHeader).trim();
        } catch {
          return Response.json(
            { error: "Invalid x-file-name header encoding" },
            { status: 400 },
          );
        }

        if (!filename) {
          return Response.json(
            { error: "x-file-name header cannot be empty" },
            { status: 400 },
          );
        }
        const sizeHeader = request.headers.get("x-file-size");
        const contentLengthHeader = request.headers.get("content-length");
        const fileSize = Number(sizeHeader || contentLengthHeader || 0);

        if (!fileSize || Number.isNaN(fileSize) || fileSize <= 0) {
          return Response.json(
            {
              error:
                "Missing or invalid file size (x-file-size/content-length)",
            },
            { status: 400 },
          );
        }

        // console.info(
        //   `[upload] stream request start: name=${filename}, size=${fileSize}`,
        // );

        const result: Awaited<ReturnType<typeof uploadFileStream>> =
          await uploadFileStream(request.body, fileSize, filename);

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
