import React, { useState, useEffect, useMemo, useRef } from "react";
import "../styles/formPage.css";
import { ScheduleInput, ScheduleDay, DEFAULT_SCHEDULE, validateSchedule } from "../components/ScheduleInput";
import { useTelegramUser } from "../hooks/useTelegramUser";
import { UserLoadingScreen } from "../components/UserLoadingScreen";

const APIURL = import.meta.env.VITE_API_URL as string;
const FIRST4 = [
  "Имя",
  "Фамилия",
  "Отчество (при наличии)",
  "Город",
];
const OPTIONAL_LABEL = "Отчество (при наличии)";

type Manager = { id: number; username: string; fullname: string | null };

type QuestionsResponse = {
  questions: string[];
};

type WorkerProfileResponse = {
  company_id: number | null;
  first_name: string;
  last_name: string;
  patronymic: string;
  city: string;
  schedule: { day: number; intervals: { start: string; end: string }[] }[];
  additional_answers: Record<string, string>;
  managers: Manager[];  // Текущие начальники с id
  available_managers: Manager[];  // Доступные начальники с id
  current_questions: Record<string, string>;
  answer_version: number;
  has_pending_change: boolean;
  pending_old_answers: Record<string, string> | null;
  pending_new_answers: Record<string, string> | null;
  pending_old_schedule: { day: number; intervals: { start: string; end: string }[] }[] | null;
  pending_new_schedule: { day: number; intervals: { start: string; end: string }[] }[] | null;
  pending_old_managers: Manager[] | null;  // Старые начальники с id/username/fullname
  pending_new_managers: Manager[] | null;  // Новые начальники с id/username/fullname
};

// Тип для категоризации вопросов при редактировании
type QuestionCategory = "existing" | "deleted" | "added";

