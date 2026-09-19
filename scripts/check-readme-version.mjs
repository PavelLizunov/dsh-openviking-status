/**
 * Проверка, что ссылка на тарбол в README указывает на текущую версию пакета.
 *
 * Установка рекомендуется по версионному URL: плавающий
 * `/releases/latest/download/…` не получает `integrity` и ломает последующие
 * `pnpm install` в профиле пользователя (ADR 0004). Плата за это — номер версии
 * в README живёт вручную и легко отстаёт от `package.json`, а расходится он
 * тихо: команда из README продолжает работать, просто ставит старую версию.
 *
 * Скрипт превращает это из незаметного расхождения в падение CI.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version, name } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8")
);
const readme = readFileSync(join(root, "README.md"), "utf8");

const problems = [];

// Плавающая ссылка не должна попасть в документацию ни при каких условиях,
// кроме абзаца, который объясняет, почему её нельзя использовать.
for (const line of readme.split("\n")) {
  if (
    line.includes("releases/latest/download") &&
    line.trim().startsWith("d")
  ) {
    problems.push(
      `README предлагает плавающую ссылку как команду: ${line.trim()}`
    );
  }
}

const tarballUrls = [
  ...readme.matchAll(/releases\/download\/v([\d.]+)\/([\w.@/-]+\.tgz)/g),
];

if (tarballUrls.length === 0) {
  problems.push("в README нет ни одной версионной ссылки на тарбол релиза");
}

const expectedAsset = `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;

for (const [, urlVersion, asset] of tarballUrls) {
  if (urlVersion !== version) {
    problems.push(
      `ссылка указывает на v${urlVersion}, а package.json объявляет ${version}`
    );
  }
  if (asset !== expectedAsset) {
    problems.push(
      `имя ассета ${asset} не совпадает с ожидаемым ${expectedAsset}`
    );
  }
}

if (problems.length > 0) {
  console.error("README рассинхронизирован с package.json:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    `\nОбновите ссылку на установку в README.md до версии ${version}.`
  );
  process.exit(1);
}

console.log(`README install URL matches package version ${version}`);
