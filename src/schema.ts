import { z } from "zod";
import type { Generated } from "kysely";

export const FilesSchema = z.object({
  id: z.uuid(),
  file_name: z.string(),
  file_size: z.number().default(0),
  mime_type: z.string().nullable(),
  hidden: z.number().default(0),
  folder_id: z.string().nullable().default(null),
  storage_provider: z.enum(["onedrive", "ia"]).default("onedrive"),
  storage_item: z.string().nullable().default(null),
  storage_key: z.string().nullable().default(null),
  build_id: z.string().nullable().default(null),
  status: z.enum(["pending", "ready", "failed"]).default("ready"),
  sha256: z.string().nullable().default(null),
  md5: z.string().nullable().default(null),
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
  storage_provider: Generated<"onedrive" | "ia">;
  storage_item: string | null;
  storage_key: string | null;
  build_id: string | null;
  status: Generated<"pending" | "ready" | "failed">;
  sha256: string | null;
  md5: string | null;
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
  archive_builds: ArchiveBuildsTable;
}

export interface ArchiveBuildsTable {
  build_id: string;
  item_identifier: string;
  channel: "release" | "nightly";
  commit_sha: string;
  tag: string | null;
  target: string | null;
  folder_path: string;
  artifact_count: number;
  manifest_json: string;
  status: Generated<"pending" | "ready" | "failed">;
  diagnostics_json: Generated<string>;
  created_at: Generated<string>;
  updated_at: Generated<string>;
}
