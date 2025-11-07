import React, { useState } from "react";
import { QuestionsInput } from "../components/QuestionsInput";
import "../styles/formPage.css";
const API_URL = import.meta.env.VITE_API_URL as string;

export const FormDirPage: React.FC = () => {
  const [employeeQuestions, setEmployeeQuestions] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);

  const handleEmployeeQuestionChange = (index: number, value: string) => {
    const updated = [...employeeQuestions];
    updated[index] = value;
    setEmployeeQuestions(updated);
  };

  const addEmployeeQuestion = () => setEmployeeQuestions([...employeeQuestions, ""]);
  const removeEmployeeQuestion = (index: number) =>
    setEmployeeQuestions(employeeQuestions.filter((_, i) => i !== index));

  const onSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();

    const questions = employeeQuestions.filter((q) => q.trim() !== "");
    if (!questions.length) {
      alert("Добавьте хотя бы один вопрос для формы!");
      return;
    }

    const questionsObj = Object.fromEntries(questions.map((q, i) => [String(i + 1), q])); // Чтобы сразу пронумерованные приходили
    const tg = (window as any).Telegram?.WebApp;

    const username = tg?.initDataUnsafe?.user?.username;
    if (!username) {
      tg?.sendData(JSON.stringify({ action: 'create_questions', questions: questionsObj }));
      return;
    }

    try {
      setLoading(true);
      const resp = await fetch(
        `${API_URL}/create_questions?actor_username=${encodeURIComponent(username)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questions: questionsObj }),
        }
      );

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      alert(`Анкета изменена: версия ${data.version_no}`);
      tg?.close(); // по желанию
    } catch (err: any) {
      alert(`Ошибка создания анкеты: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-page">
      <div className="form-container">
        <h2>Анкета директора</h2>
        <form onSubmit={onSubmit}>
          <h3>Какие вопросы должны быть в анкете регистрации сотрудника?</h3>
          <QuestionsInput
            questions={employeeQuestions}
            handleQuestionChange={handleEmployeeQuestionChange}
            addQuestionField={addEmployeeQuestion}
            removeQuestionField={removeEmployeeQuestion}
          />

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? "Создаём форму..." : "Отправить"}
          </button>
        </form>
      </div>
    </div>
  );
};
