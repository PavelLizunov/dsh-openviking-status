import { OpenVikingStatusChip } from "./OpenVikingStatusChip";

export * from "./api";
export * from "./recallParser";
export * from "./OpenVikingStatusChip";
export * from "./OpenVikingStatusPopover";

export type OpenVikingSessionData = import("./api").SessionStatus;
export type OpenVikingHealth = import("./api").HealthStatus;

/** Имя пакета, под которым DSH регистрирует клиентскую половину плагина. */
export const name = "@dipertq/dsh-openviking-status";

/** Сервисы Cordis, которые должны быть готовы до вызова `apply`. */
export const inject = ["slots"];

/**
 * Точка входа клиентского плагина DSH.
 *
 * Занимает одну ячейку в `conversation.input.right` — списочном слоте строки
 * ввода со скоупом сессии. Скоуп означает, что `sessionId` приходит в компонент
 * как стандартный проп: доставать его из глобального стора не требуется.
 */
export function apply(ctx: any) {
  ctx.effect(
    () =>
      ctx.slots.inject("conversation.input.right", () =>
        ctx.slots.register(
          {
            name: "conversation.input.right",
            id: "openviking-status",
            order: 50,
            label: "OpenViking",
          },
          OpenVikingStatusChip
        )
      ),
    "openviking-status: composer chip"
  );
}
