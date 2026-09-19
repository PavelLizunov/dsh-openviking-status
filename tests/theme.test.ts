import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { THEME, themeVar } from "../lib/client.js";

/**
 * Контракт карты токенов темы.
 *
 * Плагин рисуется инлайновыми стилями, поэтому каждое обращение к теме — это
 * строка `var(--dsw-…)`. Опечатка в имени не ломает рендер: CSS-переменные
 * падают на fallback молча. Именно так плагин однажды уехал на шестнадцать
 * несуществующих имён и полностью перестал следовать теме, выглядя при этом
 * осмысленно.
 *
 * Поэтому соответствие «роль → свойство темы» живёт одной таблицей и
 * проверяется как данные: имя сверяется с тем, что реально объявляет
 * @deepseek-ai/dsh-client-ui-theme. Через отрендеренный HTML это не проверить —
 * пришлось бы выковыривать `var(...)` регулярками, и опечатку в имени такой
 * тест всё равно бы пропустил.
 */

/** Где DSH объявляет свойства темы (использования разбросаны по всем пакетам). */
const THEME_PACKAGE =
  "/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js";

/** Имена свойств, объявленных темой, либо null если DSH рядом не установлен. */
function declaredThemeProperties(): Set<string> | null {
  if (!existsSync(THEME_PACKAGE)) return null;
  const source = readFileSync(THEME_PACKAGE, "utf8");
  return new Set(
    [...source.matchAll(/(--dsw-[a-z0-9-]+)\s*:/gi)].map((m) => m[1]!)
  );
}

test("каждая роль отображается в свойство, объявленное темой DSH", (t) => {
  const declared = declaredThemeProperties();
  if (declared === null) {
    // На CI установки DSH нет: сверять не с чем, и выдумывать нечего.
    t.skip("DSH Desktop не установлен — нечем сверять");
    return;
  }

  assert.ok(
    declared.size > 100,
    `в пакете темы найдено подозрительно мало свойств (${declared.size}) — вероятно, сломан разбор`
  );

  const unknown = Object.entries(THEME)
    .filter(([, property]) => !declared.has(property))
    .map(([role, property]) => `${role} -> ${property}`);

  assert.deepEqual(
    unknown,
    [],
    "эти свойства тема DSH не объявляет, значит они молча упадут на fallback"
  );
});

test("themeVar строит ссылку на свойство без fallback", () => {
  // Fallback скрыл бы отсутствующее свойство — ровно то, что мы и чиним.
  assert.equal(themeVar("panelSurface"), "var(--dsw-specific-menu)");
  assert.equal(themeVar("labelTertiary"), "var(--dsw-alias-label-tertiary)");
});

test("карта покрывает роли, нужные чипу и поповеру", () => {
  const required = [
    "panelSurface",
    "panelElevation",
    "panelStroke",
    "labelPrimary",
    "labelSecondary",
    "labelTertiary",
    "hairline",
    "hoverBackground",
    "activeBackground",
    "stateSuccess",
    "stateError",
    "stateWarning",
    "insetSurface",
    "fontMono",
  ];
  for (const role of required) {
    assert.ok(role in THEME, `в карте темы нет роли ${role}`);
  }
});
