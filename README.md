# Nyanpasu archive index

Release and nightly packages are published to `@ClashNyanpasu` by the main
repository's MTProto uploader. This Worker indexes successful Telegram upload
receipts and redirects `/bin/:id` to the file's channel message. The destination
is a Telegram post, where users download the document; it is not an HTTP binary
download URL.

Before switching CI to Telegram, deploy this change with migration
`0004_add_telegram_storage.sql`. The existing `UPLOAD_TOKEN` must match CI's
`FILE_SERVER_TOKEN` (or its archive upload token). Telegram bot credentials stay
in CI and are not needed by this Worker.

Authenticated `POST /archive/builds` accepts schema version 2 with
`storageProvider: "telegram"`, `itemIdentifier: "ClashNyanpasu"`, and a `tg-`
build identity. Each artifact contains its original size, SHA-256, MD5,
`messageId` and `documentId`. Identical registration is idempotent; conflicting
receipts or bytes are rejected. New records become visible immediately after
registration. CI checks the receipt against Telegram before registering it.

Existing OneDrive and IA rows survive the migration. When Telegram registers the
same bytes in the same folder, matching IA copies are hidden to avoid duplicate
entries. Other historical files remain available. Private build-cache routes
continue to use their existing storage.

Run `pnpm run test:archive` for Worker/D1 integration checks and `pnpm run build`
for the production build. Deploy through `pnpm run deploy`, which applies remote
migrations before deploying the Worker. After deployment, use the main
repository's storage recovery workflow to transfer retained signed packages or
retry index registration from saved Telegram receipts.
