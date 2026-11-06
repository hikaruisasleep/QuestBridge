/**
 * Reordering by drag, for pointer **and** touch.
 *
 * The interactive requirement is drag-and-drop (`docs/phase-3-plan.md` §3.5);
 * touch support was added as a product requirement. The two input families
 * differ enough that a single "mouse events" implementation silently fails on
 * one of them:
 *
 * - A mouse reports `mousedown` → `mousemove` with no implicit capture, and the
 *   browser may start a text selection or a native drag as soon as the pointer
 *   moves.
 * - A finger reports `pointerdown` with `pointerType: "touch"`, and the browser
 *   will scroll the page instead of delivering moves unless the handler calls
 *   `preventDefault` in the **non-passive** touch listeners. It also fires
 *   `touchcancel` (a system gesture, a notification shade drag) rather than
 *   `pointerup`, which must cancel cleanly instead of dropping the item
 *   somewhere arbitrary.
 *
 * Everything here is expressed through **Pointer Events**, which unify mouse,
 * pen, and touch, plus an explicit non-passive `touchmove` guard. This module is
 * deliberately free of DOM globals beyond the element it is given, so the
 * decision logic can be unit-tested in Node without a browser.
 */

/** What the drag controller needs from a list item. */
export interface DragGeometry {
  /** Position of the item's centre along the list axis, in pixels. */
  centre: number;
  /** Item extent along the list axis, in pixels. */
  size: number;
}

export interface DragGeometrySource {
  /** Geometry for every rendered item, in current DOM order. */
  measure(): DragGeometry[];
}

export type DragResult =
  | { kind: "move"; from: number; to: number }
  | { kind: "cancel" }
  | { kind: "drop"; from: number; to: number };

/**
 * Decide what a drag position means.
 *
 * The drop index is computed from the dragged item's centre against the other
 * items' geometry, which is what makes the interaction feel correct for both
 * short and tall rows: a naive "which row is the cursor over" test jumps as soon
 * as the pointer leaves the source row.
 */
export function computeTargetIndex(
  sourceIndex: number,
  pointerAxis: number,
  geometry: readonly DragGeometry[],
): number {
  const source = geometry[sourceIndex];
  if (source === undefined) {
    return sourceIndex;
  }

  let index = 0;
  for (const item of geometry) {
    if (item.centre < pointerAxis) {
      index += 1;
    }
  }

  // `index` counts items whose centre is above the pointer, which is the
  // insertion point. Converting to a move target: removing the source first
  // shifts everything after it up by one.
  const insertion = index > sourceIndex ? index - 1 : index;
  return Math.max(0, Math.min(geometry.length - 1, insertion));
}

/** A reorder expressed as a move, applied immutably. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) {
    return [...items];
  }
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) {
    return [...items];
  }
  next.splice(to, 0, moved);
  return next;
}

export interface DragSessionOptions {
  /** The list element that owns the items. */
  list: HTMLElement;
  /** The dragged element, e.g. the `<li>` the handle belongs to. */
  source: HTMLElement;
  /**
   * The handle the user pressed. Used to restore the listener on teardown.
   *
   * A session that has **not** started has to clean up, otherwise its own
   * `pointerdown` listener would orphan the handle and no later attempt could
   * begin. That cleanup must leave the handle working, so the original listener
   * is restored rather than removed.
   */
  handle?: HTMLElement;
  /** Items in DOM order. Index 0 is the first item. */
  items: () => readonly HTMLElement[];
  /** Called with the source and target index when the drop commits. */
  onDrop: (from: number, to: number) => void;
  /** Called whenever the hovered target changes, for preview rendering. */
  onTargetChange?: (from: number, to: number | null) => void;
  /** Called when a drag starts or ends, so the list can style itself. */
  onActiveChange?: (active: boolean) => void;
  /**
   * Distance in pixels a touch must travel before a drag begins. Until then the
   * gesture belongs to the scroll container, which is what keeps the list usable
   * on a phone.
   */
  touchThresholdPx?: number;
  /** Pointer movement that still counts as a click rather than a drag. */
  clickTolerancePx?: number;
}

const DEFAULT_TOUCH_THRESHOLD_PX = 8;
const DEFAULT_CLICK_TOLERANCE_PX = 4;

/**
 * Start a drag session.
 *
 * Returns a teardown function. Register it with `onpointerdown` on a handle so
 * that later pointer events reach the session:
 *
 * ```svelte
 * <button onpointerdown={(event) => startDragSession(handle, index, options)}>
 * ```
 */
