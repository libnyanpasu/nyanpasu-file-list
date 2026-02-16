import { kysely } from "@/lib/kysely";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Given a path like "a/b/c", traverses or creates each folder level
 * and returns the leaf folder's ID.
 */
export async function getOrCreateFolderByPath(
  path: string,
): Promise<string | null> {
  const segments = path
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);

  if (segments.length === 0) return null;

  let parentId: string | null = null;

  for (const name of segments) {
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
      parentId = existing.id;
    } else {
      const newId = crypto.randomUUID();
      await kysely
        .insertInto("folders")
        .values({
          id: newId,
          name,
          parent_id: parentId,
        })
        .execute();
      parentId = newId;
    }
  }

  return parentId;
}

export const getFolderChildren = createServerFn()
  .inputValidator(
    z.object({
      parentId: z.string().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    let query = kysely.selectFrom("folders").selectAll();

    if (data.parentId === null) {
      query = query.where("parent_id", "is", null);
    } else {
      query = query.where("parent_id", "=", data.parentId);
    }

    return await query.orderBy("name", "asc").execute();
  });

export const getFolderBreadcrumb = createServerFn()
  .inputValidator(
    z.object({
      folderId: z.string().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    if (!data.folderId) return [];

    const breadcrumb: { id: string; name: string }[] = [];
    let currentId: string | null = data.folderId;

    while (currentId) {
      const folder = await kysely
        .selectFrom("folders")
        .where("id", "=", currentId)
        .select(["id", "name", "parent_id"])
        .executeTakeFirst();

      if (!folder) break;

      breadcrumb.unshift({ id: folder.id, name: folder.name });
      currentId = folder.parent_id;
    }

    return breadcrumb;
  });