export const FormEmpPage: React.FC = () => {
  const [serverQuestions, setServerQuestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<number | null>(null);
  
  // initial = true если company_id из URL (регистрация), false если из БД (редактирование)
  const [isInitial, setIsInitial] = useState<boolean>(false);
  const [urlCompanyId, setUrlCompanyId] = useState<number | null>(null);

  // State for managers selection
  const [possibleManagers, setPossibleManagers] = useState<Manager[]>([]);
  const [managersLoading, setManagersLoading] = useState(false);
  const [managersFetchError, setManagersFetchError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedManagers, setSelectedManagers] = useState<number[]>([]);  // Храним ID
  const [mgrError, setMgrError] = useState<string | null>(null);
  
  // Текущие начальники (для режима редактирования) - с id/username/fullname
  const [currentManagers, setCurrentManagers] = useState<Manager[]>([]);
  
  // Оригинальные ID начальников для отслеживания изменений (только для редактирования)
  const [originalManagers, setOriginalManagers] = useState<number[]>([]);
  
  // Доступные начальники для выбора в режиме редактирования (без себя и подчинённых)
  const [availableManagers, setAvailableManagers] = useState<Manager[]>([]);

  // Schedule state - default Mon-Fri
  const [schedule, setSchedule] = useState<ScheduleDay[]>([...DEFAULT_SCHEDULE]);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Оригинальные данные для отслеживания изменений (только для редактирования)
  const [originalAnswers, setOriginalAnswers] = useState<string[] | null>(null);
  const [originalSchedule, setOriginalSchedule] = useState<ScheduleDay[] | null>(null);

  // Категории вопросов (только для редактирования)
  const [questionCategories, setQuestionCategories] = useState<Map<number, QuestionCategory>>(new Map());
  // Вопросы из версии пользователя (для отображения удалённых)
  const [userVersionQuestions, setUserVersionQuestions] = useState<string[]>([]);

  // Pending change state
  const [hasPendingChange, setHasPendingChange] = useState(false);
  const [pendingOldAnswers, setPendingOldAnswers] = useState<Record<string, string> | null>(null);
  const [pendingNewAnswers, setPendingNewAnswers] = useState<Record<string, string> | null>(null);
  const [pendingOldSchedule, setPendingOldSchedule] = useState<{ day: number; intervals: { start: string; end: string }[] }[] | null>(null);
  const [pendingNewSchedule, setPendingNewSchedule] = useState<{ day: number; intervals: { start: string; end: string }[] }[] | null>(null);
  const [pendingOldManagers, setPendingOldManagers] = useState<string[] | null>(null);
  const [pendingNewManagers, setPendingNewManagers] = useState<string[] | null>(null);

  const allQuestions = useMemo(() => {
    if (isInitial) {
      // Регистрация: FIRST4 + serverQuestions
      return [...FIRST4, ...serverQuestions];
    } else {
      // Редактирование: FIRST4 + объединение userVersionQuestions и serverQuestions
      // Удалённые вопросы показываем, но они readonly
      const combined = new Set([...userVersionQuestions, ...serverQuestions]);
      return [...FIRST4, ...Array.from(combined)];
    }
  }, [serverQuestions, userVersionQuestions, isInitial]);
  
  const [answers, setAnswers] = useState<string[]>([]);

  useEffect(() => {
    // Синхронизация длины ответов при изменении списка вопросов
    setAnswers(prev => {
      if (prev.length < allQuestions.length) {
        return [...prev, ...Array(allQuestions.length - prev.length).fill("")];
      }
      if (prev.length > allQuestions.length) {
        return prev.slice(0, allQuestions.length);
      }
      return prev;
    });
  }, [allQuestions.length]);

  const { username: actorUsername, tgId: userTgId, isLoading: tgLoading, error: tgError } = useTelegramUser();

  // Читаем параметры из URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const companyIdParam = params.get("company_id");
    
    if (companyIdParam) {
      const parsedId = parseInt(companyIdParam, 10);
      setUrlCompanyId(parsedId);
      setCompanyId(parsedId);
      setIsInitial(true); // company_id из URL = регистрация
    }
  }, []);

  // Загрузка профиля для редактирования (только если company_id НЕ в URL)
  useEffect(() => {
    const fetchProfile = async () => {
      // Если company_id уже получен из URL — это регистрация
      if (urlCompanyId) {
        setLoadingProfile(false);
        return;
      }

      // Ждём, пока actorUsername будет установлен (хук useTelegramUser возвращает null во время загрузки)
      if (!actorUsername) {
        return;
      }

      try {
        const res = await fetch(
          `${APIURL}/get_worker_profile?username=${encodeURIComponent(actorUsername)}`
        );

        if (!res.ok) {
          setLoadingProfile(false);
          return;
        }

        const data: WorkerProfileResponse = await res.json();

        // Устанавливаем company_id из ответа (редактирование)
        if (data.company_id) {
          setCompanyId(data.company_id);
          setIsInitial(false);
        } else {
          // Профиль не найден, возможно пользователь не зарегистрирован
          setLoadingProfile(false);
          setError("Профиль не найден. Обратитесь к администратору.");
          return;
        }

        // Устанавливаем начальников для режима редактирования (теперь с id)
        setCurrentManagers(data.managers || []);
        const managerIds = (data.managers || []).map(m => m.id);
        setSelectedManagers(managerIds);
        setOriginalManagers(managerIds);
        
        // Доступные начальники для выбора (без самого пользователя и его подчинённых) - с id
        setAvailableManagers(data.available_managers || []);

        // Заполняем ответы на первые 4 вопроса
        const loadedAnswers = [
          data.first_name || "",
          data.last_name || "",
          data.patronymic || "",
          data.city || "",
        ];

        // Парсим дополнительные ответы из additional_answers
        // Формат: {"4_Вопрос1": "ответ1", "5_Вопрос2": "ответ2", ...}
        const additionalAnswers = data.additional_answers || {};
        
        // Извлекаем вопросы из ключей additional_answers (версия пользователя)
        const userQuestions: string[] = [];
        const additionalAnswersArr: string[] = [];
        
        // Собираем вопросы из additional_answers пользователя
        Object.entries(additionalAnswers).forEach(([key, value]) => {
          // Пропускаем служебные поля
          if (key === "managers" || key === "schedule") return;
          // Извлекаем номер и вопрос из ключа "N_Вопрос"
          const match = key.match(/^(\d+)_(.+)$/);
          if (match) {
            const idx = parseInt(match[1], 10);
            // Индексы 0-3 — это FIRST4, дополнительные начинаются с 4
            if (idx >= 4) {
              const question = match[2];
              userQuestions[idx - 4] = question;
              additionalAnswersArr[idx - 4] = value;
            }
          }
        });
        
        setUserVersionQuestions(userQuestions.filter(Boolean));

        // Парсим текущие вопросы компании
        const currentQuestions = data.current_questions || {};
        // Формат: {"0": "Вопрос1", "1": "Вопрос2", ...}
        const currentQuestionsArr: string[] = [];
        Object.entries(currentQuestions).forEach(([key, value]) => {
          const idx = parseInt(key, 10);
          if (!isNaN(idx)) {
            currentQuestionsArr[idx] = value;
          }
        });
        setServerQuestions(currentQuestionsArr.filter(Boolean));

        // Категоризируем вопросы
        const categories = new Map<number, QuestionCategory>();
        const userQSet = new Set(userQuestions.filter(Boolean));
        const currentQSet = new Set(currentQuestionsArr.filter(Boolean));
        
        // FIRST4 всегда existing
        for (let i = 0; i < FIRST4.length; i++) {
          categories.set(i, "existing");
        }
        
        // Категоризируем дополнительные вопросы
        let idx = FIRST4.length;
        const allAdditionalQuestions = new Set([...userQSet, ...currentQSet]);
        allAdditionalQuestions.forEach(q => {
          if (userQSet.has(q) && currentQSet.has(q)) {
            categories.set(idx, "existing");
          } else if (userQSet.has(q) && !currentQSet.has(q)) {
            categories.set(idx, "deleted");
          } else {
            categories.set(idx, "added");
          }
          idx++;
        });
        setQuestionCategories(categories);

        // Собираем все ответы
        const allAnswers = [...loadedAnswers];
        const allQuestionsOrder = [...Array.from(allAdditionalQuestions)];
        allQuestionsOrder.forEach((q, i) => {
          const userIdx = userQuestions.indexOf(q);
          if (userIdx !== -1) {
            allAnswers.push(additionalAnswersArr[userIdx] || "");
          } else {
            allAnswers.push(""); // Новый вопрос — пустой ответ
          }
        });
        
        setAnswers(allAnswers);
        setOriginalAnswers([...allAnswers]);

        // Заполняем расписание
        if (data.schedule && data.schedule.length > 0) {
          const loadedSchedule: ScheduleDay[] = data.schedule.map((day) => ({
            dayOfWeek: day.day,
            intervals: day.intervals.map((interval) => ({
              start: interval.start,
              end: interval.end
            }))
          }));
          setSchedule(loadedSchedule);
          setOriginalSchedule([...loadedSchedule]);
        } else {
          setOriginalSchedule([...DEFAULT_SCHEDULE]);
        }

        // Проверяем pending changes
        if (data.has_pending_change) {
          setHasPendingChange(true);
          setPendingOldAnswers(data.pending_old_answers);
          setPendingNewAnswers(data.pending_new_answers);
          setPendingOldSchedule(data.pending_old_schedule);
          setPendingNewSchedule(data.pending_new_schedule);
          setPendingOldManagers(data.pending_old_managers);
          setPendingNewManagers(data.pending_new_managers);
        }

      } catch (e) {
        console.error("Ошибка загрузки профиля:", e);
        setError("Ошибка загрузки профиля");
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchProfile();
  }, [actorUsername, urlCompanyId]);

  // Загрузка вопросов и сотрудников для регистрации
  useEffect(() => {
    if (!actorUsername || !companyId || !isInitial) return;

    setLoading(true);
    fetch(
      `${APIURL}/get_questions?username=${encodeURIComponent(actorUsername)}&company_id=${companyId}`
    )
      .then(async r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<QuestionsResponse>;
      })
      .then(json => {
        setServerQuestions(Array.isArray(json.questions) ? json.questions : []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));

    // Fetch company workers for manager selection
    setManagersLoading(true);
    fetch(`${APIURL}/get_company_workers?company_id=${companyId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => setPossibleManagers(json.workers ?? []))
      .catch((e) => setManagersFetchError(e.message))
      .finally(() => setManagersLoading(false));
  }, [actorUsername, companyId, isInitial]);

  const handleAnswerChange = (index: number, value: string) => {
    // В режиме редактирования нельзя менять удалённые вопросы
    if (!isInitial && questionCategories.get(index) === "deleted") {
      return;
    }
    
    setAnswers(prev => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  // Convert to options for search (используем id как value)
  const managerOptions = useMemo(() => {
    // В режиме регистрации используем possibleManagers (все сотрудники компании)
    // В режиме редактирования используем availableManagers (без самого пользователя и подчинённых)
    // + добавляем текущих начальников (чтобы их можно было видеть и удалять)
    const sourceManagers = isInitial ? possibleManagers : availableManagers;
    
    // Создаём Map для избежания дублирования (по id)
    const managersMap = new Map<number, Manager>();
    
    // Добавляем доступных менеджеров
    sourceManagers.forEach(m => managersMap.set(m.id, m));
    
    // В режиме редактирования добавляем текущих начальников (если они не в availableManagers)
    if (!isInitial) {
      currentManagers.forEach(m => {
        if (!managersMap.has(m.id)) {
          managersMap.set(m.id, m);
        }
      });
    }
    
    return Array.from(managersMap.values()).map((s) => ({
      value: s.id,  // Используем id как value
      label: `${s.username} — ${s.fullname || ""}`,
      raw: s,
    }));
  }, [possibleManagers, availableManagers, currentManagers, isInitial]);

  // Search filter
  const filteredManagers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return managerOptions;
    return managerOptions.filter(
      (o) =>
        o.raw.username.toLowerCase().includes(q) ||
        (o.raw.fullname || "").toLowerCase().includes(q)
    );
  }, [searchTerm, managerOptions]);

  const handleSelectManager = (id: number) => {
    setSelectedManagers((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  // Проверка наличия изменений (для режима редактирования)
  const hasChanges = useMemo(() => {
    if (isInitial) return true;
    if (!originalAnswers || !originalSchedule) return false;

    // Сравниваем только существующие и добавленные вопросы (не удалённые)
    for (let i = 0; i < answers.length; i++) {
      const category = questionCategories.get(i);
      if (category === "deleted") continue; // Пропускаем удалённые
      
      const current = (answers[i] ?? "").trim();
      const original = (originalAnswers[i] ?? "").trim();
      if (current !== original) return true;
    }

    // Сравниваем расписание
    const currentScheduleJson = JSON.stringify(schedule);
    const originalScheduleJson = JSON.stringify(originalSchedule);
    if (currentScheduleJson !== originalScheduleJson) return true;

    // Сравниваем начальников (по ID)
    const sortedSelected = [...selectedManagers].sort((a, b) => a - b);
    const sortedOriginal = [...originalManagers].sort((a, b) => a - b);
    if (JSON.stringify(sortedSelected) !== JSON.stringify(sortedOriginal)) return true;

    return false;
  }, [isInitial, answers, schedule, originalAnswers, originalSchedule, questionCategories, selectedManagers, originalManagers]);

  const handleSubmit = async (e: React.FormEvent) => {
    if (submittingRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    submittingRef.current = true;
    
    e.preventDefault();
    e.stopPropagation();
    setSubmitting(true);

    setMgrError(null);
    setError(null);
    setScheduleError(null);
    
    if (!companyId) {
      setError("Не удалось определить компанию. Откройте форму заново.");
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    // Валидация начальников
    if (selectedManagers.length === 0) {
      setMgrError("Укажите хотя бы одного начальника");
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    if (schedule.length === 0) {
      setScheduleError("Добавьте хотя бы один рабочий день");
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    if (!validateSchedule(schedule, setScheduleError)) {
      submittingRef.current = false;
      setSubmitting(false);
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

    try {
      if (isInitial) {
        // === РЕГИСТРАЦИЯ ===
        const payload: Record<string, unknown> = {};
        payload["managers"] = selectedManagers;
        payload["schedule"] = JSON.stringify(schedulePayload);
        for (let i = 0; i < FIRST4.length; i++) {
          payload[String(i) + "_" + FIRST4[i]] = normalizedAnswers[i];
        }
        for (let i = 0; i < serverQuestions.length; i++) {
          payload[String(i + FIRST4.length) + "_" + serverQuestions[i]] = normalizedAnswers[i + FIRST4.length];
        }

        const res = await fetch(
          `${APIURL}/submit_emp_answers?actor_username=${encodeURIComponent(actorUsername)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ company_id: companyId, answers: payload }),
          });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const data = await res.json();
        if (data.status === "ok") {
          (window as any).Telegram?.WebApp?.close();
          return;
        }
        setMgrError("Произошла ошибка при сохранении данных.");

      } else {
        // === РЕДАКТИРОВАНИЕ ===
        // Формируем old_answers и new_answers
        const oldAnswers: Record<string, string> = {};
        const newAnswers: Record<string, string> = {};
        
        // Первые 4 вопроса
        for (let i = 0; i < FIRST4.length; i++) {
          const key = `${i}_${FIRST4[i]}`;
          oldAnswers[key] = originalAnswers?.[i] ?? "";
          newAnswers[key] = normalizedAnswers[i];
        }
        
        // Дополнительные вопросы
        const additionalQuestions = allQuestions.slice(FIRST4.length);
        additionalQuestions.forEach((q, i) => {
          const globalIdx = i + FIRST4.length;
          const category = questionCategories.get(globalIdx);
          const key = `${globalIdx}_${q}`;
          
          if (category === "deleted") {
            // Удалённые вопросы - только в oldAnswers (для показа "Было")
            oldAnswers[key] = originalAnswers?.[globalIdx] ?? "";
          } else if (category === "added") {
            // Добавленные вопросы - только в newAnswers
            newAnswers[key] = normalizedAnswers[globalIdx];
          } else {
            // Существующие вопросы - в оба
            oldAnswers[key] = originalAnswers?.[globalIdx] ?? "";
            newAnswers[key] = normalizedAnswers[globalIdx];
          }
        });

        // Формируем old_schedule и new_schedule
        const oldSchedulePayload = originalSchedule?.map((day) => ({
          day: day.dayOfWeek,
          intervals: day.intervals.map((interval) => ({
            start: interval.start,
            end: interval.end
          }))
        }));

        // Формируем списки ID начальников (для уведомлений и для обновления связей)
        // Все ID начальники для уведомлений = старые + новые (уникальные)
        const allManagerIdsForNotifications = [...new Set([...originalManagers, ...selectedManagers])];

        const payload = {
          company_id: companyId,
          actor_username: actorUsername,
          user_tg_id: userTgId,
          manager_ids: allManagerIdsForNotifications,  // ID всех начальников для уведомлений
          old_manager_ids: originalManagers,  // ID старых начальников
          new_manager_ids: selectedManagers,  // ID новых начальников
          old_answers: oldAnswers,
          new_answers: newAnswers,
          old_schedule: JSON.stringify(oldSchedulePayload || []),
          new_schedule: JSON.stringify(schedulePayload),
        };

        const res = await fetch(`${APIURL}/update_worker_profile`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }

        const data = await res.json();
        if (data.status === "ok") {
          (window as any).Telegram?.WebApp?.close();
          return;
        }
        setError(data.message || "Произошла ошибка при сохранении данных.");
      }
    } catch (e: any) {
      setError(e.message || "Ошибка соединения");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // Получить CSS класс для вопроса (для режима редактирования)
  const getQuestionClass = (index: number): string => {
    if (isInitial) return "";
    const category = questionCategories.get(index);
    if (category === "deleted") return "question-deleted";
    if (category === "added") return "question-added";
    return "";
  };

  // Экран загрузки или ошибки пользователя Telegram
  const isLoadingState = tgLoading || (loadingProfile && !urlCompanyId);
  if (isLoadingState || tgError || !actorUsername) {
    return (
      <UserLoadingScreen
        title="Мои данные"
        isLoading={isLoadingState}
        loadingMessage={tgLoading ? "Загрузка данных пользователя..." : "Загрузка данных..."}
        error={tgError}
      />
    );
  }

  // Экран pending change
  if (hasPendingChange && pendingOldAnswers && pendingNewAnswers) {
    // Собираем все уникальные ключи вопросов
    const allKeys = new Set([
      ...Object.keys(pendingOldAnswers),
      ...Object.keys(pendingNewAnswers)
    ]);
    
    // Сортируем ключи по номеру вопроса
    const sortedKeys = Array.from(allKeys)
      .filter(key => key !== "managers" && key !== "schedule")
      .sort((a, b) => {
        const numA = parseInt(a.match(/^(\d+)_/)?.[1] ?? "999", 10);
        const numB = parseInt(b.match(/^(\d+)_/)?.[1] ?? "999", 10);
        return numA - numB;
      });

    // Функция форматирования расписания для отображения
    const formatScheduleDisplay = (sched: { day: number; intervals: { start: string; end: string }[] }[] | null) => {
      if (!sched || sched.length === 0) return "Не указано";
      const dayNames = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
      return sched
        .sort((a, b) => a.day - b.day)
        .map(day => {
          const intervals = day.intervals.map(i => `${i.start}–${i.end}`).join(", ");
          return `${dayNames[day.day]}: ${intervals}`;
        })
        .join("\n");
    };

    // Проверяем, изменилось ли расписание
    const scheduleChanged = JSON.stringify(pendingOldSchedule) !== JSON.stringify(pendingNewSchedule);

    // Проверяем, изменились ли начальники (по ID)
    const oldMgrs = pendingOldManagers || [];
    const newMgrs = pendingNewManagers || [];
    const oldMgrIds = oldMgrs.map(m => m.id).sort((a, b) => a - b);
    const newMgrIds = newMgrs.map(m => m.id).sort((a, b) => a - b);
    const managersChanged = JSON.stringify(oldMgrIds) !== JSON.stringify(newMgrIds);
    
    // Собираем всех уникальных начальников (по id)
    const allPendingManagersMap = new Map<number, Manager>();
    oldMgrs.forEach(m => allPendingManagersMap.set(m.id, m));
    newMgrs.forEach(m => allPendingManagersMap.set(m.id, m));
    const allPendingManagers = Array.from(allPendingManagersMap.values());
    
    const getManagerStatus = (managerId: number): "unchanged" | "added" | "deleted" => {
      const inOld = oldMgrs.some(m => m.id === managerId);
      const inNew = newMgrs.some(m => m.id === managerId);
      if (inOld && inNew) return "unchanged";
      if (!inOld && inNew) return "added";
      return "deleted";
    };

    return (
      <div className="form-page">
        <div className="form-container">
          <h2>Мои данные</h2>
          
          <div className="pending-change-notice">
            <p style={{ color: "#856404", background: "#fff3cd", padding: "12px", borderRadius: "8px", marginBottom: "16px" }}>
              ⏳ Смена данных подтверждается начальником. Ожидайте уведомления.
            </p>
          </div>

          {/* Начальники с отображением изменений */}
          <div className="question-block">
            <label>
              Ваши начальники
              {managersChanged && <span className="changed-badge"> (изменено)</span>}
            </label>
            <div className="managers-readonly">
              {allPendingManagers.length > 0 ? (
                <ul className="managers-list">
                  {allPendingManagers.map((manager) => {
                    const status = getManagerStatus(manager.id);
                    const statusClass = status === "added" ? "manager-pending-added" : 
                                        status === "deleted" ? "manager-pending-deleted" : "";
                    
                    return (
                      <li key={manager.id} className={statusClass}>
                        {manager.username} {manager.fullname ? `— ${manager.fullname}` : ""}
                        {status === "added" && <span className="added-badge"> (добавлен)</span>}
                        {status === "deleted" && <span className="deleted-badge"> (удалён)</span>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p style={{ color: "#888" }}>Начальники не указаны</p>
              )}
            </div>
          </div>

          {/* Вопросы с умным отображением */}
          {sortedKeys.map((key) => {
            const match = key.match(/^(\d+)_(.+)$/);
            if (!match) return null;
            
            const label = match[2];
            const oldValue = pendingOldAnswers[key];
            const newValue = pendingNewAnswers[key];
            
            const existsInOld = key in pendingOldAnswers;
            const existsInNew = key in pendingNewAnswers;
            const isChanged = oldValue !== newValue;
            
            // Определяем тип отображения
            let displayType: "unchanged" | "changed" | "added" | "deleted";
            
            if (existsInOld && !existsInNew) {
              displayType = "deleted";
            } else if (!existsInOld && existsInNew) {
              displayType = "added";
            } else if (isChanged) {
              displayType = "changed";
            } else {
              displayType = "unchanged";
            }

            return (
              <div 
                key={key} 
                className={`question-block pending-question ${
                  displayType === "deleted" ? "question-deleted" : 
                  displayType === "added" ? "question-added" : ""
                }`}
              >
                <label>
                  {label}
                  {displayType === "deleted" && <span className="deleted-badge"> (вопрос удалён)</span>}
                  {displayType === "added" && <span className="added-badge"> (новый вопрос)</span>}
                </label>
                
                {displayType === "unchanged" && (
                  <input type="text" value={oldValue ?? ""} readOnly disabled className="readonly-input" />
                )}
                
                {displayType === "changed" && (
                  <div className="changed-fields">
                    <div className="field-row">
                      <span className="field-label was-label">Было:</span>
                      <input type="text" value={oldValue ?? ""} readOnly disabled className="readonly-input was-input" />
                    </div>
                    <div className="field-row">
                      <span className="field-label became-label">Стало:</span>
                      <input type="text" value={newValue ?? ""} readOnly disabled className="readonly-input became-input" />
                    </div>
                  </div>
                )}
                
                {displayType === "deleted" && (
                  <input type="text" value={oldValue ?? ""} readOnly disabled className="readonly-input" />
                )}
                
                {displayType === "added" && (
                  <input type="text" value={newValue ?? ""} readOnly disabled className="readonly-input" />
                )}
              </div>
            );
          })}

          {/* Расписание */}
          <div className="question-block schedule-pending">
            <label>График работы</label>
            {scheduleChanged ? (
              <div className="changed-fields schedule-changed">
                <div className="schedule-row">
                  <span className="field-label was-label">Было:</span>
                  <pre className="schedule-display was-schedule">{formatScheduleDisplay(pendingOldSchedule)}</pre>
                </div>
                <div className="schedule-row">
                  <span className="field-label became-label">Стало:</span>
                  <pre className="schedule-display became-schedule">{formatScheduleDisplay(pendingNewSchedule)}</pre>
                </div>
              </div>
            ) : (
              <pre className="schedule-display">{formatScheduleDisplay(pendingOldSchedule || pendingNewSchedule)}</pre>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="form-page">
      <div className="form-container">
        <h2>{isInitial ? "Анкета для сотрудника" : "Мои данные"}</h2>

        {loading && <div>Загрузка вопросов...</div>}
        {error && <div style={{ color: "crimson" }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          {/* Блок начальников */}
          <div className="question-block">
            <label>
              {isInitial 
                ? "Выберите своих непосредственных начальников" 
                : "Ваши начальники"
              }
            </label>

            {/* Выбор начальников (и в регистрации, и в редактировании) */}
            <>
              <input
                type="text"
                placeholder="Начните вводить ФИО или @ник..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />

              {managersLoading && <div>Загрузка списка сотрудников...</div>}
              {managersFetchError && <div style={{ color: "crimson" }}>Ошибка: {managersFetchError}</div>}

              {searchTerm && (
                <div className="custom-select">
                  {filteredManagers.length > 0 ? (
                    filteredManagers.map((o) => (
                      <div
                        key={o.value}
                        className={`option ${selectedManagers.includes(o.value) ? "selected" : ""}`}
                        onClick={() => handleSelectManager(o.value)}
                      >
                        {o.label}
                      </div>
                    ))
                  ) : (
                    <p style={{ marginTop: 8, color: "#888" }}>Совпадений нет</p>
                  )}
                </div>
              )}

              {selectedManagers.length > 0 && (
                <div className="selected-list">
                  <h4>{isInitial ? "Выбранные начальники:" : "Ваши начальники:"}</h4>
                  <ul>
                    {selectedManagers.map((managerId) => {
                      // Находим менеджера по id для отображения
                      const manager = managerOptions.find(o => o.value === managerId);
                      // В режиме редактирования определяем статус начальника
                      const isAdded = !isInitial && !originalManagers.includes(managerId);
                      const managerClass = isAdded ? "manager-added" : "";
                      
                      return (
                        <li key={managerId} className={managerClass}>
                          {manager?.label || `ID: ${managerId}`}{" "}
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedManagers((prev) => prev.filter((x) => x !== managerId))
                            }
                          >
                            ✖
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>

            {mgrError && (
              <div style={{ color: "crimson", marginTop: 6 }}>{mgrError}</div>
            )}
          </div>

          {/* Вопросы анкеты */}
          {allQuestions.map((q, i) => {
            const category = questionCategories.get(i);
            const isDeleted = category === "deleted";
            const questionClass = getQuestionClass(i);
            
            return (
              <div key={i} className={`question-block ${questionClass}`}>
                <label>
                  {q}
                  {isDeleted && <span className="deleted-badge"> (вопрос удалён)</span>}
                  {category === "added" && <span className="added-badge"> (новый вопрос)</span>}
                </label>
                <input
                  type="text"
                  value={answers[i] ?? ""}
                  onChange={(e) => handleAnswerChange(i, e.target.value)}
                  required={q !== OPTIONAL_LABEL && !isDeleted}
                  disabled={isDeleted}
                  readOnly={isDeleted}
                  className={isDeleted ? "readonly-input" : ""}
                />
              </div>
            );
          })}

          {/* Schedule section */}
          <ScheduleInput
            schedule={schedule}
            setSchedule={setSchedule}
            scheduleError={scheduleError}
          />

          <button 
            type="submit" 
            className="submit-btn" 
            disabled={submitting || (!isInitial && !hasChanges)}
            style={submitting ? { pointerEvents: 'none' } : undefined}
          >
            {submitting 
              ? "Отправка..." 
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
