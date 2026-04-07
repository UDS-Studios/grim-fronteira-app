import { useState } from "react";

type IconButtonProps = {
  src: string;
  alt: string;
  onClick?: () => void;
  title?: string;
  size?: number;
};

export default function IconButton({
  src,
  alt,
  onClick,
  title,
  size = 40,
}: IconButtonProps) {
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: onClick ? "pointer" : "default",
        opacity: hover ? 1 : 0.85,
        transition: "opacity 0.15s ease",
      }}
    >
      <img
        src={src}
        alt={alt}
        style={{
          width: size,
          height: size,
          display: "block",
        }}
      />
    </button>
  );
}
