interface HandPanelProps {
  hand: string[];
  selected: string[];
  onToggle: (cardId: string) => void;
}

export const HandPanel = ({ hand, selected, onToggle }: HandPanelProps): JSX.Element => {
  const selectedSet = new Set(selected);

  return (
    <div className="hand-panel">
      <h3>我的手牌（仅本人可见）</h3>
      <div className="cards-grid">
        {hand.map((cardId) => (
          <button
            key={cardId}
            type="button"
            className={`card-btn ${selectedSet.has(cardId) ? "selected" : ""}`}
            onClick={() => onToggle(cardId)}
          >
            {cardId}
          </button>
        ))}
      </div>
    </div>
  );
};
