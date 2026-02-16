import { z } from "zod";
import type { Generated } from "kysely";

export const FilesSchema = z.object({
  id: z.uuid(),
  file_name: z.string(),
  file_size: z.number().default(0),
  mime_type: z.string().nullable(),
  hidden: z.number().default(0),
  folder_id: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Files = z.infer<typeof FilesSchema>;

export interface FilesTable {
  id: string;
  file_name: string;
  file_size: Generated<number>;
  mime_type: string | null;
  hidden: Generated<number>;
  folder_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export const FoldersSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  parent_id: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Folders = z.infer<typeof FoldersSchema>;

export interface FoldersTable {
  id: string;
  name: string;
  parent_id: string | null;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}

export interface Database {
  files: FilesTable;
  folders: FoldersTable;
}
