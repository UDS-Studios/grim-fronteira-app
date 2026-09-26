type SceneStatusProps = {
  message: string;
  ownTurn?: boolean;
};

export default function SceneStatus({ message, ownTurn = false }: SceneStatusProps) {
  return (
    <div role="status" className={`scene-status${ownTurn ? " scene-status--your-turn" : ""}`}>
      {message}
    </div>
  );
}
