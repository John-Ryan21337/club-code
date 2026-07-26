export class ConfirmedAutoNudgeArming {
  private generation = 0;

  invalidate(): void {
    this.generation += 1;
  }

  async arm(input: {
    persistEnabled: () => Promise<void>;
    start: () => void;
    setArming: (arming: boolean) => void;
  }): Promise<boolean> {
    const generation = this.generation + 1;
    this.generation = generation;
    input.setArming(true);
    try {
      await input.persistEnabled();
      if (this.generation !== generation) return false;
      input.start();
      return true;
    } finally {
      if (this.generation === generation) input.setArming(false);
    }
  }
}
