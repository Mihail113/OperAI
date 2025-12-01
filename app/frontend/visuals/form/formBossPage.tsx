import React, { useState, useEffect } from "react";
import "../styles/formPage.css";
import { ScheduleInput, ScheduleDay, DEFAULT_SCHEDULE, validateSchedule } from "../components/ScheduleInput";

const APIURL = import.meta.env.VITE_API_URL as string;

const QUESTIONS = [
  "Имя",
  "Фамилия",
  "Отчество (при наличии)",
];

const OPTIONAL_LABEL = "Отчество (при наличии)";

export const FormBossPage: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);

  // Answers for the 3 questions
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);

  // Schedule state - default Mon-Fri
  const [schedule, setSchedule] = useState<ScheduleDay[]>([...DEFAULT_SCHEDULE]);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const [actorUsername, setActorUsername] = useState<string>("");
  const [userTgId, setUserTgId] = useState<number | null>(null);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    const uname = `@${tg?.initDataUnsafe?.user?.username}`;
    const tgId = tg?.initDataUnsafe?.user?.id;
    setActorUsername(uname);
    setUserTgId(tgId ? Number(tgId) : null);
  }, []);

  const [msgId, setMsgId] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const idParam = params.get("company_id");
    const msgIdParam = params.get("msg_id");
    setCompanyId(idParam ? parseInt(idParam, 10) : null);
    setMsgId(msgIdParam ? parseInt(msgIdParam, 10) : null);
  }, []);

  const handleAnswerChange = (index: number, value: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setError(null);
    setScheduleError(null);

    if (!companyId) {
      setError("Не удалось определить компанию. Откройте форму заново.");
      return;
    }

    if (schedule.length === 0) {
      setScheduleError("Добавьте хотя бы один рабочий день");
      return;
    }

    if (!validateSchedule(schedule, setScheduleError)) {
      return;
    }

    const normalizedAnswers = answers.map((a) => (a ?? "").trim());

    // Format schedule for payload
    const schedulePayload = schedule.map((day) => ({
      day: day.dayOfWeek,
      intervals: day.intervals.map((interval) => ({
        start: interval.start,
        end: interval.end
      }))
    }));

    const payload = {
      company_id: companyId,
      actor_username: actorUsername,
      user_tg_id: userTgId,
      msg_id: msgId,
      first_name: normalizedAnswers[0],
      last_name: normalizedAnswers[1],
      patronymic: normalizedAnswers[2],
      schedule: JSON.stringify(schedulePayload),
    };

    setLoading(true);

    try {
      const res = await fetch(
        `${APIURL}/submit_boss_profile`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }

      const data = await res.json();

      if (data.status === "ok") {
        // Успешное завершение — закрываем мини-апп
        (window as any).Telegram?.WebApp?.close();
        return;
      }

      setError(data.message || "Произошла ошибка при сохранении данных.");
    } catch (e: any) {
      setError(e.message || "Ошибка соединения");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="form-page">
      <div className="form-container">
        <h2>Анкета руководителя</h2>

        {error && <div style={{ color: "crimson" }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          {QUESTIONS.map((q, i) => (
            <div key={i} className="question-block">
              <label>{q}</label>
              <input
                type="text"
                value={answers[i] ?? ""}
                onChange={(e) => handleAnswerChange(i, e.target.value)}
                required={q !== OPTIONAL_LABEL}
              />
            </div>
          ))}

          <ScheduleInput
            schedule={schedule}
            setSchedule={setSchedule}
            scheduleError={scheduleError}
          />

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? "Сохранение..." : "Отправить"}
          </button>
        </form>
      </div>
    </div>
  );
};

