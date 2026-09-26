// Available dimensions are the measured flex remainder after application chrome.
export function getViewportFit(
  availableWidth: number,
  availableHeight: number,
  naturalWidth: number,
  naturalHeight: number,
) {
  if ([availableWidth, availableHeight, naturalWidth, naturalHeight].some(value => !Number.isFinite(value) || value <= 0)) {
    return { scale: 1, fallback: false };
  }
  // Below the desktop budget, preserve legibility and expose controlled scrolling.
  const fallback = availableWidth < 1100 || availableHeight < 560;
  const fit = Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);
  return { scale: fallback ? Math.max(0.65, fit) : fit, fallback };
}
