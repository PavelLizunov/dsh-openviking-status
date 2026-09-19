import React from "react";
import {
  OpenVikingStatusChip,
  OpenVikingStatusChipProps,
  getFallbackSessionMessages,
} from "./OpenVikingStatusChip";
import {
  OpenVikingStatusPopover,
  OpenVikingStatusPopoverProps,
  getProgressBarPercent,
  getProgressBarColor,
  formatRelativeTime,
  formatMemoryLeafName,
  formatEndpoint,
  truncateSessionId,
  getCategoryBadgeStyle,
  handleEscapeKey,
} from "./OpenVikingStatusPopover";
import {
  OpenVikingClient,
  defaultOpenVikingClient,
  checkHealth,
  fetchSession,
  getSession,
  commitSession,
  resolveEndpoint,
  resolveApiKey,
  DEFAULT_OPENVIKING_ENDPOINT,
} from "./api";
import { parseRecalledMemories, inferCategory } from "./recallParser";

export * from "./api";
export * from "./recallParser";
export * from "./OpenVikingStatusChip";
export * from "./OpenVikingStatusPopover";

export type OpenVikingSessionData = import("./api").SessionStatus;
export type OpenVikingHealth = import("./api").HealthStatus;

// Module registration for DSH Web/Desktop runtime
export function apply(ctx: any) {
  ctx.inject(["slots"], (scope: any) => {
    // Inject into conversation composer bar (right side slot)
    scope.slots.inject("conversation.input.right", () =>
      scope.slots.register(
        {
          name: "conversation.input.openviking-status",
          inject: (sessionOrScope: any, extraScope?: any) => {
            let sessionId = "";
            let messages: any[] | undefined;
            let contextText: string | undefined;

            if (typeof sessionOrScope === "string") {
              sessionId = sessionOrScope;
              if (extraScope && typeof extraScope === "object") {
                messages = extraScope.messages || extraScope.session?.messages;
                contextText = extraScope.contextText;
              }
            } else if (sessionOrScope && typeof sessionOrScope === "object") {
              sessionId =
                sessionOrScope.sessionId ||
                sessionOrScope.id ||
                sessionOrScope.session?.id ||
                "";
              messages =
                sessionOrScope.messages || sessionOrScope.session?.messages;
              contextText = sessionOrScope.contextText;
            }

            // Fallback from global DSH store or window if messages not found yet
            if (!messages) {
              messages = getFallbackSessionMessages(sessionId);
            }

            return {
              sessionId,
              messages,
              contextText,
            };
          },
        },
        OpenVikingStatusChip
      )
    );
  });
}

// DSH client module loader export
if (typeof window !== "undefined" && (window as any).__ModuleLoader__) {
  (window as any).__ModuleLoader__.load({
    id: "@openviking-community/dsh-openviking-status",
    factory: (require: any) => {
      const module: any = { exports: {} };
      module.exports.apply = apply;
      module.exports.OpenVikingStatusChip = OpenVikingStatusChip;
      module.exports.getFallbackSessionMessages = getFallbackSessionMessages;
      module.exports.OpenVikingStatusPopover = OpenVikingStatusPopover;
      module.exports.getProgressBarPercent = getProgressBarPercent;
      module.exports.getProgressBarColor = getProgressBarColor;
      module.exports.formatRelativeTime = formatRelativeTime;
      module.exports.formatMemoryLeafName = formatMemoryLeafName;
      module.exports.formatEndpoint = formatEndpoint;
      module.exports.truncateSessionId = truncateSessionId;
      module.exports.getCategoryBadgeStyle = getCategoryBadgeStyle;
      module.exports.handleEscapeKey = handleEscapeKey;
      module.exports.parseRecalledMemories = parseRecalledMemories;
      module.exports.inferCategory = inferCategory;
      module.exports.OpenVikingClient = OpenVikingClient;
      module.exports.defaultOpenVikingClient = defaultOpenVikingClient;
      module.exports.checkHealth = checkHealth;
      module.exports.fetchSession = fetchSession;
      module.exports.getSession = getSession;
      module.exports.commitSession = commitSession;
      module.exports.resolveEndpoint = resolveEndpoint;
      module.exports.resolveApiKey = resolveApiKey;
      module.exports.DEFAULT_OPENVIKING_ENDPOINT = DEFAULT_OPENVIKING_ENDPOINT;
      return module.exports;
    },
  });
}
