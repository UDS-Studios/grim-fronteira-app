import "./GameAlreadyStartedView.css";

type Props = {
  gameId: string;
  onBackHome: () => void;
  // Future art: public/assets/game-already-started.webp, passed via publicAsset().
  // Recommended 1600 × 900. The neutral gate panel remains until art is supplied.
  illustrationSrc?: string;
};

export default function GameAlreadyStartedView({ gameId, onBackHome, illustrationSrc }: Props) {
  return (
    <main className="already-started" aria-labelledby="already-started-title">
      <section className="already-started__panel">
        <div className="already-started__art" aria-hidden="true">
          {illustrationSrc ? <img src={illustrationSrc} alt="" /> : (
            <div className="already-started__gate">
              <span>Grim Fronteira</span>
              <div className="already-started__bars" />
              <span>The gates are closed</span>
            </div>
          )}
        </div>
        <div className="already-started__content">
          <h1 id="already-started-title">Game Already Started</h1>
          <p>This game has already started, so new players cannot join it.</p>
          <p>If you already joined this game earlier, reopen it from the same player or Marshal session.</p>
          <p>Otherwise, go back home and create or join a different game.</p>
          <p className="already-started__game">Game: <span>{gameId}</span></p>
          <button type="button" onClick={onBackHome}>Back Home</button>
        </div>
      </section>
    </main>
  );
}
