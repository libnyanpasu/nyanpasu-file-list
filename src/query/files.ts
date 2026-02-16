import { kysely } from "@/lib/kysely";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getFileList = createServerFn()
  .inputValidator(
    z.object({
      page: z.number(),
      pageSize: z.number(),
    }),
  )
  .handler(async ({ data }) => {
    const offset = (data.page - 1) * data.pageSize;

    const [files, countResult] = await Promise.all([
      kysely
        .selectFrom("files")
        .where("hidden", "=", 0)
        .orderBy("created_at", "desc")
        .limit(data.pageSize)
        .offset(offset)
        .selectAll()
        .execute(),
      kysely
        .selectFrom("files")
        .where("hidden", "=", 0)
        .select(kysely.fn.countAll().as("total"))
        .executeTakeFirstOrThrow(),
    ]);

    const total = Number(countResult.total);

    return {
      files,
      total,
      page: data.page,
      pageSize: data.pageSize,
      totalPages: Math.ceil(total / data.pageSize),
    };
  });
