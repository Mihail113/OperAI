import React from "react";

interface QuestionsInputProps {
  questions: string[];
  handleQuestionChange: (index: number, value: string) => void;
  addQuestionField: () => void;
  removeQuestionField: (index: number) => void;
}

export const QuestionsInput: React.FC<QuestionsInputProps> = ({
  questions,
  handleQuestionChange,
  addQuestionField,
  removeQuestionField
}) => (
  <div>
    {questions.map((question, index) => (
      <div key={index} className="child-row">
        <input
          value={question}
          placeholder={`Вопрос ${index + 1}`}
          onChange={(e) => handleQuestionChange(index, e.target.value)}
        />
        {questions.length > 1 && (
          <button
            type="button"
            className="remove-btn"
            onClick={() => removeQuestionField(index)}
          >
            ×
          </button>
        )}
      </div>
    ))}

    <button type="button" onClick={addQuestionField} className="add-btn">
      + Добавить вопрос
    </button>
  </div>
);
