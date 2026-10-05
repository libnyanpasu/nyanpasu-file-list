import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

// Exercise the service in Wrangler's actual Worker runtime and a fresh local D1.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const wranglerRequire = createRequire(require.resolve("wrangler/package.json"));
const { Miniflare, convertV4MiniflareOptions } = wranglerRequire("miniflare");
const { build } = wranglerRequire("esbuild");
const artifact = {
  fileName: "installer.zip",
  fileSize: 3,
  sha256: "a".repeat(64),
  md5: "b".repeat(32),
};
const input = {
  schemaVersion: 1,
  buildId: "test-build",
  itemIdentifier: "test-item",
  channel: "nightly",
  commit: "c".repeat(40),
  tag: null,
  folderPath: "nightly/test-build",
  artifacts: [artifact],
};
const bundle = await build({
  absWorkingDir: root,
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
  external: ["cloudflare:workers"],
  tsconfig: "tsconfig.json",
  stdin: {
    resolveDir: root,
    contents: `import { registerArchiveBuild, verifyArchiveBuild } from "./src/services/archive-index.ts";
      export default { async fetch(request) {
        const input = await request.json();
        await registerArchiveBuild(input);
        return Response.json(await verifyArchiveBuild(input.buildId));
      } };`,
  },
});

const cases = [
  { name: "indexed IA bytes become ready in the Worker runtime", ready: true },
  { name: "metadata redirects are not followed", metadataRedirect: true },
  {
    name: "IA Canada download nodes become ready",
    ready: true,
    download: "https://dn711508.ca.archive.org/0/items/test-item/installer.zip",
  },
  {
    name: "legacy IA US download nodes remain supported",
    ready: true,
    download: "https://ia800100.us.archive.org/0/items/test-item/installer.zip",
  },
  {
    name: "external download destinations are not requested",
    download: "https://unexpected.example/installer.zip",
  },
  {
    name: "lookalike IA domains are not requested",
    download:
      "https://dn711508.ca.archive.org.unexpected.example/installer.zip",
  },
  {
    name: "insecure IA download destinations are not requested",
    download: "http://dn711508.ca.archive.org/0/items/test-item/installer.zip",
  },
];

for (const scenario of cases) {
  test(scenario.name, async () => {
    const requests = [];
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0].text,
        compatibilityDate: "2025-09-02",
        compatibilityFlags: ["nodejs_compat"],
        bindings: { IA_ITEM_PREFIX: "test", IA_UPLOADER: "test@example.com" },
        d1Databases: ["D1"],
        outboundService: async (request) => {
          requests.push(request.url);
          if (request.url === "https://archive.org/metadata/test-item") {
            if (scenario.metadataRedirect)
              return new Response(null, {
                status: 302,
                headers: { location: "https://unexpected.example/metadata" },
              });
            return Response.json({
              metadata: {
                identifier: "test-item",
                uploader: "test@example.com",
              },
              files: [
                { name: artifact.fileName, size: "3", md5: artifact.md5 },
              ],
            });
          }
          const originalUrl =
            "https://archive.org/download/test-item/installer.zip";
          if (request.url === originalUrl && scenario.download) {
            return new Response(null, {
              status: 302,
              headers: { location: scenario.download },
            });
          }
          assert.equal(request.url, scenario.download ?? originalUrl);
          assert.equal(request.method, "HEAD");
          return new Response(null, {
            headers: {
              "content-type": "application/zip",
              "content-length": "3",
            },
          });
        },
      }),
    );
    try {
      const db = await runtime.getD1Database("D1");
      for (const migration of [
        "0001_create_files_table.sql",
        "0002_create_folders_table.sql",
        "0003_add_archive_storage.sql",
        "0004_add_telegram_storage.sql",
      ]) {
        const sql = await readFile(
          new URL(`../migrations/${migration}`, import.meta.url),
          "utf8",
        );
        await db.exec(sql.replace(/^--.*$/gm, "").replaceAll("\n", " "));
      }
      const response = await runtime.dispatchFetch(
        "https://worker.test/verify",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.status, scenario.ready ? "ready" : "pending");
      assert.deepEqual(
        result.diagnostics,
        scenario.metadataRedirect
          ? ["IA metadata returned HTTP 302"]
          : scenario.ready
            ? []
            : ["installer.zip: IA download redirected to a non-IA host"],
      );
      assert.equal(
        requests.length,
        scenario.metadataRedirect
          ? 1
          : scenario.ready && scenario.download
            ? 3
            : 2,
      );
      const visible = await db
        .prepare("SELECT COUNT(*) AS count FROM files WHERE status = 'ready'")
        .first();
      assert.equal(visible.count, scenario.ready ? 1 : 0);
    } finally {
      await runtime.dispose();
    }
  });
}
