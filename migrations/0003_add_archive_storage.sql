CREATE TABLE archive_builds (
    build_id TEXT PRIMARY KEY NOT NULL,
    item_identifier TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL CHECK (channel IN ('release', 'nightly')),
    commit_sha TEXT NOT NULL,
    tag TEXT,
    target TEXT,
    folder_path TEXT NOT NULL,
    artifact_count INTEGER NOT NULL CHECK (artifact_count > 0),
    manifest_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'ready', 'failed')),
    diagnostics_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX idx_archive_builds_status ON archive_builds(status);

CREATE TRIGGER trg_archive_builds_updated_at
AFTER UPDATE ON archive_builds
FOR EACH ROW
BEGIN
    UPDATE archive_builds SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE build_id = OLD.build_id;
END;

ALTER TABLE files ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'onedrive'
    CHECK (storage_provider IN ('onedrive', 'ia'));
ALTER TABLE files ADD COLUMN storage_item TEXT;
ALTER TABLE files ADD COLUMN storage_key TEXT;
ALTER TABLE files ADD COLUMN build_id TEXT REFERENCES archive_builds(build_id) ON DELETE SET NULL;
ALTER TABLE files ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('pending', 'ready', 'failed'));
ALTER TABLE files ADD COLUMN sha256 TEXT;
ALTER TABLE files ADD COLUMN md5 TEXT;

CREATE INDEX idx_files_provider_status ON files(storage_provider, status);
CREATE UNIQUE INDEX idx_files_build_storage_key ON files(build_id, storage_key);
