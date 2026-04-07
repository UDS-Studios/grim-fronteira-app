import { useEffect, useRef, useState } from "react";

type ResponsiveScaleBoxProps = {
  baseWidth: number;
  minScale?: number;
  maxScale?: number;
  children: React.ReactNode;
};

export default function ResponsiveScaleBox({
  baseWidth,
  minScale = 0.5,
  maxScale = 1,
  children,
}: ResponsiveScaleBoxProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    const outerNode = outerRef.current;
    const innerNode = innerRef.current;
    if (!outerNode || !innerNode) return;

    const outerObserver = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const nextScale = Math.max(minScale, Math.min(maxScale, width / baseWidth));
      setScale(nextScale);
    });

    const innerObserver = new ResizeObserver(([entry]) => {
      setContentHeight(entry.contentRect.height);
    });

    outerObserver.observe(outerNode);
    innerObserver.observe(innerNode);

    return () => {
      outerObserver.disconnect();
      innerObserver.disconnect();
    };
  }, [baseWidth, maxScale, minScale]);

  return (
    <div
      ref={outerRef}
      style={{
        width: "100%",
        minWidth: 0,
        height: contentHeight * scale,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: baseWidth,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <div ref={innerRef}>
          {children}
        </div>
      </div>
    </div>
  );
}
