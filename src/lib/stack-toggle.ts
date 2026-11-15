/**
 * The stack-layer buttons are toggles with at most one pressed (#142). The state is an index,
 * -1 for none. A pure function of the current index and the clicked one, so the component and
 * tests/stack-toggle.test.mjs use the same rule.
 */
export const NONE_PRESSED = -1;

/** Pressing the pressed layer releases it; pressing any other switches to it. */
export function togglePressed(current: number, clicked: number): number {
  return current === clicked ? NONE_PRESSED : clicked;
}
