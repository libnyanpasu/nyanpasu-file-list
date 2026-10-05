import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const bundle = await build({
  absWorkingDir: root,
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  external: ["cloudflare:workers"],
  tsconfig: "tsconfig.json",
  plugins: [
    {
      name: "route-fixture",
      setup(builder) {
        builder.onResolve({ filter: /^@tanstack\/react-router$/ }, () => ({
          path: "router",
          namespace: "fixture",
        }));
        builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
          contents:
            "export const createFileRoute = () => (options) => ({ options });",
          loader: "js",
        }));
      },
    },
  ],
  stdin: {
    resolveDir: root,
    contents: `
    import { Route as registration } from "./src/routes/(api)/archive/builds/route.ts";
    import { Route as download } from "./src/routes/(api)/bin/$id.ts";
    export default { fetch(request) {
      const pathname = new URL(request.url).pathname;
      return pathname.startsWith('/bin/')
        ? download.options.server.handlers.GET({ request, params: { id: pathname.slice(5) } })
        : registration.options.server.handlers.POST({ request });
    } };`,
  },
});
const input = {
  schemaVersion: 2,
  storageProvider: "telegram",
  buildId: "tg-test-build",
  itemIdentifier: "ClashNyanpasu",
  channel: "release",
  commit: "c".repeat(40),
  tag: "v2.0.0",
  folderPath: "release/v2.0.0",
  target: "windows-x86_64",
  publishedAt: "2026-10-06T00:00:00.000Z",
  artifacts: [
    {
      fileName: "installer.exe",
      fileSize: 3,
      sha256: "a".repeat(64),
      md5: "b".repeat(32),
      messageId: 123,
      documentId: "456",
    },
  ],
};

test("Telegram registration is authenticated, idempotent, visible and redirects to its channel message", async () => {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: "2025-09-02",
      compatibilityFlags: ["nodejs_compat"],
      bindings: { UPLOAD_TOKEN: "test-token" },
      d1Databases: ["D1"],
      outboundService: () => {
        throw new Error("Telegram indexing must not fetch Bot API or IA");
      },
    }),
  );
  try {
    const db = await runtime.getD1Database("D1");
    for (const migration of [
      "0001_create_files_table.sql",
      "0002_create_folders_table.sql",
      "0003_add_archive_storage.sql",
    ]) {
      const sql = await readFile(
        new URL(`../migrations/${migration}`, import.meta.url),
        "utf8",
      );
      await db.exec(sql.replace(/^--.*$/gm, "").replaceAll("\n", " "));
    }
    await db
      .prepare(
        "INSERT INTO files (id, file_name, storage_provider) VALUES ('legacy-onedrive', 'old.zip', 'onedrive'), ('legacy-ia', 'old-ia.zip', 'ia')",
      )
      .run();
    const migration = await readFile(
      new URL("../migrations/0004_add_telegram_storage.sql", import.meta.url),
      "utf8",
    );
    await db.exec(migration.replace(/^--.*$/gm, "").replaceAll("\n", " "));
    assert.equal(
      (await db.prepare("SELECT COUNT(*) AS count FROM files").first()).count,
      2,
    );
    assert.equal(
      (await db.prepare("PRAGMA foreign_key_check").all()).results.length,
      0,
    );
    const post = (body, auth = true) =>
      runtime.dispatchFetch("https://worker.test/archive/builds", {
        method: "POST",
        headers: auth ? { authorization: "Bearer test-token" } : {},
        body: JSON.stringify(body),
      });
    assert.equal((await post(input, false)).status, 401);
    assert.equal(
      (await post({ ...input, itemIdentifier: "external-channel" })).status,
      400,
    );
    assert.equal(
      (
        await post({
          ...input,
          artifacts: [{ ...input.artifacts[0], messageId: -1 }],
        })
      ).status,
      400,
    );
    await db
      .prepare(
        "INSERT INTO folders (id, name, parent_id) VALUES ('release-root', 'release', NULL), ('release-tag', 'v2.0.0', 'release-root')",
      )
      .run();
    await db
      .prepare(
        "INSERT INTO files (id, file_name, file_size, folder_id, storage_provider, sha256) VALUES ('prior-ia-copy', 'installer.exe', 3, 'release-tag', 'ia', ?)",
      )
      .bind(input.artifacts[0].sha256)
      .run();
    const response = await post(input);
    assert.equal(response.status, 200);
    const indexed = await response.json();
    assert.equal(indexed.status, "ready");
    assert.equal(indexed.schemaVersion, 2);
    assert.equal(indexed.storageProvider, "telegram");
    assert.equal(
      (
        await db
          .prepare("SELECT hidden FROM files WHERE id = 'prior-ia-copy'")
          .first()
      ).hidden,
      1,
    );
    assert.equal((await post(input)).status, 200);
    assert.equal(
      (
        await db
          .prepare("SELECT COUNT(*) AS count FROM files WHERE build_id = ?")
          .bind(input.buildId)
          .first()
      ).count,
      1,
    );
    assert.equal(
      (
        await post({
          ...input,
          artifacts: [{ ...input.artifacts[0], sha256: "d".repeat(64) }],
        })
      ).status,
      409,
    );
    const id = indexed.artifacts[0].fileId;
    const redirect = await runtime.dispatchFetch(
      `https://worker.test/bin/${id}`,
      { redirect: "manual" },
    );
    assert.equal(redirect.status, 302);
    assert.equal(
      redirect.headers.get("location"),
      "https://t.me/ClashNyanpasu/123",
    );
    await db.prepare("UPDATE files SET hidden = 1 WHERE id = ?").bind(id).run();
    assert.equal(
      (await runtime.dispatchFetch(`https://worker.test/bin/${id}`)).status,
      404,
    );
    await db
      .prepare(
        "UPDATE files SET hidden = 0, storage_item = 'evil.example' WHERE id = ?",
      )
      .bind(id)
      .run();
    assert.equal(
      (await runtime.dispatchFetch(`https://worker.test/bin/${id}`)).status,
      503,
    );
    assert.equal(
      (
        await db
          .prepare(
            "SELECT COUNT(*) AS count FROM files WHERE id LIKE 'legacy-%'",
          )
          .first()
      ).count,
      2,
    );
  } finally {
    await runtime.dispose();
  }
});
