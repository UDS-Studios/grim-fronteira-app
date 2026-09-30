export default function DarkRewardPayment({ active, busy, canConfirm, onToggle, onConfirm }: {
  active: boolean; busy: boolean; canConfirm: boolean;
  onToggle: () => void; onConfirm: () => void;
}) {
  return <div className="dark-reward-payment" aria-busy={busy}>
    <div role="status"><strong>THE DARK DEMANDS PAYMENT</strong><br />Choose 1 Reward to lose before the next scene can begin.</div>
    <div className="dark-reward-payment-actions">
      <button type="button" aria-pressed={active} disabled={busy} onClick={onToggle}>
        {active ? "Cancel selection" : "Choose Dark Reward"}
      </button>
      <button type="button" disabled={busy || !canConfirm} onClick={onConfirm}>LOSE REWARD</button>
    </div>
  </div>;
}
