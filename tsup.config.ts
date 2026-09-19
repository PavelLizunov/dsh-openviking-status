import { defineConfig } from "tsup";

const CLIENT_ENTRY = "src/client/index.tsx";
const PACKAGE_ID = "@dipertq/dsh-openviking-status";

/** React резолвится модульной системой DSH, а не бандлится в плагин. */
const REACT_EXTERNALS = ["react", "react-dom", "react/jsx-runtime"];

/**
 * Три артефакта с несовместимыми контрактами загрузки.
 *
 * 1. `lib/index.js` — хостовая половина: обычный ESM для Cordis в Node.
 *
 * 2. `lib/client.js` — браузерная половина. DSH подаёт её как `<script>` внутри
 *    combo-бандла, поэтому это НЕ модуль: ни `exports`, ни `module`, ни `import`
 *    вокруг неё нет. Контракт `@deepseek-ai/dsh-client-modules` требует, чтобы
 *    исполнение файла синхронно вызвало `window.__ModuleLoader__.load({id, factory})`,
 *    а зависимости запрашивались через `require` внутри factory. Поэтому CJS-тело
 *    заворачивается баннером и футером в эту регистрацию — ровно тем же приёмом,
 *    что и штатные клиентские бандлы DSH.
 *
 * 3. `lib/client.mjs` — тот же клиентский код как обычный ESM. Нужен, потому что
 *    завёрнутый бандл импортировать нельзя, а Node не умеет исполнять JSX
 *    напрямую; тесты и потребители типов ходят сюда.
 */
export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    outDir: "lib",
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    external: ["@deepseek-ai/cordis"],
  },
  {
    entry: { client: CLIENT_ENTRY },
    outDir: "lib",
    format: ["cjs"],
    dts: true,
    clean: false,
    sourcemap: true,
    platform: "browser",
    external: REACT_EXTERNALS,
    banner: {
      js: [
        "window.__ModuleLoader__.load({",
        `  id: ${JSON.stringify(PACKAGE_ID)},`,
        "  factory: (require) => {",
        "    var module = { exports: {} };",
        "    var exports = module.exports;",
      ].join("\n"),
    },
    footer: {
      js: ["    return module.exports;", "  },", "});"].join("\n"),
    },
  },
  {
    entry: { client: CLIENT_ENTRY },
    outDir: "lib",
    format: ["esm"],
    dts: false,
    clean: false,
    sourcemap: true,
    external: REACT_EXTERNALS,
  },
]);
