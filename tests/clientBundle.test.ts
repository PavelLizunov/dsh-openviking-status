import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Контракт клиентского бандла DSH.
 *
 * `lib/client.js` подаётся браузеру как `<script>` внутри combo-бандла — это не
 * ES-модуль и не CJS-модуль. Единственный контракт, описанный в
 * `@deepseek-ai/dsh-client-modules`: исполнение файла обязано синхронно вызвать
 * `window.__ModuleLoader__.load({ id, factory })`. Если этого не происходит,
 * загрузчик падает с "loaded without registering ... via __ModuleLoader__.load"
 * и DSH уводит профиль в Recovery Mode.
 *
 * Тест исполняет собранный артефакт ровно так, как это делает браузер, поэтому
 * ловит регрессии формата сборки (например, возврат к обычному CJS/ESM выводу),
 * которые юнит-тесты на исходники увидеть не могут.
 */

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "lib", "client.cjs");
const nodeRequire = createRequire(import.meta.url);

/**
 * Имя читается из манифеста, а не дублируется здесь: DSH ищет фабрику по
 * идентификатору, равному имени пакета, поэтому расхождение между манифестом и
 * бандлом — это сбой загрузки, который тест обязан поймать сам.
 */
const { name: packageName } = JSON.parse(
  readFileSync(join(here, "..", "package.json"), "utf8")
) as { name: string };

interface Registration {
  id: string;
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>;
}

/** Исполнить бандл в подставном окружении и вернуть его регистрацию. */
function loadBundle(): Registration {
  const source = readFileSync(bundlePath, "utf8");
  const registrations: Registration[] = [];

  const windowStub = {
    __ModuleLoader__: {
      load(registration: Registration) {
        registrations.push(registration);
      },
    },
  };

  // Бандл исполняется как скрипт: ни exports, ни module, ни import вокруг него
  // нет. Отсутствие этих имён в области видимости — часть проверки.
  const run = new Function("window", "globalThis", source);
  run(windowStub, windowStub);

  assert.equal(
    registrations.length,
    1,
    "бандл обязан ровно один раз вызвать window.__ModuleLoader__.load"
  );
  return registrations[0]!;
}

test("клиентский бандл регистрируется через __ModuleLoader__.load", () => {
  const registration = loadBundle();

  assert.equal(
    registration.id,
    packageName,
    "id регистрации обязан совпадать с именем пакета: по нему DSH ищет фабрику"
  );
  assert.equal(typeof registration.factory, "function");
});

test("фабрика бандла отдаёт контракт плагина Cordis", () => {
  const registration = loadBundle();
  const exports = registration.factory((specifier) =>
    nodeRequire(specifier)
  ) as Record<string, unknown>;

  assert.equal(typeof exports.apply, "function", "нужен экспорт apply(ctx)");
  assert.equal(exports.name, packageName);
  assert.deepEqual(
    exports.inject,
    ["slots"],
    "плагин занимает слот, поэтому обязан объявить зависимость от slots"
  );
  assert.equal(typeof exports.OpenVikingStatusChip, "function");
});

test("apply занимает ячейку conversation.composer.dock", () => {
  const registration = loadBundle();
  const exports = registration.factory((specifier) =>
    nodeRequire(specifier)
  ) as Record<string, unknown>;

  const injected: string[] = [];
  const registered: Array<Record<string, unknown>> = [];
  let disposed = false;

  const ctx = {
    effect(factory: () => () => void) {
      const dispose = factory();
      assert.equal(
        typeof dispose,
        "function",
        "эффект обязан вернуть disposer, иначе ячейка переживёт выгрузку плагина"
      );
      disposed = true;
      dispose();
    },
    slots: {
      inject(slotName: string, factory: () => () => void) {
        injected.push(slotName);
        return factory();
      },
      register(options: Record<string, unknown>) {
        registered.push(options);
        return () => {};
      },
    },
  };

  (exports.apply as (ctx: unknown) => void)(ctx);

  assert.deepEqual(injected, ["conversation.composer.dock"]);
  assert.equal(registered.length, 1);
  assert.equal(registered[0]!.name, "conversation.composer.dock");
  // Свой id: чужой занял бы и заменил ячейку соседнего плагина — штатная
  // статистика DSH сидит в этом же слоте под id "stats".
  assert.equal(registered[0]!.id, "openviking-status");
  assert.ok(
    (registered[0]!.order as number) > 0,
    "order обязан быть выше нуля, иначе чип встанет перед штатной статистикой"
  );
  assert.equal(disposed, true);
});
