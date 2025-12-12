import React, { useState, useEffect, useCallback, useRef } from "react";
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
  required?: boolean;
  disabled?: boolean;
}> = ({ value, onChange, placeholder, className, required, disabled }) => {
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
      required={required}
      disabled={disabled}
      style={{ overflow: "hidden", resize: "none" }}
    />
  );
};

export const ReportSubmitPage: React.FC = () => {
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<string>("");
  const [actorUsername, setActorUsername] = useState<string>("");
  const [fullName, setFullName] = useState<string | null>(null);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    const username = tg?.initDataUnsafe?.user?.username;
    const uname = username ? (username.startsWith("@") ? username : `@${username}`) : "";
    setActorUsername(uname);

    // Читаем period из URL
    const params = new URLSearchParams(window.location.search);
    const periodParam = params.get("period");
    if (periodParam) {
      setPeriod(periodParam);
    }
  }, []);

  useEffect(() => {
    if (!actorUsername || !period) return;

    setLoading(true);
    setError(null);
    
    // include_full_name=true для получения полного имени вместе с вопросами
    fetch(`${API_URL}/get_report_form_questions?username=${encodeURIComponent(actorUsername)}&period=${encodeURIComponent(period)}&include_full_name=true`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error("Ошибка загрузки вопросов");
        }
        return res.json();
      })
      .then((data) => {
        if (data.questions && Array.isArray(data.questions)) {
          setQuestions(data.questions);
          setAnswers(new Array(data.questions.length).fill(""));
        } else {
          setQuestions([]);
          setAnswers([]);
        }
        // Сохраняем full_name из ответа
        if (data.full_name) {
          setFullName(data.full_name);
        }
      })
      .catch((err) => {
        console.error("Error fetching questions:", err);
        setError("Ошибка загрузки вопросов");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [actorUsername, period]);

  const handleAnswerChange = (index: number, value: string) => {
    const updated = [...answers];
    updated[index] = value;
    setAnswers(updated);
  };

  const onSubmit: React.FormEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    const tg = (window as any).Telegram?.WebApp;
    const username = tg?.initDataUnsafe?.user?.username;
    const userId = tg?.initDataUnsafe?.user?.id;
    
    if (!username) {
      alert("Не удалось определить пользователя");
      setSubmitting(false);
      return;
    }

    // Формируем объект ответов
    const answersObj: Record<string, string> = {};
    questions.forEach((_, i) => {
      answersObj[String(i)] = answers[i] || "";
    });

    // Формируем объект вопросов для отправки
    const questionsObj: Record<string, string> = {};
    questions.forEach((q, i) => {
      questionsObj[String(i)] = q;
    });

    try {
      const resp = await fetch(
        `${API_URL}/submit_report_answers?actor_username=${encodeURIComponent(username)}&period=${encodeURIComponent(period)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers: answersObj, questions: questionsObj, user_tg_id: userId, full_name: fullName }),
        }
      );

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      
      const data = await resp.json();
      alert(data.message || "Отчет успешно отправлен");
      tg?.close();
    } catch (err: any) {
      alert(`Ошибка отправки: ${err?.message || err}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Экран загрузки
  if (loading) {
    return (
      <div className="form-page">
        <div className="form-container">
          <h2>Отчет</h2>
          <div style={{ textAlign: "center", padding: "2rem", color: "#666" }}>
            <div style={{ 
              display: "inline-block",
              width: "24px",
              height: "24px",
              border: "3px solid #e0e0e0",
              borderTop: "3px solid #007aff",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              marginBottom: "12px"
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <div>Загрузка вопросов...</div>
          </div>
        </div>
      </div>
    );
  }

  // Экран ошибки
  if (error) {
    return (
      <div className="form-page">
        <div className="form-container">
          <h2>Отчет</h2>
          <div style={{ color: "crimson", textAlign: "center", padding: "2rem" }}>
            {error}
          </div>
        </div>
      </div>
    );
  }

  // Нет вопросов
  if (questions.length === 0) {
    return (
      <div className="form-page">
        <div className="form-container">
          <h2>Отчет</h2>
          <div style={{ textAlign: "center", padding: "2rem", color: "#666" }}>
            Форма отчетности не настроена. Обратитесь к руководителю.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-page">
      <div className="form-container">
        <h2>Отчет</h2>
        {period && (
          <p style={{ marginBottom: "1rem", color: "#666", textAlign: "center" }}>
            Период: {PERIOD_NAMES[period] || period}
          </p>
        )}

        <form onSubmit={onSubmit}>
          {questions.map((question, index) => (
            <div key={index} className="question-block">
              <label>{question}</label>
              <AutoResizeTextarea
                value={answers[index] || ""}
                onChange={(value) => handleAnswerChange(index, value)}
                placeholder="Введите ответ..."
                required
              />
            </div>
          ))}

          <button 
            type="submit" 
            className="submit-btn" 
            disabled={submitting}
          >
            {submitting ? "Отправка..." : "Отправить отчет"}
          </button>
        </form>
      </div>
    </div>
  );
};
