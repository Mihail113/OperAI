import React, { useState, useEffect, useMemo } from "react";
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
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);
  // initial = true если company_id из URL (регистрация), false если из БД (редактирование)
  const [isInitial, setIsInitial] = useState<boolean>(false);

  // Answers for the 3 questions
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);

  // Schedule state - default Mon-Fri
  const [schedule, setSchedule] = useState<ScheduleDay[]>([...DEFAULT_SCHEDULE]);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Оригинальные данные для отслеживания изменений (только для редактирования)
  const [originalAnswers, setOriginalAnswers] = useState<string[] | null>(null);
  const [originalSchedule, setOriginalSchedule] = useState<ScheduleDay[] | null>(null);

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
  const [urlCompanyId, setUrlCompanyId] = useState<number | null>(null);

  // Читаем параметры из URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const msgIdParam = params.get("msg_id");
    const companyIdParam = params.get("company_id");
    setMsgId(msgIdParam ? parseInt(msgIdParam, 10) : null);
    
    if (companyIdParam) {
      const parsedId = parseInt(companyIdParam, 10);
      setUrlCompanyId(parsedId);
      setCompanyId(parsedId);
      setIsInitial(true); // company_id из URL = регистрация
    }
  }, []);

  // Загрузка существующего профиля (только если company_id НЕ в URL)
  useEffect(() => {
    const fetchProfile = async () => {
      // Если company_id уже получен из URL — это регистрация, не загружаем профиль
      if (urlCompanyId) {
        setLoadingProfile(false);
        return;
      }

      // Ждём, пока actorUsername будет установлен (не пустой и не @undefined)
      if (!actorUsername) {
        // Не завершаем загрузку — ждём следующего вызова useEffect
        return;
      }

      try {
        const res = await fetch(
          `${APIURL}/get_boss_profile?username=${encodeURIComponent(actorUsername)}`
        );

        if (!res.ok) {
          setLoadingProfile(false);
          return;
        }

        const data = await res.json();

        // Устанавливаем company_id из ответа (редактирование)
        if (data.company_id) {
          setCompanyId(data.company_id);
          setIsInitial(false); // company_id из БД = редактирование
        }

        // Заполняем поля, если данные есть
        const loadedAnswers = [
          data.first_name || "",
          data.last_name || "",
          data.patronymic || ""
        ];
        setAnswers(loadedAnswers);
        setOriginalAnswers(loadedAnswers);

        // Заполняем расписание, если оно есть
        if (data.schedule && data.schedule.length > 0) {
          const loadedSchedule: ScheduleDay[] = data.schedule.map((day: any) => ({
            dayOfWeek: day.day,
            intervals: day.intervals.map((interval: any) => ({
              start: interval.start,
              end: interval.end
            }))
          }));
          setSchedule(loadedSchedule);
          setOriginalSchedule(loadedSchedule);
        } else {
          setOriginalSchedule([...DEFAULT_SCHEDULE]);
        }
      } catch (e) {
        console.error("Ошибка загрузки профиля:", e);
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchProfile();
  }, [actorUsername, urlCompanyId]);

  const handleAnswerChange = (index: number, value: string) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  // Проверка наличия изменений (для режима редактирования)
  const hasChanges = useMemo(() => {
    if (isInitial) return true; // При регистрации всегда разрешаем отправку
    if (!originalAnswers || !originalSchedule) return false;

    // Сравниваем ответы
    const answersChanged = answers.some((a, i) => (a ?? "").trim() !== (originalAnswers[i] ?? "").trim());
    if (answersChanged) return true;

    // Сравниваем расписание (по JSON-сериализации)
    const currentScheduleJson = JSON.stringify(schedule);
    const originalScheduleJson = JSON.stringify(originalSchedule);
    if (currentScheduleJson !== originalScheduleJson) return true;

    return false;
  }, [isInitial, answers, schedule, originalAnswers, originalSchedule]);

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

    // Формируем старое расписание для отправки (только при редактировании)
    const oldSchedulePayload = originalSchedule?.map((day) => ({
      day: day.dayOfWeek,
      intervals: day.intervals.map((interval) => ({
        start: interval.start,
        end: interval.end
      }))
    }));

    const payload: Record<string, any> = {
      company_id: companyId,
      actor_username: actorUsername,
      user_tg_id: userTgId,
      msg_id: msgId,
      first_name: normalizedAnswers[0],
      last_name: normalizedAnswers[1],
      patronymic: normalizedAnswers[2],
      schedule: JSON.stringify(schedulePayload),
      initial: isInitial,
    };

    // Добавляем исходные данные только при редактировании
    if (!isInitial && originalAnswers) {
      payload.old_first_name = originalAnswers[0] || "";
      payload.old_last_name = originalAnswers[1] || "";
      payload.old_patronymic = originalAnswers[2] || "";
      payload.old_schedule = oldSchedulePayload ? JSON.stringify(oldSchedulePayload) : "[]";
    }

    setLoading(true);

    try {
      const res = await fetch(
        `${APIURL}/update_boss_profile`,
        {
          method: "PUT",
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

  if (loadingProfile) {
    return (
      <div className="form-page">
        <div className="form-container">
          <h2>Мои данные</h2>
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
            <div>Загрузка данных...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-page">
      <div className="form-container">
        <h2>Мои данные</h2>

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

          <button 
            type="submit" 
            className="submit-btn" 
            disabled={loading || (!isInitial && !hasChanges)}
          >
            {loading 
              ? "Сохранение..." 
              : isInitial 
                ? "Отправить" 
                : "Изменить мои данные"
            }
          </button>
        </form>
      </div>
    </div>
  );
};

