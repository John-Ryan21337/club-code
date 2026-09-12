interface ServerSettingsWriteState {
  readonly pending: number;
  readonly revision: number;
}

let state: ServerSettingsWriteState = { pending: 0, revision: 0 };
const listeners = new Set<() => void>();

export const getServerSettingsWriteState = () => state;
export function subscribeServerSettingsWrites(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: ServerSettingsWriteState) {
  state = next;
  for (const listener of listeners) listener();
}

/** Mark before optimistic publication; release only after persistence or rollback. */
export async function trackServerSettingsWrite<T>(write: () => Promise<T>): Promise<T> {
  publish({ pending: state.pending + 1, revision: state.revision + 1 });
  try {
    return await write();
  } finally {
    publish({ pending: state.pending - 1, revision: state.revision });
  }
}
