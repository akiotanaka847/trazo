import type { Stroke } from "./strokes";

/** A stroke that took a new color, and the one it had. */
export interface Recolor {
  stroke: Stroke;
  from: string;
  to: string;
}

type Entry =
  | { type: "add"; stroke: Stroke }
  | { type: "remove"; removed: { stroke: Stroke; index: number }[] }
  | { type: "recolor"; changes: Recolor[] };

/** The strokes on one canvas plus their undo/redo history. */
export class Drawing {
  strokes: Stroke[] = [];
  private done: Entry[] = [];
  private undone: Entry[] = [];

  add(stroke: Stroke): void {
    this.strokes.push(stroke);
    this.record({ type: "add", stroke });
  }

  /** Removes strokes as a single undoable step (one eraser gesture, or Clear). */
  remove(targets: Iterable<Stroke>): boolean {
    const removed = [...targets]
      .map((stroke) => ({ stroke, index: this.strokes.indexOf(stroke) }))
      .filter((r) => r.index >= 0)
      .sort((a, b) => a.index - b.index);
    if (removed.length === 0) return false;
    this.apply({ type: "remove", removed });
    this.record({ type: "remove", removed });
    return true;
  }

  /** Recolors strokes as a single undoable step (one recolor gesture, already painted live). */
  recolor(changes: Recolor[]): boolean {
    const real = changes.filter((c) => c.from !== c.to);
    if (real.length === 0) return false;
    this.apply({ type: "recolor", changes: real });
    this.record({ type: "recolor", changes: real });
    return true;
  }

  undo(): boolean {
    const entry = this.done.pop();
    if (!entry) return false;
    this.revert(entry);
    this.undone.push(entry);
    return true;
  }

  redo(): boolean {
    const entry = this.undone.pop();
    if (!entry) return false;
    this.apply(entry);
    this.done.push(entry);
    return true;
  }

  /** Another canvas recorded a change, so this one's redo steps are no longer reachable. */
  dropRedo(): void {
    this.undone = [];
  }

  private record(entry: Entry): void {
    this.done.push(entry);
    this.undone = [];
  }

  private apply(entry: Entry): void {
    switch (entry.type) {
      case "add":
        this.strokes.push(entry.stroke);
        break;
      case "remove": {
        const gone = new Set(entry.removed.map((r) => r.stroke));
        this.strokes = this.strokes.filter((s) => !gone.has(s));
        break;
      }
      case "recolor":
        for (const c of entry.changes) c.stroke.color = c.to;
        break;
    }
  }

  private revert(entry: Entry): void {
    switch (entry.type) {
      case "add":
        this.strokes = this.strokes.filter((s) => s !== entry.stroke);
        break;
      case "remove":
        // Ascending order puts every stroke back at its original depth.
        for (const { stroke, index } of entry.removed) this.strokes.splice(index, 0, stroke);
        break;
      case "recolor":
        for (const c of entry.changes) c.stroke.color = c.from;
        break;
    }
  }
}
