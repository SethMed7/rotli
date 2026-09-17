// The agent asked a question with fixed options (the `question` run event):
// one row of choices under the thread; picking one sends it as the answer.

import type { AgentQuestion } from "../../ai/types";

export function ChatClarificationBar({
  question,
  onAnswer,
}: {
  question: AgentQuestion;
  onAnswer: (answer: string) => void;
}) {
  return (
    <div className="chat-question-wrap">
      <section className="chat-question" aria-label="Choose an answer">
        <p>{question.prompt}</p>
        <div>
          {question.options.map((option) => (
            <button type="button" key={option} onClick={() => onAnswer(option)}>
              {option}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