export function startDragSession(
  handle: HTMLElement,
  sourceIndex: number,
  options: DragSessionOptions,
  /**
   * The `pointerdown` that created the session.
   *
   * Pass the event from the handle's own `onpointerdown`. A session cannot
   * observe that press through a listener it registers afterwards, and waiting
   * for a second press would leave the first gesture dead.
   */
  openingEvent: PointerEvent | null = null,
): () => void {
  const list = options.list;
  const source = options.source;
  const items = options.items();
  if (items[sourceIndex] === undefined) {
    return () => {};
  }

  const touchThreshold = options.touchThresholdPx ?? DEFAULT_TOUCH_THRESHOLD_PX;
  const clickTolerance = options.clickTolerancePx ?? DEFAULT_CLICK_TOLERANCE_PX;

  let pointerId: number | null = null;
  let pointerType = "mouse";
  let startAxis = 0;
  let active = false;
  let target: number | null = null;
  let finished = false;
  let listenersAttached = false;

  const geometry = (): DragGeometry[] => {
    const rects = items.map((item) => item.getBoundingClientRect());
    // Rows are laid out vertically, so the relevant axis is Y.
    return rects.map((rect) => ({ centre: rect.top + rect.height / 2, size: rect.height }));
  };

  const setActive = (next: boolean): void => {
    if (active === next) {
      return;
    }
    active = next;
    source.dataset.dragging = String(next);
    list.dataset.dragging = String(next);
    options.onActiveChange?.(next);
  };

  const setTarget = (next: number | null): void => {
    if (target === next) {
      return;
    }
    target = next;
    for (const [index, item] of items.entries()) {
      if (next !== null && index === next && index !== sourceIndex) {
        item.dataset.dragOver = "true";
      } else {
        delete item.dataset.dragOver;
      }
    }
    options.onTargetChange?.(sourceIndex, next);
  };

  const cleanup = (): void => {
    if (finished) {
      return;
    }
    finished = true;

    if (listenersAttached) {
      window.removeEventListener("pointerdown", onWindowPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerCancel, true);
      // Non-passive so `preventDefault` is honoured; this is what stops the page
      // scrolling underneath a touch drag.
      window.removeEventListener("touchmove", onTouchMove, {
        capture: true,
      } as EventListenerOptions);
      listenersAttached = false;
    }

    delete source.dataset.dragging;
    delete list.dataset.dragging;
    for (const item of items) {
      delete item.dataset.dragOver;
    }
    setTarget(null);
    options.onActiveChange?.(false);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (pointerId !== null) {
      return;
    }
    // Only a primary button starts a drag; a right- or middle-click is not one.
    if (pointerType === "mouse" && event.button !== 0) {
      return;
    }
    pointerId = event.pointerId;
    pointerType = event.pointerType === "" ? "mouse" : event.pointerType;
    startAxis = event.clientY;

    // Idempotent: the previous session may already have attached these.
    if (!listenersAttached) {
      window.addEventListener("pointerdown", onWindowPointerDown, true);
      window.addEventListener("pointermove", onPointerMove, true);
      window.addEventListener("pointerup", onPointerUp, true);
      window.addEventListener("pointercancel", onPointerCancel, true);
      window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
      listenersAttached = true;
    }
  };

  /**
   * The press that opens the session.
   *
   * A session is created *by* the handle's `pointerdown`, which has already been
   * dispatched by the time its listeners exist. Registering a further
   * `pointerdown` would wait for a second press the user never makes, so the
   * opening event is passed in explicitly and the same handling runs from a
   * window-level listener on later gestures.
   */
  const onWindowPointerDown = (event: PointerEvent): void => {
    if (pointerId !== null) {
      return;
    }
    // Only the handle's own press continues a session.
    const restored = options.handle ?? handle;
    if (event.target !== restored && !restored.contains(event.target as Node)) {
      return;
    }
    onPointerDown(event);
  };

  /**
   * A gesture that ended before the drag began.
   *
   * This is the common case: a tap or a click on the handle is not a reorder.
   * The session must be torn down so its `pointerdown` registration does not
   * become a dead end, but the handle has to keep working, so the listener is
   * restored rather than left removed.
   */
  const abandon = (): void => {
    pointerId = null;
    cleanup();
    const restore = options.handle ?? handle;
    if (restore.isConnected) {
      restore.addEventListener("pointerdown", onPointerDown);
    }
  };

  const onTouchMove = (event: TouchEvent): void => {
    // Without this the browser scrolls the list while the user is reordering.
    // It is only suppressed once the gesture is unambiguously a drag.
    if (active && event.cancelable) {
      event.preventDefault();
    }
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) {
      return;
    }

    const delta = Math.abs(event.clientY - startAxis);

    if (!active) {
      const threshold = pointerType === "touch" ? touchThreshold : clickTolerance;
      if (delta < threshold) {
        return;
      }
      setActive(true);
    }

    // Only suppress the default once this is unambiguously a drag. Calling it
    // before the threshold would also cancel the click that a simple tap on the
    // handle is supposed to leave alone.
    if (event.cancelable) {
      event.preventDefault();
    }
    const next = computeTargetIndex(sourceIndex, event.clientY, geometry());
    setTarget(next === sourceIndex ? null : next);
  };

  const finish = (commit: boolean): void => {
    if (pointerId === null) {
      abandon();
      return;
    }
    const from = sourceIndex;
    const to = commit ? target : null;
    pointerId = null;
    // Releasing without ever crossing the threshold is a click, not a reorder.
    if (!active) {
      abandon();
      return;
    }
    cleanup();

    if (to !== null && to !== from) {
      options.onDrop(from, to);
    }
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) {
      // A pointerup with no matching session is a stray end of an interaction
      // this session never claimed.
      abandon();
      return;
    }
    finish(true);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    if (pointerId === null || event.pointerId !== pointerId) {
      return;
    }
    // A cancelled touch (system gesture, call, scroll takeover) must restore the
    // original order rather than committing a half-finished drag.
    finish(false);
  };

  handle.addEventListener("pointerdown", onPointerDown);

  // The opening press has already been dispatched; run it now so the session is
  // open before the pointer starts moving.
  if (openingEvent !== null) {
    onPointerDown(openingEvent);
  }

  return cleanup;
}
