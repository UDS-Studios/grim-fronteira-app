import { useEffect, useState } from "react";

const seenInTab = new Map<string, string>();
const storageKey = (gameId: string) => `gf_solo_narration:${gameId}`;

function alreadySeen(gameId: string, passageId: string): boolean {
  try {
    return seenInTab.get(gameId) === passageId ||
      globalThis.sessionStorage?.getItem(storageKey(gameId)) === passageId;
  } catch {
    return seenInTab.get(gameId) === passageId;
  }
}

function remember(gameId: string, passageId: string) {
  seenInTab.set(gameId, passageId);
  try {
    // Remember on arrival, so reloading midway reveals rather than restarts it.
    globalThis.sessionStorage?.setItem(storageKey(gameId), passageId);
  } catch { /* Animation still works when browser storage is unavailable. */ }
}

type Props = { gameId: string; passageId: string; text: string };

/** The Saloon's character-by-character reveal, paced for reading. */
export default function SoloNarration({ gameId, passageId, text }: Props) {
  const [finished, setFinished] = useState(() => typeof window === "undefined" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true ||
    alreadySeen(gameId, passageId));
  const [visibleChars, setVisibleChars] = useState(0);

  useEffect(() => {
    remember(gameId, passageId);
    if (finished) return;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reveal = () => { if (media?.matches) setFinished(true); };
    reveal();
    media?.addEventListener("change", reveal);
    let count = 0;
    let timer: number;
    const revealNext = () => {
      count++;
      setVisibleChars(count);
      if (count >= text.length) {
        setFinished(true);
        return;
      }
      const character = text[count - 1];
      const delay = character === "," ? 290 : character === "." ? 580 : 25;
      timer = window.setTimeout(revealNext, delay);
    };
    timer = window.setTimeout(revealNext, 25);
    return () => {
      window.clearTimeout(timer);
      media?.removeEventListener("change", reveal);
    };
  }, [gameId, passageId, text, finished]);

  const animating = !finished && visibleChars < text.length;
  return <p className="solo-story-text solo-narration">
    <span className="solo-narration-accessible">{text}</span>
    <span className="solo-narration-space" aria-hidden="true">{text}</span>
    <span className="solo-narration-typed" aria-hidden="true">
      {finished ? text : text.slice(0, visibleChars)}
      {animating && <span className="solo-narration-cursor">▌</span>}
    </span>
    {animating && <button type="button" className="solo-narration-reveal"
      aria-label="Reveal full scene description" title="Click to reveal the full description"
      onClick={() => setFinished(true)} />}
  </p>;
}
