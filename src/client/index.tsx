import { OpenVikingStatusChip } from "./OpenVikingStatusChip";
import { OpenVikingSettingsSection } from "./OpenVikingSettingsSection";

export * from "./api";
export * from "./theme";
export * from "./recallParser";
export * from "./OpenVikingStatusChip";
export * from "./OpenVikingStatusPopover";
export * from "./OpenVikingSettingsSection";

export type OpenVikingSessionData = import("./api").SessionStatus;
export type OpenVikingHealth = import("./api").HealthStatus;

/** Имя пакета, под которым DSH регистрирует клиентскую половину плагина. */
export const name = "@dipertq/dsh-openviking-status";

/** Сервисы Cordis, которые должны быть готовы до вызова `apply`. */
export const inject = ["slots"];

/**
 * Точка входа клиентского плагина DSH.
 *
 * 1. Занимает ячейку в `conversation.composer.dock` — чип со статусом OpenViking
 *    под композером чата.
 * 2. Регистрирует раздел `settings.section` — страницу настроек OpenViking Status
 *    в меню настроек DSH Desktop и Web.
 */
export function apply(ctx: any) {
  ctx.effect(
    () =>
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "openviking-status",
            order: 50,
            label: "OpenViking",
          },
          OpenVikingStatusChip
        )
      ),
    "openviking-status: composer stats chip"
  );

  ctx.effect(
    () =>
      ctx.slots.inject("settings.section", () =>
        ctx.slots.register(
          {
            name: "settings.section",
            id: "openviking-status",
            order: 35,
            label: () => "OpenViking",
          },
          OpenVikingSettingsSection
        )
      ),
    "openviking-status: settings section"
  );
}
