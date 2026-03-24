type TableZoneProps = {
  title: string;
  children: React.ReactNode;
};

export default function TableZone({ title, children }: TableZoneProps) {
  return (
    <div
      style={{
        border: "1px solid var(--border-strong)",
        borderRadius: 14,
        padding: 12,
        background: "var(--surface-bg)",
        display: "grid",
        gap: 10,
        minHeight: 0,
      }}
    >
      <div style={{ fontWeight: 800 }}>{title}</div>
      {children}
    </div>
  );
}
