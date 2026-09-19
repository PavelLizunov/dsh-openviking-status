import { OpenVikingStatusChip } from "./OpenVikingStatusChip";

export * from "./api";
export * from "./theme";
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
 * Занимает ячейку в `conversation.composer.dock` — списочном слоте строки
 * статистики под композером, где уже живут чипы вроде «24 turns 645 steps».
 * Там место пассивным показаниям; внутри композера чип читался как управляющий
 * элемент.
 *
 * Слот со скоупом сессии, поэтому `sessionId` и `useChat` приходят стандартными
 * пропами. Свой `id` обязателен: чужой занял бы и заменил ячейку соседа, а
 * `order` выше нуля ставит чип после штатной статистики.
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
}
