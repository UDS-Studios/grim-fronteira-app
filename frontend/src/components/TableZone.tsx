type TableZoneProps = {
  title: string;
  children: React.ReactNode;
};

export default function TableZone({ title, children }: TableZoneProps) {
  return (
    <div
      style={{
        border: "1px solid #333",
        borderRadius: 14,
        padding: 12,
        background: "#faf8f2",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ fontWeight: 800 }}>{title}</div>
      {children}
    </div>
  );
}