-- Expand the provider constraint while preserving all existing rows and indexes.
CREATE TABLE files_with_telegram (
    id TEXT PRIMARY KEY NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
    storage_provider TEXT NOT NULL DEFAULT 'onedrive'
        CHECK (storage_provider IN ('onedrive', 'ia', 'telegram')),
    storage_item TEXT,
    storage_key TEXT,
    build_id TEXT REFERENCES archive_builds(build_id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready', 'failed')),
    sha256 TEXT,
    md5 TEXT
);

INSERT INTO files_with_telegram SELECT
    id, file_name, file_size, mime_type, hidden, created_at, updated_at, folder_id,
    storage_provider, storage_item, storage_key, build_id, status, sha256, md5
FROM files;

DROP TABLE files;
ALTER TABLE files_with_telegram RENAME TO files;

CREATE INDEX idx_files_hidden ON files(hidden);
CREATE INDEX idx_files_created_at ON files(created_at);
CREATE INDEX idx_files_folder_id ON files(folder_id);
CREATE INDEX idx_files_provider_status ON files(storage_provider, status);
CREATE UNIQUE INDEX idx_files_build_storage_key ON files(build_id, storage_key);

CREATE TRIGGER trg_files_updated_at
AFTER UPDATE ON files
FOR EACH ROW
BEGIN
    UPDATE files SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id;
END;
