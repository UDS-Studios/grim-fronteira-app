import type { ReactNode } from "react";

type SectionProps = {
  title: string;
  children: ReactNode;
};

export default function Section({ title, children }: SectionProps) {
  return (
    <div
      style={{
        border: "1px solid var(--border-strong)",
        borderRadius: 14,
        padding: 14,
        background: "var(--surface-bg)",
        minHeight: 0,
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}
