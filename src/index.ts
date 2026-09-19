/**
 * OpenViking Status Backend plugin definition for Cordis runtime
 */

export const name = "dsh-openviking-status";
export const inject = ["sessions"];

export function apply(ctx: any) {
  // Cordis lifecycle hooks and client module injection
  ctx.logger?.info?.("[dsh-openviking-status] Plugin loaded");
}
