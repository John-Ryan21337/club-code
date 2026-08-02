let queue: Promise<void> = Promise.resolve();

/**
 * Serializes confirmed settings writes so a slower earlier response cannot
 * overwrite a later operator choice.
 */
export function enqueueConfirmedSettingsWrite<T>(write: () => Promise<T>): Promise<T> {
  const operation = queue.then(write);
  queue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

export function __resetConfirmedSettingsWriteQueueForTests(): void {
  queue = Promise.resolve();
}
