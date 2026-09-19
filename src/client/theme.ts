/**
 * Соответствие «визуальная роль → свойство темы DSH».
 *
 * Плагин стилизуется инлайново, поэтому каждое обращение к теме — строка
 * `var(--dsw-…)`. CSS-переменные падают на fallback молча, и опечатка в имени
 * выглядит как работающий код: именно так плагин однажды уехал на шестнадцать
 * несуществующих свойств и перестал следовать теме вовсе, сохранив осмысленный
 * вид.
 *
 * Единая таблица делает набор имён проверяемым как данные (`tests/theme.test.ts`
 * сверяет их с тем, что объявляет `@deepseek-ai/dsh-client-ui-theme`), а заодно
 * не даёт разойтись значениям между чипом и поповером.
 *
 * Значения подобраны по штатным компонентам DSH: чип повторяет `StatsPills`,
 * панель — диалог статистики сессии из `@deepseek-ai/dsh-client-ui-chat`.
 */
export const THEME = {
  /** Фон всплывающей панели — тот же, что у меню и диалогов DSH. */
  panelSurface: "--dsw-specific-menu",
  /** Тень панели. */
  panelElevation: "--dsw-elevation-prominent",
  /** Контур панели; задаётся через переменную тени, а не через border. */
  panelStroke: "--dsw-alias-border-l1",

  /** Заголовки и акцентный текст. */
  labelPrimary: "--dsw-alias-label-primary",
  /** Основной текст панели. */
  labelSecondary: "--dsw-alias-label-secondary",
  /** Приглушённый текст: подписи, значения, текст чипа в покое. */
  labelTertiary: "--dsw-alias-label-tertiary",

  /** Разделительная линия внутри панели. */
  hairline: "--dsw-alias-border-l2",

  /** Подсветка интерактивного элемента под курсором. */
  hoverBackground: "--dsw-alias-interactive-bg-hover",
  /** Подсветка нажатого элемента. */
  activeBackground: "--dsw-alias-interactive-bg-active",

  /** Демон доступен. */
  stateSuccess: "--dsw-alias-state-success-primary",
  /** Демон недоступен или сессия нечитаема. */
  stateError: "--dsw-alias-state-error-primary",
  /** Идёт коммит, либо накоплено близко к порогу. */
  stateWarning: "--dsw-alias-state-warn-primary",

  /** Утопленная поверхность: дорожка прогресс-бара. */
  insetSurface: "--dsw-alias-bg-layer-2",

  /** Моноширинный шрифт для идентификаторов и путей. */
  fontMono: "--dsw-font-markdown-code-font-family",
} as const;

/** Роль в карте темы. */
export type ThemeRole = keyof typeof THEME;

/**
 * Ссылка на свойство темы для инлайнового стиля.
 *
 * Намеренно без fallback: подставленное значение скрыло бы отсутствующее
 * свойство и вернуло бы ровно тот сбой, ради которого заведена эта карта.
 */
export function themeVar(role: ThemeRole): string {
  return `var(${THEME[role]})`;
}
