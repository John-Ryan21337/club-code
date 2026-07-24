export type AtmosphereControlAction =
  | {
      readonly kind: "media";
      readonly action: "next" | "previous" | "play" | "pause" | "stop";
    }
  | {
      readonly kind: "visualizer";
      readonly action: "next" | "previous" | "random" | "toggle";
    };

export interface AtmosphereControlResult {
  readonly handled: boolean;
  readonly message: string;
}

export type AtmosphereControlHandler = (
  action: AtmosphereControlAction,
) => AtmosphereControlResult | Promise<AtmosphereControlResult>;

const handlers = new Set<AtmosphereControlHandler>();

export function registerAtmosphereControlHandler(handler: AtmosphereControlHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export async function requestAtmosphereControl(
  action: AtmosphereControlAction,
): Promise<AtmosphereControlResult> {
  for (const handler of handlers) {
    try {
      const result = await handler(action);
      if (result.handled) return result;
    } catch {
      // A detached media surface must not prevent another active surface from
      // handling the same local command.
    }
  }
  return {
    handled: false,
    message:
      action.kind === "media" ? "No controllable media is active." : "The visualizer is not ready.",
  };
}

export function __resetAtmosphereControlHandlersForTests(): void {
  handlers.clear();
}
