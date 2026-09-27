import { useEffect, useRef, useState } from "react";
import { getViewportFit } from "../utils/viewportFit";

type ResponsiveScaleBoxProps = {
  baseWidth: number;
  fit?: "width" | "viewport";
  minScale?: number;
  maxScale?: number;
  children: React.ReactNode;
};

export default function ResponsiveScaleBox({
  baseWidth,
  fit = "width",
  minScale = 0.5,
  maxScale = 1,
  children,
}: ResponsiveScaleBoxProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);
  const [contentWidth, setContentWidth] = useState(baseWidth);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    const outerNode = outerRef.current;
    const innerNode = innerRef.current;
    if (!outerNode || !innerNode) return;

    const measure = () => {
      const width = outerNode.clientWidth;
      // Include fractional layout pixels before transforming (scrollHeight rounds).
      const height = Math.max(innerNode.scrollHeight, Math.ceil(parseFloat(getComputedStyle(innerNode).height) || 0));
      const naturalWidth = Math.max(baseWidth, innerNode.scrollWidth);
      if (fit === "viewport") {
        // Ignore existing scrollbars when deciding whether they are needed.
        // Otherwise resizing near the fallback boundary can get stuck scrolling.
        const available = outerNode.getBoundingClientRect();
        const result = getViewportFit(Math.floor(available.width), Math.floor(available.height), naturalWidth, height);
        setScale(result.scale);
        setFallback(result.fallback);
      } else {
        setScale(Math.max(minScale, Math.min(maxScale, width / baseWidth)));
      }
      setContentHeight(height);
      setContentWidth(naturalWidth);
    };
    const outerObserver = new ResizeObserver(measure);
    const innerObserver = new ResizeObserver(measure);
    outerObserver.observe(outerNode);
    innerObserver.observe(innerNode);
    measure();

    return () => {
      outerObserver.disconnect();
      innerObserver.disconnect();
    };
  }, [baseWidth, fit, maxScale, minScale]);

  return (
    <div
      ref={outerRef}
      className={fit === "viewport" ? "table-viewport" : undefined}
      data-fit-mode={fit === "viewport" ? fallback ? "scroll" : "contain" : undefined}
      style={{
        width: "100%",
        minWidth: 0,
        height: fit === "viewport" ? "100%" : contentHeight * scale,
        minHeight: 0,
        overflow: fit === "viewport" ? "auto" : "hidden",
        position: "relative",
        flex: fit === "viewport" ? 1 : undefined,
      }}
    >
      {/* The sized wrapper reserves only the transformed footprint. Its overflow
          containment prevents the unscaled box from enlarging the scroll area. */}
      <div style={fit === "viewport" ? {
        width: contentWidth * scale,
        height: contentHeight * scale,
        position: "relative",
        overflow: "hidden",
        margin: "0 auto",
      } : undefined}>
        <div
          style={{
            width: baseWidth,
            position: fit === "viewport" ? "absolute" : undefined,
            top: 0,
            left: 0,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <div ref={innerRef} className={fit === "viewport" ? "saloon-composition" : undefined}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
