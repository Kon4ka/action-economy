/**
 * Шаг релиза: поднять патч-версию, собрать заметки из коммитов и дописать их в CHANGELOG.
 *
 * Запускается из GitHub Actions в корне репозитория. Результат:
 *   - module.json с новой версией;
 *   - CHANGELOG.md с новой секцией сверху;
 *   - release-notes.md — тело релиза;
 *   - version/tag в $GITHUB_OUTPUT.
 *
 * Если в CHANGELOG есть непустая секция «Unreleased», в заметки идёт она, а не список
 * коммитов: так можно написать нормальный текст руками, когда он важен.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";

const MODULE_ID = "action-economy";

/* -------------------------------------------- */

const manifest = JSON.parse(fs.readFileSync("module.json", "utf8"));
const [major, minor, patch] = String(manifest.version).split(".").map(Number);
const version = [major || 0, minor || 0, (patch || 0) + 1].join(".");
const tag = `v${version}`;
const today = new Date().toISOString().slice(0, 10);

/** Коммиты с прошлого тега: заголовки без служебных и релизных. */
function commitLines() {
  let range = "HEAD";
  try {
    const last = execSync("git describe --tags --abbrev=0", { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    if ( last ) range = `${last}..HEAD`;
  } catch { /* тегов ещё нет — берём всю историю */ }

  const log = execSync(`git log --no-merges --pretty=format:%s ${range}`).toString().trim();
  return log.split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.includes("[skip release]"))
    .slice(0, 50)
    .map(line => `- ${line}`);
}

/** Ручная секция «Unreleased», если её заполнили. */
function unreleasedSection(changelog) {
  const match = changelog.match(/##\s*\[?Unreleased\]?[^\n]*\n([\s\S]*?)(?=\n## |$)/i);
  const body = match?.[1]?.trim();
  return body || null;
}

/* -------------------------------------------- */

const changelogPath = "CHANGELOG.md";
const changelog = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, "utf8") : "# Changelog\n";

const manual = unreleasedSection(changelog);
const notesBody = manual || commitLines().join("\n") || "- Технический релиз без изменений в коде.";

const section = `## [${version}] — ${today}\n\n${notesBody}\n`;

// Новая секция встаёт перед первой существующей, а «Unreleased» опустошается.
let updated = changelog.replace(/##\s*\[?Unreleased\]?[^\n]*\n[\s\S]*?(?=\n## |$)/i, "").trimEnd();
const firstSection = updated.search(/^## /m);
updated = firstSection === -1
  ? `${updated}\n\n${section}`
  : `${updated.slice(0, firstSection)}${section}\n${updated.slice(firstSection)}`;

fs.writeFileSync(changelogPath, `${updated.trimEnd()}\n`);

manifest.version = version;
fs.writeFileSync("module.json", `${JSON.stringify(manifest, null, 2)}\n`);

// Тело релиза: изменения плюс инструкция по установке.
const repository = process.env.GITHUB_REPOSITORY ?? "Kon4ka/action-economy";
const notes = `${notesBody}

## Установка в Foundry VTT

В Foundry: **Настройки → Модули → Установить модуль**, в поле «Манифест» вставить

\`\`\`
https://github.com/${repository}/releases/latest/download/module.json
\`\`\`

Вручную: скачать \`${MODULE_ID}.zip\` из этого релиза и распаковать в \`Data/modules/${MODULE_ID}\`,
затем включить модуль в настройках мира.

## Installation

In Foundry: **Settings → Add-on Modules → Install Module**, paste this manifest URL:

\`\`\`
https://github.com/${repository}/releases/latest/download/module.json
\`\`\`

Or download \`${MODULE_ID}.zip\` from this release and unpack it into \`Data/modules/${MODULE_ID}\`.
`;

fs.writeFileSync("release-notes.md", notes);

if ( process.env.GITHUB_OUTPUT ) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\ntag=${tag}\n`);
}

console.log(`Версия ${version}, тег ${tag}`);
