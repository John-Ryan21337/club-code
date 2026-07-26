import type {
  AmbianceEffect,
  AmbianceReactMode,
  OrchestrationSessionStatus,
} from "@cafecode/contracts";

/**
 * Ambiance weather engine.
 *
 * A decorative canvas-2D particle renderer drawn over the app chrome
 * (pointer-events: none). This is a direct TypeScript port of the approved
 * ambiance mockup so the shipped effects look identical to the design:
 * five effects (stars / rain / snow / matrix / fire), a "drive" value that
 * eases toward a target derived from settings intensity plus optional thread
 * reaction signals, a wind term fed by tool bursts, and per-surface clipping
 * (sidebar column vs. the rest of the window).
 *
 * Reliability/perf constraints (see AGENTS.md):
 * - The engine is renderer-only decoration. It consumes projected thread
 *   state pushed in by the layer component; it must never synthesize
 *   lifecycle truth, and nothing here feeds back into orchestration.
 * - All particle pools are fixed-size and independent of chat history,
 *   thread count, or turn duration. Per-frame work is bounded by the pools
 *   and the (drive-scaled) draw counts, exactly like the mockup.
 * - The RAF loop only runs while `start()` is active; the owning layer stops
 *   it when ambiance is disabled, the document is hidden, or background
 *   animations are paused, so long provider runs never pay for hidden frames.
 */

export type AmbianceSurfacesConfig = {
  sidebar: boolean;
  thread: boolean;
};

export type AmbianceEngineConfig = {
  effect: AmbianceEffect;
  /** Baseline density 0..1 before the thread has any say. */
  intensity: number;
  reactMode: AmbianceReactMode;
  /** #rrggbb weather tint (already resolved from settings/accent fallback). */
  tint: string;
  surfaces: AmbianceSurfacesConfig;
  /** Freeze particle motion for prefers-reduced-motion users. */
  reducedMotion: boolean;
};

/**
 * Session drive targets from the mockup: how "busy" the sky is for each
 * orchestration session status before intensity scaling.
 */
const SESSION_DRIVE: Record<OrchestrationSessionStatus | "idle", number> = {
  idle: 0.16,
  ready: 0.2,
  starting: 0.44,
  running: 0.62,
  interrupted: 0.1,
  stopped: 0.05,
  error: 0.85,
};

/** State colors mirroring the mockup tokens (danger/warn/neutral). */
const FAULT_COLOR = "#ef4444";
const HOLD_COLOR = "#f5a524";
const SETTLED_COLOR = "#9aa3ad";
const FALLBACK_TINT = "#48cfff";

const LAYER_SPEED = [0.42, 0.72, 1.15] as const;
const FIRE_STOPS = ["#fff6d5", "#ffd166", "#ff8c1a", "#e8471c", "#7a1206"] as const;
const GLYPHS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓ0123456789<>[]{}/\\=+-*";

type Drop = { x: number; y: number; l: number; v: number };
type Flake = {
  layer: 0 | 1 | 2;
  bx: number;
  y: number;
  r: number;
  ph: number;
  sf: number;
  sa: number;
  v: number;
  th: number;
};
type MatrixColumn = { x: number; y: number; v: number; len: number; t: number; th: number };
type FireParticle = {
  spark: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  max: number;
  life: number;
  ph: number;
};
type Star = { x: number; y: number; r: number; ph: number; v: number };

function rnd(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function hexRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ];
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a);
  const y = hexRgb(b);
  let out = "#";
  for (let i = 0; i < 3; i++) {
    const channel = Math.round(x[i]! + (y[i]! - x[i]!) * t).toString(16);
    out += channel.length < 2 ? `0${channel}` : channel;
  }
  return out;
}

/** #rrggbb guard so hostile/legacy persisted strings cannot reach hexRgb. */
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;

export function normalizeAmbianceTint(value: string | undefined | null): string {
  const trimmed = value?.trim() ?? "";
  return HEX_COLOR_PATTERN.test(trimmed) ? trimmed : FALLBACK_TINT;
}

