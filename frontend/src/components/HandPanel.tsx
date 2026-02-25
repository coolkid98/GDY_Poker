import { cardThemeClass, toCardLabel } from "../utils/cards";

interface HandPanelProps {
  hand: string[];
  selected: string[];
  incomingCardId?: string | null;
  incomingPulseTick?: number;
  onToggle: (cardId: string) => void;
}

export const HandPanel = ({
  hand,
  selected,
  incomingCardId = null,
  incomingPulseTick = 0,
  onToggle
}: HandPanelProps): JSX.Element => {
  const selectedSet = new Set(selected);

  return (
    <div className="hand-panel">
      <h3>我的手牌（仅本人可见）</h3>
      <div className="cards-grid">
        {hand.map((cardId) => {
          const isIncoming = incomingCardId === cardId;
          const key = isIncoming ? `${cardId}-${incomingPulseTick}` : cardId;

          return (
            <button
              key={key}
              type="button"
              className={`card-btn ${cardThemeClass(cardId)} ${selectedSet.has(cardId) ? "selected" : ""} ${
                isIncoming ? "incoming" : ""
              }`}
              onClick={() => onToggle(cardId)}
            >
              <span className="card-main">{toCardLabel(cardId)}</span>
              <span className="card-sub">{cardId.split("-")[0]}号牌堆</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
