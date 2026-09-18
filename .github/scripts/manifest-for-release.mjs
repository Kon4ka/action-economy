/**
 * Шаг релиза: подготовить манифест, который уедет в архив и в ассеты релиза.
 *
 * Правки не коммитятся обратно в репозиторий: в рабочей копии остаётся манифест
 * разработчика с включённой горячей перезагрузкой.
 */

import fs from "node:fs";

const MODULE_ID = "action-economy";
const repository = process.env.GITHUB_REPOSITORY ?? "Kon4ka/action-economy";
const tag = process.env.RELEASE_TAG;
const branch = process.env.DEFAULT_BRANCH ?? "master";

if ( !tag ) {
  console.error("Не задан RELEASE_TAG");
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync("module.json", "utf8"));
const base = `https://github.com/${repository}`;

manifest.url = base;
manifest.manifest = `${base}/releases/latest/download/module.json`;
manifest.download = `${base}/releases/download/${tag}/${MODULE_ID}.zip`;
manifest.readme = `${base}/blob/${branch}/README.md`;
manifest.changelog = `${base}/blob/${branch}/CHANGELOG.md`;
manifest.bugs = `${base}/issues`;
manifest.flags = { ...manifest.flags, hotReload: false };

fs.writeFileSync("module.json", `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Манифест собран для ${tag}`);
