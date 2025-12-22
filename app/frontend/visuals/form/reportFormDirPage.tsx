import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTelegramUser } from "../hooks/useTelegramUser";
import { UserLoadingScreen } from "../components/UserLoadingScreen";
import "../styles/formPage.css";

const API_URL = import.meta.env.VITE_API_URL as string;

// Названия периодов для отображения
const PERIOD_NAMES: Record<string, string> = {
  daily: "Ежедневный",
  weekly: "Еженедельный",
  monthly: "Ежемесячный",
  yearly: "Ежегодный",
};

// Компонент для textarea с автоматическим изменением высоты
const AutoResizeTextarea: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}> = ({ value, onChange, placeholder, className }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      rows={1}
      style={{ overflow: "hidden", resize: "none" }}
    />
  );
};

export const ReportFormDirPage: React.FC = () => {
  const { username, isLoading: tgLoading, error: tgError } = useTelegramUser();
  const [questions, setQuestions] = useState<string[]>([""]);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);

  // Получаем period из URL параметров
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const periodParam = params.get("period");
    if (periodParam) {
      setPeriod(periodParam);
    } else {
      setError("Период не указан");
    }
  }, []);

  useEffect(() => {
    if (!period || !username) return;

    setFetching(true);
    setError(null);
    fetch(`${API_URL}/get_report_form_questions?username=${encodeURIComponent(username)}&period=${encodeURIComponent(period)}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Ошибка загрузки");
        }
        return res.json();
      })
      .then((data) => {
        if (data.questions && Array.isArray(data.questions)) {
          if (data.questions.length > 0) {
            setQuestions(data.questions);
          } else {
            setQuestions([""]);
          }
        }
      })
      .catch((err) => {
        console.error("Error fetching questions:", err);
        setError("Ошибка загрузки");
      })
      .finally(() => {
        setFetching(false);
      });
  }, [period, username]);

  const handleQuestionChange = (index: number, value: string) => {
    const updated = [...questions];
    updated[index] = value;
    setQuestions(updated);
  };

  const addQuestion = () => setQuestions([...questions, ""]);
  
  const removeQuestion = (index: number) =>
    setQuestions(questions.filter((_, i) => i !== index));

  const onSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    if (!period) {
      alert("Период не указан");
      return;
    }
    setLoading(true);

    const filteredQuestions = questions.filter((q) => q.trim() !== "");

    const questionsObj = Object.fromEntries(
      filteredQuestions.map((q, i) => [String(i), q])
    );

    const tg = (window as any).Telegram?.WebApp;
    const userTgId = tg?.initDataUnsafe?.user?.id;

    try {
      const resp = await fetch(
        `${API_URL}/create_report_form_questions?actor_username=${encodeURIComponent(username || "")}&period=${encodeURIComponent(period)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questions: questionsObj, user_tg_id: userTgId }),
        }
      );

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      
      alert("Форма отчетности сохранена");
      tg?.close();
    } catch (err: any) {
      alert(`Ошибка сохранения: ${err?.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const periodName = period ? (PERIOD_NAMES[period] || period) : "";

  // Экран загрузки или ошибки пользователя Telegram
  if (tgLoading || tgError || !username) {
    return (
      <UserLoadingScreen
        title="Форма отчётности"
        isLoading={tgLoading}
        error={tgError}
      />
    );
  }

  return (
    <div className="form-page">
      <div className="form-container">
        <h2 style={{ marginBottom: "0.5rem" }}>Форма отчетности</h2>
        {period && (
          <p style={{ marginBottom: "0.5rem", color: "#333", textAlign: "center", fontWeight: "bold" }}>
            Период: {periodName}
          </p>
        )}
        <p style={{ marginBottom: "1rem", color: "#666", textAlign: "center" }}>
          Задайте вопросы для формы отчетности сотрудников
        </p>
        
        <form onSubmit={onSubmit}>
          <h3 style={{ marginBottom: "0rem" }}>Вопросы формы:</h3>
          
          {error && <div style={{ color: "crimson", marginTop: "1rem" }}>{error}</div>}

          {fetching ? (
            <div style={{ marginTop: "1rem", color: "#666" }}>Загрузка вопросов...</div>
          ) : (
            !error && (
              <div>
                {questions.map((question, index) => (
                  <div key={index} className="child-row">
                    <AutoResizeTextarea
                      value={question}
                      placeholder={`Вопрос ${index + 1}`}
                      onChange={(value) => handleQuestionChange(index, value)}
                    />
                    {questions.length > 1 && (
                      <button
                        type="button"
                        className="remove-btn"
                        onClick={() => removeQuestion(index)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}

                <button type="button" onClick={addQuestion} className="add-btn">
                  + Добавить вопрос
                </button>
              </div>
            )
          )}

          <button type="submit" className="submit-btn" disabled={loading || fetching || !!error || !period}>
            {loading ? "Сохранение..." : "Сохранить форму"}
          </button>
        </form>
      </div>
    </div>
  );
};
