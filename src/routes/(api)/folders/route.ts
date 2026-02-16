import { createFileRoute } from "@tanstack/react-router";
import { kysely } from "@/lib/kysely";
import { requireUploadAuthorization } from "@/utils/upload-auth";

export const Route = createFileRoute("/(api)/folders")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parentIdParam = url.searchParams.get("parentId");

        let query = kysely.selectFrom("folders").selectAll();

        if (!parentIdParam || parentIdParam === "null") {
          query = query.where("parent_id", "is", null);
        } else {
          query = query.where("parent_id", "=", parentIdParam);
        }

        const folders = await query.orderBy("name", "asc").execute();
        return Response.json(folders);
      },

      POST: async ({ request }) => {
        const authError = requireUploadAuthorization(request);
        if (authError) {
          return authError;
        }

        const body = (await request.json().catch(() => null)) as {
          name?: string;
          parentId?: string | null;
        } | null;

        const name = body?.name?.trim();
        if (!name) {
          return Response.json(
            { error: "name is required" },
            { status: 400 },
          );
        }

        if (name.includes("/")) {
          return Response.json(
            { error: "folder name cannot contain '/'" },
            { status: 400 },
          );
        }

        const parentId = body?.parentId ?? null;

        if (parentId) {
          const parent = await kysely
            .selectFrom("folders")
            .where("id", "=", parentId)
            .select("id")
            .executeTakeFirst();

          if (!parent) {
            return Response.json(
              { error: "parent folder not found" },
              { status: 404 },
            );
          }
        }

        const existing = await kysely
          .selectFrom("folders")
          .where("name", "=", name)
          .where((eb) =>
            parentId === null
              ? eb("parent_id", "is", null)
              : eb("parent_id", "=", parentId),
          )
          .select("id")
          .executeTakeFirst();

        if (existing) {
          return Response.json(
            { error: "a folder with this name already exists in this location" },
            { status: 409 },
          );
        }

        const folder = await kysely
          .insertInto("folders")
          .values({
            id: crypto.randomUUID(),
            name,
            parent_id: parentId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        return Response.json(folder, { status: 201 });
      },
    },
  },
});
