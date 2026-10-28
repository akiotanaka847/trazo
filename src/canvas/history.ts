import type { Stroke } from "./strokes";

type Entry =
  | { type: "add"; stroke: Stroke }
  | { type: "remove"; removed: { stroke: Stroke; index: number }[] };

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
    if (entry.type === "add") {
      this.strokes.push(entry.stroke);
    } else {
      const gone = new Set(entry.removed.map((r) => r.stroke));
      this.strokes = this.strokes.filter((s) => !gone.has(s));
    }
  }

  private revert(entry: Entry): void {
    if (entry.type === "add") {
      this.strokes = this.strokes.filter((s) => s !== entry.stroke);
    } else {
      // Ascending order puts every stroke back at its original depth.
      for (const { stroke, index } of entry.removed) this.strokes.splice(index, 0, stroke);
    }
  }
}
