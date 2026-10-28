/** A glowing trail that follows the pointer and fades on its own; it never becomes ink. */
export class LaserTrail {
  private points: { x: number; y: number; t: number }[] = [];

  constructor(private lifeMs = 650) {}

  add(x: number, y: number): void {
    this.points.push({ x, y, t: performance.now() });
  }

  /** Paints the trail and reports whether anything is still visible (keep animating). */
  draw(ctx: CanvasRenderingContext2D, color: string, width: number, now: number): boolean {
    this.points = this.points.filter((p) => now - p.t < this.lifeMs);
    const pts = this.points;
    if (pts.length === 0) return false;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // Three passes instead of shadowBlur: a soft halo, the colored body, a hot core.
    const passes: [number, number, string][] = [
      [2.6, 0.22, color],
      [1, 0.95, color],
      [0.32, 0.9, "#ffffff"],
    ];
    for (const [scale, alpha, stroke] of passes) {
      ctx.strokeStyle = stroke;
      for (let i = 1; i < pts.length; i++) {
        const fresh = 1 - (now - pts[i].t) / this.lifeMs;
        ctx.globalAlpha = alpha * fresh;
        ctx.lineWidth = width * scale * (0.3 + 0.7 * fresh);
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    }
    const tip = pts[pts.length - 1];
    if (now - tip.t < 120) {
      for (const [scale, alpha, fill] of passes) {
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, (width * scale * 1.15) / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    return true;
  }
}
