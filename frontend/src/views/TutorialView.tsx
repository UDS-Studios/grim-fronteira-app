import { useState } from "react";
import { publicAsset } from "../app/assets";
import { tutorials } from "./tutorials";
import "./TutorialView.css";

type TutorialRole = keyof typeof tutorials;

export default function TutorialView({ onBackHome }: { onBackHome: () => void }) {
  const [role, setRole] = useState<TutorialRole | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const tutorial = role ? tutorials[role] : null;
  const step = tutorial?.steps[stepIndex];
  const imageUrl = role && step ? publicAsset(`assets/tutorials/${role}/${step.filename}.png`) : "";

  function chooseRole(nextRole: TutorialRole) {
    setStepIndex(0);
    setRole(nextRole);
  }

  return (
    <main className="tutorial-page">
      <div className="tutorial-panel">
        <header className="tutorial-header">
          <h1>{tutorial?.title ?? "Tutorials"}</h1>
          <div className="tutorial-controls">
            {role && <button className="tutorial-button-return" type="button" onClick={() => setRole(null)}>Choose tutorial</button>}
            <button className="tutorial-button-return" type="button" onClick={onBackHome}>Back Home</button>
          </div>
        </header>

        {!tutorial ? (
          <div className="tutorial-role-selection">
            <p>Choose your role to follow the graphical tutorial.</p>
            <div className="tutorial-controls">
              <button className="tutorial-role-badge" type="button" aria-label="Marshal Tutorial" onClick={() => chooseRole("marshal")}>
                <img src={publicAsset("ui/tutorials/Vintage Marshal Tutorial Badge.png")} alt="Marshal Tutorial" />
              </button>
              <button className="tutorial-role-badge" type="button" aria-label="Player Tutorial" onClick={() => chooseRole("player")}>
                <img src={publicAsset("ui/tutorials/Gritty Outlaw Player Tutorial Badge.png")} alt="Player Tutorial" />
              </button>
            </div>
          </div>
        ) : step && (
          <>
            <nav className="tutorial-controls tutorial-step-navigation" aria-label="Tutorial steps">
              <button className="tutorial-button-return" type="button" disabled={stepIndex === 0} onClick={() => setStepIndex(index => Math.max(0, index - 1))}>Previous</button>
              <span role="status" aria-live="polite">Step {stepIndex + 1} of {tutorial.steps.length}</span>
              <button className="tutorial-button-next" type="button" disabled={stepIndex === tutorial.steps.length - 1} onClick={() => setStepIndex(index => Math.min(tutorial.steps.length - 1, index + 1))}>Next</button>
            </nav>
            <h2>{step.title}</h2>
            <figure className="tutorial-slide">
              <a href={imageUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open full-size image: ${step.title} (new tab)`}>
                <img src={imageUrl} alt={`Step ${step.num}: ${step.title}. ${step.caption}`} />
              </a>
              <figcaption>{step.caption}</figcaption>
            </figure>
            <a className="tutorial-full-size" href={imageUrl} target="_blank" rel="noopener noreferrer">Open full-size image (new tab)</a>
          </>
        )}
      </div>
    </main>
  );
}
