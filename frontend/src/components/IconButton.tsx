import { useState } from "react";

type IconButtonProps = {
  src: string;
  alt: string;
  onClick?: () => void;
  title?: string;
  size?: number;
  disabled?: boolean;
  className?: string;
  describedBy?: string;
};

export default function IconButton({
  src,
  alt,
  onClick,
  title,
  size = 40,
  disabled = false,
  className,
  describedBy,
}: IconButtonProps) {
  const [hover, setHover] = useState(false);

  return (
    <button
      type="button"
      disabled={disabled}
      className={className}
      aria-label={alt}
      aria-describedby={describedBy}
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: disabled ? "not-allowed" : onClick ? "pointer" : "default",
        opacity: disabled ? 0.35 : hover ? 1 : 0.85,
        transition: "opacity 0.15s ease",
      }}
    >
      <img
        src={src}
        alt=""
        style={{
          width: size,
          height: size,
          display: "block",
        }}
      />
    </button>
  );
}