export class AmbianceEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;

  private config: AmbianceEngineConfig = {
    effect: "rain",
    intensity: 0.55,
    reactMode: "live",
    tint: FALLBACK_TINT,
    surfaces: { sidebar: true, thread: true },
    reducedMotion: false,
  };

  // Reaction signals. `session`/`holding` are level-set from projected store
  // state; the rest are decaying pulses poked by the layer on transitions.
  private session: OrchestrationSessionStatus | "idle" = "idle";
  private holding = false;
  private burst = 0;
  private fog = 0;
  private hold = 0;
  private fault = 0;
  private clearing = 0;
  private drive = 0;
  private wind = 0;

  // Geometry. `side` is the sidebar/thread split in CSS pixels.
  private width = 0;
  private height = 0;
  private dpr = 1;
  private side = 0;

  private drops: Drop[] = [];
  private flakes: Flake[] = [];
  private cols: MatrixColumn[] = [];
  private fire: FireParticle[] = [];
  private stars: Star[] = [];

  private rafId: number | null = null;
  private lastFrameAt = 0;
  private time = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }

  setConfig(config: AmbianceEngineConfig): void {
    const effectChanged = config.effect !== this.config.effect;
    this.config = config;
    if (effectChanged) {
      // Match the mockup's tile switch: keep pools, only top up so the new
      // effect fades in from a believable mid-state instead of a burst.
      this.seed(false);
    }
  }

  /** Level-set the projected orchestration session status (or "idle" when none). */
  setSession(session: OrchestrationSessionStatus | "idle"): void {
    this.session = session;
  }

  /** Level-set "an approval or user-input request is waiting on the user". */
  setHolding(holding: boolean): void {
    this.holding = holding;
    if (holding) {
      this.hold = 1;
    }
  }

  /** Tool activity gust; decays over ~1.2s like the mockup. */
  pulseBurst(): void {
    this.burst = Math.min(1, this.burst + 0.75);
  }

  /** Context-compaction fog sweep. */
  pulseFog(): void {
    this.fog = 1;
  }

  /** Runtime/session error squall. */
  pulseFault(): void {
    this.fault = 1;
  }

  /** Turn completion: sky clears briefly, then drifts back to session drive. */
  pulseClear(): void {
    this.clearing = 1;
    this.burst = 0;
  }

  resize(width: number, height: number, dpr: number, side: number): void {
    const ctx = this.ctx;
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.dpr = Math.min(Math.max(dpr, 1), 2);
    this.side = Math.max(0, Math.min(this.width, Math.round(side)));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    if (ctx) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }
    this.seed(true);
  }

  setSideBoundary(side: number): void {
    this.side = Math.max(0, Math.min(this.width, Math.round(side)));
  }

  /** Current state color for the composer ring + settings surfaces. */
  stateColor(): string {
    if (this.fault > 0.02) return FAULT_COLOR;
    if (this.hold > 0.02) return HOLD_COLOR;
    if (this.session === "stopped" || this.session === "interrupted") return SETTLED_COLOR;
    return normalizeAmbianceTint(this.config.tint);
  }

  /** Current eased drive 0..1 (used for the composer ring gradient). */
  currentDrive(): number {
    return this.drive;
  }

  start(): void {
    if (this.rafId !== null || !this.ctx) {
      return;
    }
    this.lastFrameAt = performance.now();
    const tick = (now: number) => {
      this.frame(now);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  clear(): void {
    this.ctx?.clearRect(0, 0, this.width, this.height);
  }

  isRunning(): boolean {
    return this.rafId !== null;
  }

  // ── particle pools ──────────────────────────────────────────────────

  private newFlake(layer: 0 | 1 | 2, fresh: boolean): Flake {
    // Snow reads as snow when it has depth: three parallax layers, each with
    // its own size, speed, sway amplitude and opacity. Sway is applied at
    // draw time so the amplitude stays honest no matter the frame rate.
    return {
      layer,
      bx: Math.random() * this.width,
      y: fresh ? Math.random() * this.height : -8,
      r: layer === 0 ? rnd(0.5, 0.95) : layer === 1 ? rnd(0.95, 1.7) : rnd(1.7, 2.9),
      ph: Math.random() * 6.2832,
      sf: rnd(0.32, 0.85),
      sa: layer === 0 ? rnd(2, 5) : layer === 1 ? rnd(5, 11) : rnd(9, 18),
      v: rnd(0.8, 1.25),
      th: Math.random(),
    };
  }

  private spawnFire(particle: FireParticle, fresh: boolean): FireParticle {
    // Fire is bottom-anchored: particles are born at the floor, rise against
    // drag, cool through a colour ramp, and die. ~18% are light "sparks" that
    // escape the column and travel much further.
    particle.spark = Math.random() < 0.18;
    particle.x = Math.random() * this.width;
    particle.y = fresh ? Math.random() * this.height : this.height + rnd(0, 10);
    particle.vx = rnd(-8, 8);
    particle.vy = -rnd(28, 74) * (particle.spark ? 1.6 : 1);
    particle.r = particle.spark ? rnd(0.5, 1.1) : rnd(0.9, 2.6);
    particle.max = particle.spark ? rnd(2.2, 4.2) : rnd(0.9, 2.2);
    particle.life = fresh ? Math.random() : 0;
    particle.ph = Math.random() * 6.2832;
    return particle;
  }

  private fireColor(life: number): string {
    const x = Math.max(0, Math.min(0.9999, life)) * (FIRE_STOPS.length - 1);
    const i = Math.floor(x);
    return mix(FIRE_STOPS[i]!, FIRE_STOPS[i + 1]!, x - i);
  }

  private seed(hard: boolean): void {
    if (hard) {
      this.drops = [];
      this.flakes = [];
      this.fire = [];
      this.stars = [];
      this.cols = [];
    }
    while (this.drops.length < 340) {
      this.drops.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        l: rnd(6, 20),
        v: rnd(0.55, 1),
      });
    }
    if (this.flakes.length === 0) {
      for (let f = 0; f < 300; f++) {
        this.flakes.push(this.newFlake(f < 150 ? 0 : f < 246 ? 1 : 2, true));
      }
    }
    if (this.fire.length === 0) {
      for (let e = 0; e < 220; e++) {
        this.fire.push(
          this.spawnFire(
            { spark: false, x: 0, y: 0, vx: 0, vy: 0, r: 0, max: 1, life: 0, ph: 0 },
            true,
          ),
        );
      }
    }
    while (this.stars.length < 190) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        r: rnd(0.4, 1.3),
        ph: Math.random() * 6.28,
        v: rnd(0.15, 0.5),
      });
    }

    // Columns are evenly spaced across the full width and thinned by a random
    // per-column threshold, so density scaling never leaves one side of the
    // window permanently dry.
    const columnCount = Math.max(6, Math.floor(this.width / 13));
    this.cols.length = 0;
    for (let i = 0; i < columnCount; i++) {
      this.cols.push({
        x: i * 13 + 3,
        y: Math.random() * -this.height,
        v: rnd(0.5, 1.3),
        len: Math.floor(rnd(6, 18)),
        t: Math.random(),
        th: Math.random(),
      });
    }
  }

  // ── drive/state math (mockup parity) ────────────────────────────────

  private targetDrive(): number {
    const { intensity, reactMode } = this.config;
    if (reactMode === "off") {
      return intensity;
    }
    let base = SESSION_DRIVE[this.session] ?? 0.2;
    if (reactMode === "live") {
      base += this.burst * 0.3;
    }
    base *= 1 - this.clearing * 0.85;
    base *= 1 - this.fog * 0.4;
    return Math.max(0, Math.min(1, base * (0.5 + intensity)));
  }

  private speedMul(): number {
    // Approval hold: the sky visibly stalls while the run waits on the user.
    if (this.hold > 0.02) return 0.14 + (1 - this.hold) * 0.86;
    // Fault squall: brief agitation on errors.
    if (this.fault > 0.02) return 1 + this.fault * 0.7;
    return 1;
  }

  // ── per-effect draw/step (mockup parity) ────────────────────────────

  private clipSurfaces(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath();
    let any = false;
    if (this.config.surfaces.sidebar && this.side > 0) {
      ctx.rect(0, 0, this.side, this.height);
      any = true;
    }
    if (this.config.surfaces.thread) {
      ctx.rect(this.side, 0, this.width - this.side, this.height);
      any = true;
    }
    if (!any) {
      ctx.rect(0, 0, 0, 0);
    }
    ctx.clip();
  }

  private drawRain(ctx: CanvasRenderingContext2D, d: number, col: string): void {
    const count = Math.min(this.drops.length, Math.floor(30 + d * 300));
    ctx.strokeStyle = rgba(col, 0.06 + d * 0.2);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const p = this.drops[i]!;
      const len = p.l * (0.6 + d * 0.9);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + this.wind * len * 0.35, p.y + len);
    }
    ctx.stroke();
  }

  private stepRain(dt: number, d: number, sp: number): void {
    const count = Math.min(this.drops.length, Math.floor(30 + d * 300));
    for (let i = 0; i < count; i++) {
      const p = this.drops[i]!;
      p.y += (280 + d * 700) * p.v * sp * dt;
      p.x += this.wind * 40 * sp * dt;
      if (p.y > this.height + 20) {
        p.y = -20;
        p.x = Math.random() * (this.width + 60) - 30;
      }
      if (p.x < -40) p.x = this.width + 20;
      else if (p.x > this.width + 40) p.x = -20;
    }
  }

  private drawSnow(ctx: CanvasRenderingContext2D, d: number, col: string): void {
    const density = 0.1 + d * 0.9;
    const far = mix("#ffffff", col, 0.4);
    const near = mix("#ffffff", col, 0.08);
    for (const p of this.flakes) {
      if (p.th > density) continue;
      const x = p.bx + Math.sin(this.time * p.sf + p.ph) * p.sa;
      const radius = p.r * (0.82 + Math.sin(this.time * p.sf * 3.1 + p.ph * 1.7) * 0.18);
      const alpha = (p.layer === 0 ? 0.2 : p.layer === 1 ? 0.4 : 0.68) * (0.32 + d * 0.68);
      if (p.layer === 2) {
        // Soft halo behind the near layer sells the depth-of-field.
        ctx.fillStyle = rgba(near, alpha * 0.14);
        ctx.beginPath();
        ctx.arc(x, p.y, radius * 2.6, 0, 6.2832);
        ctx.fill();
      }
      ctx.fillStyle = rgba(p.layer === 0 ? far : near, alpha);
      ctx.beginPath();
      ctx.arc(x, p.y, radius, 0, 6.2832);
      ctx.fill();
    }
  }

  private stepSnow(dt: number, d: number, sp: number): void {
    const density = 0.1 + d * 0.9;
    for (const p of this.flakes) {
      if (p.th > density) continue;
      const layerSpeed = LAYER_SPEED[p.layer];
      const flutter = 1 + Math.sin(this.time * p.sf * 2.1 + p.ph) * 0.3;
      p.y += (10 + d * 32) * p.v * layerSpeed * flutter * sp * dt;
      p.bx += this.wind * 13 * layerSpeed * sp * dt;
      if (p.y > this.height + 10) {
        p.y = -10;
        p.bx = Math.random() * this.width;
      }
      if (p.bx < -26) p.bx = this.width + 22;
      else if (p.bx > this.width + 26) p.bx = -22;
    }
  }

  private drawMatrix(ctx: CanvasRenderingContext2D, d: number, col: string): void {
    const density = 0.12 + d * 0.88;
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textBaseline = "top";
    for (let i = 0; i < this.cols.length; i++) {
      const c = this.cols[i]!;
      if (c.th > density) continue;
      for (let j = 0; j < c.len; j++) {
        const y = c.y - j * 13;
        if (y < -14 || y > this.height) continue;
        const alpha = (1 - j / c.len) * (0.16 + d * 0.5);
        ctx.fillStyle =
          j === 0 ? rgba(mix(col, "#ffffff", 0.7), Math.min(0.9, 0.3 + d * 0.6)) : rgba(col, alpha);
        const glyphIndex =
          ((((c.t * 97 + j * 31 + i * 13) | 0) % GLYPHS.length) + GLYPHS.length) % GLYPHS.length;
        ctx.fillText(GLYPHS.charAt(glyphIndex), c.x, y);
      }
    }
  }

  private stepMatrix(dt: number, d: number, sp: number): void {
    const density = 0.12 + d * 0.88;
    for (const c of this.cols) {
      if (c.th > density) continue;
      c.y += (70 + d * 220) * c.v * sp * dt;
      c.t += dt * (3 + d * 8);
      if (c.y - c.len * 13 > this.height) {
        c.y = rnd(-60, 0);
        c.v = rnd(0.5, 1.3);
        c.len = Math.floor(rnd(6, 18));
      }
    }
  }

  private flicker(phase: number): number {
    return (
      0.62 +
      Math.sin(this.time * 5.1 + phase) * 0.2 +
      Math.sin(this.time * 11.7 + phase * 2.3) * 0.18
    );
  }

  private drawFire(ctx: CanvasRenderingContext2D, d: number, col: string): void {
    ctx.globalCompositeOperation = "lighter";

    // 1. heat haze along the floor — this is what makes it read as fire
    const fl = this.flicker(0);
    const hazeHeight = this.height * (0.13 + d * 0.3) * (0.85 + fl * 0.3);
    const base = mix("#ff5a12", col, 0.22);
    const gradient = ctx.createLinearGradient(0, this.height, 0, this.height - hazeHeight);
    gradient.addColorStop(0, rgba(base, (0.1 + d * 0.3) * fl));
    gradient.addColorStop(0.45, rgba(base, (0.035 + d * 0.13) * fl));
    gradient.addColorStop(1, rgba(base, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, this.height - hazeHeight, this.width, hazeHeight);

    // 2. flame licks: elongated radials rooted below the edge, wandering
    const licks = 6;
    for (let k = 0; k < licks; k++) {
      const ph = k * 1.73;
      const amp =
        0.5 + Math.sin(this.time * 3.1 + ph) * 0.26 + Math.sin(this.time * 6.9 + ph * 2) * 0.2;
      const lx =
        ((k + 0.5) / licks) * this.width +
        Math.sin(this.time * 0.8 + ph) * (this.width / licks) * 0.3;
      const lr = (24 + d * 62) * (0.7 + amp * 0.6);
      const lh = (1.4 + d * 1.5) * (0.75 + amp * 0.5);
      ctx.save();
      ctx.translate(lx, this.height + 5);
      ctx.scale(1, lh);
      const radial = ctx.createRadialGradient(0, 0, 0, 0, 0, lr);
      radial.addColorStop(0, rgba(mix("#ffbb4d", col, 0.14), 0.09 + d * 0.19));
      radial.addColorStop(0.5, rgba("#ff6a1f", 0.035 + d * 0.1));
      radial.addColorStop(1, rgba("#ff3d00", 0));
      ctx.fillStyle = radial;
      ctx.fillRect(-lr, -lr, lr * 2, lr * 2);
      ctx.restore();
    }

    // 3. embers, cooling as they climb
    const count = Math.min(this.fire.length, Math.floor(24 + d * 190));
    for (let i = 0; i < count; i++) {
      const p = this.fire[i]!;
      const life = p.life;
      const alpha = (1 - life) * (1 - life) * (0.3 + d * 0.6);
      ctx.fillStyle = rgba(mix(this.fireColor(life), col, 0.12), alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.3, p.r * (1 - life * 0.55)), 0, 6.2832);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
  }

  private stepFire(dt: number, d: number, sp: number): void {
    const count = Math.min(this.fire.length, Math.floor(24 + d * 190));
    for (let i = 0; i < count; i++) {
      const p = this.fire[i]!;
      p.life += dt / p.max;
      if (p.life >= 1 || p.y < -12) {
        this.spawnFire(p, false);
        continue;
      }
      p.vy -= (16 + d * 30) * dt; // buoyancy
      p.vy *= 1 - Math.min(0.9, (p.spark ? 0.45 : 1.15) * dt); // drag
      const turbulence = Math.sin(this.time * 2.4 + p.ph + p.y * 0.022) * (14 + d * 26);
      p.vx += (turbulence + this.wind * 26 - p.vx * 1.5) * dt;
      p.x += p.vx * sp * dt;
      p.y += p.vy * sp * dt;
    }
  }

  private drawStars(ctx: CanvasRenderingContext2D, d: number, col: string): void {
    const count = Math.min(this.stars.length, Math.floor(40 + d * 150));
    for (let i = 0; i < count; i++) {
      const p = this.stars[i]!;
      const twinkle = 0.55 + Math.sin(this.time * 0.9 + p.ph) * 0.45;
      ctx.fillStyle = rgba(i % 3 === 0 ? col : "#ffffff", (0.1 + d * 0.3) * twinkle);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
      ctx.fill();
    }
  }

  private stepStars(dt: number, _d: number, sp: number): void {
    for (const p of this.stars) {
      p.x -= p.v * 6 * sp * dt;
      p.y -= p.v * 13 * sp * dt;
      if (p.y < -4) {
        p.y = this.height + 4;
        p.x = Math.random() * this.width;
      }
      if (p.x < -4) p.x = this.width + 4;
    }
  }

  private drawFog(ctx: CanvasRenderingContext2D, amount: number): void {
    if (amount <= 0.005) return;
    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, rgba("#c8d2dc", 0));
    gradient.addColorStop(0.5, rgba("#c8d2dc", 0.09 * amount));
    gradient.addColorStop(1, rgba("#c8d2dc", 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  // ── frame loop ──────────────────────────────────────────────────────

  private frame(now: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const dt = Math.min(0.05, (now - this.lastFrameAt) / 1000);
    this.lastFrameAt = now;
    if (!this.config.reducedMotion) {
      this.time += dt;
    }

    // Pulse decays (per-second rates from the mockup).
    this.burst = Math.max(0, this.burst - dt * 0.85);
    this.fog = Math.max(0, this.fog - dt * 0.22);
    this.fault = Math.max(0, this.fault - dt * 0.26);
    this.clearing = Math.max(0, this.clearing - dt * 0.4);
    // The hold level stays pinned while an approval is actually pending
    // (store truth), then decays once it resolves.
    if (this.holding) {
      this.hold = 1;
    } else if (this.hold > 0) {
      this.hold = Math.max(0, this.hold - dt * 0.6);
    }

    const target = this.targetDrive();
    this.drive += (target - this.drive) * Math.min(1, dt * 2.2);
    this.wind +=
      (Math.sin(this.time * 0.23) * 0.5 + this.burst * 0.9 - this.wind) * Math.min(1, dt * 1.6);

    const d = this.drive;
    const sp = this.speedMul();
    const col = this.stateColor();

    ctx.clearRect(0, 0, this.width, this.height);
    if (d > 0.002) {
      ctx.save();
      this.clipSurfaces(ctx);
      if (!this.config.reducedMotion) {
        if (this.config.effect === "rain") this.stepRain(dt, d, sp);
        else if (this.config.effect === "snow") this.stepSnow(dt, d, sp);
        else if (this.config.effect === "matrix") this.stepMatrix(dt, d, sp);
        else if (this.config.effect === "fire") this.stepFire(dt, d, sp);
        else this.stepStars(dt, d, sp);
      }
      if (this.config.effect === "rain") this.drawRain(ctx, d, col);
      else if (this.config.effect === "snow") this.drawSnow(ctx, d, col);
      else if (this.config.effect === "matrix") this.drawMatrix(ctx, d, col);
      else if (this.config.effect === "fire") this.drawFire(ctx, d, col);
      else this.drawStars(ctx, d, col);
      this.drawFog(ctx, this.fog);
      ctx.restore();
    }
  }
}
