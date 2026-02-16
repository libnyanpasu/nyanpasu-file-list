-- Migration: Create folders table and add folder_id to files

CREATE TABLE folders (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE CASCADE
);

CREATE INDEX idx_folders_parent_id ON folders(parent_id);
CREATE UNIQUE INDEX idx_folders_name_parent ON folders(name, parent_id);

CREATE TRIGGER trg_folders_updated_at
AFTER UPDATE ON folders
FOR EACH ROW
BEGIN
    UPDATE folders SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = OLD.id;
END;

-- Add folder_id to files table
ALTER TABLE files ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX idx_files_folder_id ON files(folder_id);
