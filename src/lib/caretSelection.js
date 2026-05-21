/**
 * caretSelection.js — Caret/selection helpers for drag-select over rendered text.
 * Works with both mouse and touch events.
 */

/**
 * Returns the character offset within `element` at the given clientX/Y,
 * or null if no offset can be resolved.
 * Uses caretPositionFromPoint (Firefox/Safari) or caretRangeFromPoint (Chromium).
 * @param {Element} element
 * @param {number} clientX
 * @param {number} clientY
 * @returns {number|null}
 */
export function getCaretOffsetAtPoint(element, clientX, clientY) {
  let node = null;
  let offset = null;

  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos) {
      node = pos.offsetNode;
      offset = pos.offset;
    }
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(clientX, clientY);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }

  if (!node) return null;
  return localOffsetToGlobal(element, node, offset);
}

/**
 * Convert a (node, offset) pair into a global character offset within `root`.
 * Walks text nodes in document order.
 */
function localOffsetToGlobal(root, targetNode, targetOffset) {
  if (!root.contains(targetNode) && root !== targetNode) return null;
  let global = 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let n;
  while ((n = walker.nextNode())) {
    if (n === targetNode) return global + targetOffset;
    global += n.nodeValue.length;
  }
  return global;
}

/**
 * Get the [start, end] character range for a drag from pointA → pointB within element.
 * Returns null if either point cannot be resolved.
 * @param {Element} element
 * @param {{x:number, y:number}} pointA
 * @param {{x:number, y:number}} pointB
 * @returns {[number, number]|null}
 */
export function getDragRange(element, pointA, pointB) {
  const a = getCaretOffsetAtPoint(element, pointA.x, pointA.y);
  const b = getCaretOffsetAtPoint(element, pointB.x, pointB.y);
  if (a === null || b === null) return null;
  return a <= b ? [a, b] : [b, a];
}
