type TableZoneProps = {
  title: string;
  children: React.ReactNode;
  fill?: boolean;
  headerRight?: React.ReactNode;
  borderColor?: string;
  background?: string;
  titleColor?: string;
};

export default function TableZone({
  title,
  children,
  fill = false,
  headerRight,
  borderColor,
  background,
  titleColor,
}: TableZoneProps) {
  return (
    <div
      style={{
        border: `1px solid ${borderColor ?? "var(--border-strong)"}`,
        borderRadius: 14,
        padding: 12,
        background: background ?? "var(--surface-bg)",
        display: "grid",
        gap: 10,
        gridTemplateRows: fill ? "auto minmax(0, 1fr)" : undefined,
        height: fill ? "100%" : undefined,
        minHeight: 0,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ fontWeight: 800, color: titleColor ?? "inherit" }}>{title}</div>
        {headerRight}
      </div>
      {children}
    </div>
  );
}
