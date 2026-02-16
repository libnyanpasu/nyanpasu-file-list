import { kysely } from "@/lib/kysely";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getFileList = createServerFn()
  .inputValidator(
    z.object({
      page: z.number(),
      pageSize: z.number(),
      folderId: z.string().nullable().default(null),
    }),
  )
  .handler(async ({ data }) => {
    const offset = (data.page - 1) * data.pageSize;

    let filesQuery = kysely
      .selectFrom("files")
      .where("hidden", "=", 0);

    if (data.folderId === null) {
      filesQuery = filesQuery.where("folder_id", "is", null);
    } else {
      filesQuery = filesQuery.where("folder_id", "=", data.folderId);
    }

    const [files, countResult, folders] = await Promise.all([
      filesQuery
        .orderBy("created_at", "desc")
        .limit(data.pageSize)
        .offset(offset)
        .selectAll()
        .execute(),
      filesQuery
        .select(kysely.fn.countAll().as("total"))
        .executeTakeFirstOrThrow(),
      kysely
        .selectFrom("folders")
        .where((eb) =>
          data.folderId === null
            ? eb("parent_id", "is", null)
            : eb("parent_id", "=", data.folderId),
        )
        .selectAll()
        .orderBy("name", "asc")
        .execute(),
    ]);

    const total = Number(countResult.total);

    return {
      files,
      folders,
      total,
      page: data.page,
      pageSize: data.pageSize,
      totalPages: Math.ceil(total / data.pageSize),
    };
  });
