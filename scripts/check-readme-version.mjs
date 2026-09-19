/**
 * Предрелизные проверки манифеста: то, что ломает релиз уже после тега.
 *
 * 1. Ссылка на тарбол в README против текущей версии. Установка рекомендуется
 *    по версионному URL: плавающий `/releases/latest/download/…` не получает
 *    `integrity` и ломает последующие `pnpm install` в профиле пользователя
 *    (ADR 0004). Плата за это — номер версии в README живёт вручную и расходится
 *    тихо: команда из README продолжает работать, просто ставит старую версию.
 *
 * 2. `repository.url` в манифесте. Публикация идёт через trusted publishing, а
 *    npm сверяет это поле с репозиторием, который собрал пакет, и отвергает
 *    расхождение: `422 ... "repository.url" is "", expected to match ...`.
 *    Сбой случается в самом конце релиза — после тега и GitHub Release, — и
 *    оставляет реестр на версию позади.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const { version, name, repository } = manifest;
const readme = readFileSync(join(root, "README.md"), "utf8");

const problems = [];

// Провенанс сверяет владельца и имя репозитория, а не точную форму URL,
// поэтому проверяем именно их.
const EXPECTED_REPO = "github.com/dipertq/dsh-openviking-status";
const repoUrl = typeof repository === "string" ? repository : repository?.url;
if (!repoUrl) {
  problems.push(
    "в package.json нет repository.url — npm отвергнет публикацию с provenance (422)"
  );
} else if (!repoUrl.includes(EXPECTED_REPO)) {
  problems.push(
    `repository.url указывает на ${repoUrl}, а provenance ожидает ${EXPECTED_REPO}`
  );
}

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
  console.error(`Проверка манифеста не пройдена (версия ${version}):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nЭти расхождения ломают релиз уже после тега, поэтому ловятся здесь."
  );
  process.exit(1);
}

console.log(`manifest checks passed for version ${version}`);
