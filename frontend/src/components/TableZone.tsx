type TableZoneProps = {
  title: string;
  children: React.ReactNode;
  fill?: boolean;
};

export default function TableZone({ title, children, fill = false }: TableZoneProps) {
  return (
    <div
      style={{
        border: "1px solid var(--border-strong)",
        borderRadius: 14,
        padding: 12,
        background: "var(--surface-bg)",
        display: "grid",
        gap: 10,
        gridTemplateRows: fill ? "auto minmax(0, 1fr)" : undefined,
        height: fill ? "100%" : undefined,
        minHeight: 0,
      }}
    >
      <div style={{ fontWeight: 800 }}>{title}</div>
      {children}
    </div>
  );
}
