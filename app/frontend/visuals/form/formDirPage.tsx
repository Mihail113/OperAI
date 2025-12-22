import React, { useState, useEffect } from "react";
import { QuestionsInput } from "../components/QuestionsInput";
import { useTelegramUser } from "../hooks/useTelegramUser";
import { UserLoadingScreen } from "../components/UserLoadingScreen";
import "../styles/formPage.css";
const API_URL = import.meta.env.VITE_API_URL as string;

export const FormDirPage: React.FC = () => {
  const { username, tgId, isLoading: tgLoading, error: tgError } = useTelegramUser();
  const [employeeQuestions, setEmployeeQuestions] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Читаем параметр initial из URL
  const urlParams = new URLSearchParams(window.location.search);
  const isInitial = urlParams.get('initial') === 'true';

  useEffect(() => {
    if (!username) return;

    setFetching(true);
    setError(null);
    fetch(`${API_URL}/get_questions?username=${encodeURIComponent(username)}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Load failed");
        }
        return res.json();
      })
      .then((data) => {
        if (data.questions && Array.isArray(data.questions)) {
          if (data.questions.length > 0) {
            setEmployeeQuestions(data.questions);
          } else {
             // Если вопросов нет, оставляем один пустой инпут для удобства
             setEmployeeQuestions([""]);
          }
        }
      })
      .catch((err) => {
        console.error("Error fetching questions:", err);
        setError("Load failed");
      })
      .finally(() => {
        setFetching(false);
      });
  }, [username]);

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
    setLoading(true);

    const questions = employeeQuestions.filter((q) => q.trim() !== "");
    const questionsObj = Object.fromEntries(questions.map((q, i) => [String(i + 1), q])); // Чтобы сразу пронумерованные приходили
    const tg = (window as any).Telegram?.WebApp;

    try {
      const resp = await fetch(
        `${API_URL}/create_questions?actor_username=${encodeURIComponent(username || "")}&initial=${isInitial}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questions: questionsObj, user_tg_id: tgId }),
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

  // Экран загрузки или ошибки пользователя Telegram
  if (tgLoading || tgError || !username) {
    return (
      <UserLoadingScreen
        title="Вопросы для сотрудников"
        isLoading={tgLoading}
        error={tgError}
      />
    );
  }

  return (
    <div className="form-page">
      <div className="form-container">
        <h2 style={{ marginBottom: "0.5rem" }}>Анкета директора</h2>
        <div style={{ marginBottom: "1rem", textAlign: "left" }}>
          <strong>Вопросы по умолчанию:</strong>
          <ol style={{ paddingLeft: "1.5rem", marginTop: "0.5rem" }}>
            <li>Имя</li>
            <li>Фамилия</li>
            <li>Отчество (при наличии)</li>
            <li>Город</li>
            <li>Расписание (дни недели и рабочие часы)</li>
          </ol>
        </div>
        <form onSubmit={onSubmit}>
          <h3 style={{ marginBottom: "0rem" }}>Какие дополнительные вопросы должны быть в анкете регистрации сотрудника?</h3>
          
          {error && <div style={{ color: "crimson", marginTop: "1rem" }}>{error}</div>}

          {fetching ? (
            <div style={{ marginTop: "1rem", color: "#666" }}>Загрузка вопросов...</div>
          ) : (
            !error && (
              <QuestionsInput
                questions={employeeQuestions}
                handleQuestionChange={handleEmployeeQuestionChange}
                addQuestionField={addEmployeeQuestion}
                removeQuestionField={removeEmployeeQuestion}
              />
            )
          )}

          <button type="submit" className="submit-btn" disabled={loading || fetching || !!error}>
            {loading ? "Создаём форму..." : "Отправить"}
          </button>
        </form>
      </div>
    </div>
  );
};
