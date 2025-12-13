import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import "../styles/formPage.css";
import {
  TaskDraft,
  getTaskDraftFromCache,
  setTaskDraftToCache,
  clearTaskDraftFromCache,
  addTaskToMonthCache,
  addTaskToFreeWindowsCache,
  Task,
  Meeting,
  ScheduleDay,
  ScheduleInterval,
  getSubordinatesFromCache,
  FreeWindowsData,
  setFreeWindowsToCache,
  getFreeWindowsCacheKey,
  setActiveFreeWindowsKey,
  getFreeWindowsFromCache,
  hasFreeWindowsCache,
} from "../cache";

const API_URL = import.meta.env.VITE_API_URL as string;

// --- Типы для ответа сервера при конфликте ---
interface TaskConflictResponse {
  ok: false;
  reasons: string[];
  windows: ScheduleDay[];
  meetings: Record<number, Meeting[]>;
  tasks: Record<number, Task[]>;
}

// --- Компонент диалога конфликта для заданий ---
interface TaskConflictDialogProps {
  visible: boolean;
  reasons: string[];
  hasFreeWindows: boolean;
  onForceCreate: () => void;
  onShowWindows: () => void;
  onClose: () => void;
}

const TaskConflictDialog: React.FC<TaskConflictDialogProps> = ({
  visible,
  reasons,
  hasFreeWindows,
  onForceCreate,
  onShowWindows,
  onClose,
}) => {
  if (!visible) return null;

  const reasonMessages: string[] = [];
  if (reasons.includes("schedule")) {
    reasonMessages.push("Задание не укладывается в рабочее расписание исполнителя");
  }
  if (reasons.includes("conflict")) {
    reasonMessages.push("Задание пересекается с другими событиями (встречами/заданиями)");
  }

  const questionText = hasFreeWindows
    ? "Хотите ли вы все равно создать задание, или выбрать другое время?"
    : "Хотите ли вы все равно создать задание? В ближайшее время для задания с такой продолжительностью у исполнителя нет свободных окон.";

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(0, 0, 0, 0.5)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "400px",
          padding: "24px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ marginBottom: "16px" }}>
          {reasonMessages.map((msg, idx) => (
            <p key={idx} style={{ margin: "0 0 8px 0", color: "#333", fontSize: "15px" }}>
              {msg}
            </p>
          ))}
        </div>
        
        <p style={{ margin: "0 0 20px 0", color: "#666", fontSize: "14px" }}>
          {questionText}
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button
            onClick={onForceCreate}
            style={{
              padding: "14px",
              background: "#007AFF",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            Создать
          </button>
          
          <button
            onClick={hasFreeWindows ? onShowWindows : onClose}
            style={{
              padding: "14px",
              background: hasFreeWindows ? "#34C759" : "#E5E5EA",
              color: hasFreeWindows ? "#fff" : "#333",
              border: "none",
              borderRadius: "10px",
              fontSize: "16px",
              fontWeight: "600",
              cursor: "pointer",
            }}
          >
            {hasFreeWindows ? "Свободные окна" : "Нет"}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Хелпер для проверки наличия свободных окон нужной длительности ---
const hasFreeWindowsForDuration = (
  windows: ScheduleDay[],
  meetings: Record<number, Meeting[]>,
  tasks: Record<number, Task[]>,
  durationMinutes: number
): boolean => {
  for (const daySchedule of windows) {
    const dayFreeWindows = computeFreeWindowsForDay(daySchedule, meetings, tasks, durationMinutes);
    if (dayFreeWindows.length > 0) {
      return true;
    }
  }
  return false;
};

// --- Хелпер для вычисления свободных окон на конкретный день ---
const computeFreeWindowsForDay = (
  daySchedule: ScheduleDay,
  allMeetings: Record<number, Meeting[]>,
  allTasks: Record<number, Task[]>,
  minDuration: number
): ScheduleInterval[] => {
  if (!daySchedule.intervals || daySchedule.intervals.length === 0) {
    return [];
  }

  const dayOfWeek = daySchedule.day;
  const busySlots: { start: number; end: number }[] = [];

  // Собираем все встречи на этот день
  for (const meetings of Object.values(allMeetings)) {
    for (const m of meetings) {
      if (!m.time) continue;
      const meetingDate = new Date(m.time);
      const meetingDayOfWeek = meetingDate.getDay() === 0 ? 6 : meetingDate.getDay() - 1;
      
      if (meetingDayOfWeek === dayOfWeek) {
        const startMinutes = meetingDate.getHours() * 60 + meetingDate.getMinutes();
        const duration = m.duration || 40;
        busySlots.push({ start: startMinutes, end: startMinutes + duration });
      }
    }
  }

  // Собираем все задания на этот день
  for (const tasksList of Object.values(allTasks)) {
    for (const t of tasksList) {
      if (!t.time) continue;
      const taskDate = new Date(t.time);
      const taskDayOfWeek = taskDate.getDay() === 0 ? 6 : taskDate.getDay() - 1;
      
      if (taskDayOfWeek === dayOfWeek) {
        const startMinutes = taskDate.getHours() * 60 + taskDate.getMinutes();
        busySlots.push({ start: startMinutes, end: startMinutes + t.duration });
      }
    }
  }

  // Сортируем занятые слоты
  busySlots.sort((a, b) => a.start - b.start);

  // Вычисляем свободные промежутки
  const freeWindows: ScheduleInterval[] = [];
  
  for (const interval of daySchedule.intervals) {
    const [startH, startM] = interval.start.split(":").map(Number);
    const [endH, endM] = interval.end.split(":").map(Number);
    const intervalStart = startH * 60 + startM;
    const intervalEnd = endH * 60 + endM;

    let currentStart = intervalStart;
    
    for (const busy of busySlots) {
      if (busy.end <= currentStart || busy.start >= intervalEnd) {
        continue;
      }
      
      if (busy.start > currentStart) {
        const windowDuration = busy.start - currentStart;
        if (windowDuration >= minDuration) {
          freeWindows.push({
            start: `${Math.floor(currentStart / 60).toString().padStart(2, "0")}:${(currentStart % 60).toString().padStart(2, "0")}`,
            end: `${Math.floor(busy.start / 60).toString().padStart(2, "0")}:${(busy.start % 60).toString().padStart(2, "0")}`,
          });
        }
      }
      currentStart = Math.max(currentStart, busy.end);
    }

    if (currentStart < intervalEnd) {
      const windowDuration = intervalEnd - currentStart;
      if (windowDuration >= minDuration) {
        freeWindows.push({
          start: `${Math.floor(currentStart / 60).toString().padStart(2, "0")}:${(currentStart % 60).toString().padStart(2, "0")}`,
          end: `${Math.floor(intervalEnd / 60).toString().padStart(2, "0")}:${(intervalEnd % 60).toString().padStart(2, "0")}`,
        });
      }
    }
  }

  return freeWindows;
};

// --- Хелпер для парсинга URL параметров ---
const parseHashParams = (): Record<string, string> => {
  const hash = window.location.hash;
  const queryStart = hash.indexOf("?");
  if (queryStart === -1) return {};
  
  const queryString = hash.slice(queryStart + 1);
  const params: Record<string, string> = {};
  for (const pair of queryString.split("&")) {
    const [key, value] = pair.split("=");
    if (key) {
      // URLSearchParams кодирует пробелы как "+", поэтому заменяем их перед декодированием
      const decodedValue = decodeURIComponent((value || "").replace(/\+/g, " "));
      params[decodeURIComponent(key)] = decodedValue;
    }
  }
  return params;
};

export const FormTaskPage: React.FC = () => {
  // Параметры из URL (передаются при переходе из календаря)
  const urlParams = useMemo(() => parseHashParams(), []);
  
  const subordinateId = useMemo(() => parseInt(urlParams.subordinateId || "0"), [urlParams]);
  const subordinateUsername = useMemo(() => urlParams.subordinateUsername || "", [urlParams]);
  const subordinateFullname = useMemo(() => urlParams.subordinateFullname || "", [urlParams]);
  const initialDate = useMemo(() => urlParams.date || "", [urlParams]);
  const initialHour = useMemo(() => parseInt(urlParams.hour || "10"), [urlParams]);
  const selectedTimeFromWindows = useMemo(() => urlParams.selectedTime || "", [urlParams]);
  const restoreFromWindows = useMemo(() => urlParams.restoreFromWindows === "1", [urlParams]);
  
  // Состояние формы
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("40");
  const [description, setDescription] = useState("");
  
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Состояния для диалога конфликта
  const [conflictDialogVisible, setConflictDialogVisible] = useState(false);
  const [conflictReasons, setConflictReasons] = useState<string[]>([]);
  const [conflictWindows, setConflictWindows] = useState<ScheduleDay[]>([]);
  const [conflictMeetings, setConflictMeetings] = useState<Record<number, Meeting[]>>({});
  const [conflictTasks, setConflictTasks] = useState<Record<number, Task[]>>({});
  const [conflictHasFreeWindows, setConflictHasFreeWindows] = useState(false);

  // Состояния для режима свободных окон
  const [inFreeWindowsMode, setInFreeWindowsMode] = useState(false);
  const [selectedWindowDate, setSelectedWindowDate] = useState<string | null>(null);

  // Получаем данные пользователя из Telegram WebApp
  const tg = useMemo(() => (window as any).Telegram?.WebApp, []);
  const username = useMemo(() => `@${tg?.initDataUnsafe?.user?.username}`, [tg]);
  const userTgId = useMemo(() => tg?.initDataUnsafe?.user?.id, [tg]);

  // Получаем managerId из кэша (для создания задания)
  const managerId = useMemo(() => {
    // Используем кэш из cache.ts (хранится в памяти модуля)
    const cachedData = getSubordinatesFromCache(username);
    if (cachedData) {
      return cachedData.managerId;
    }
    return null;
  }, [username]);

  // Загружаем черновик из кэша при инициализации
  useEffect(() => {
    // Приоритет: selectedTime из окон > restoreFromWindows > date+hour из календаря > черновик
    
    // Если вернулись из режима свободных окон с выбранным временем
    if (selectedTimeFromWindows) {
      setTime(selectedTimeFromWindows);
      setInFreeWindowsMode(true);
      // Загружаем остальные поля из freeWindowsCache
      if (subordinateId) {
        const cachedData = getFreeWindowsFromCache([subordinateId]);
        if (cachedData?.taskDraft) {
          setDuration(String(cachedData.taskDraft.duration));
          setDescription(cachedData.taskDraft.description);
        } else {
          const draft = getTaskDraftFromCache(subordinateId);
          if (draft) {
            setDuration(draft.duration);
            setDescription(draft.description);
          }
        }
      }
      return;
    }
    
    // Если вернулись из режима свободных окон по кнопке "Задание" (без выбора окна)
    if (restoreFromWindows && subordinateId) {
      const cachedData = getFreeWindowsFromCache([subordinateId]);
      if (cachedData?.taskDraft) {
        setTime(cachedData.taskDraft.time || "");
        setDuration(String(cachedData.taskDraft.duration));
        setDescription(cachedData.taskDraft.description);
        setInFreeWindowsMode(true);
        return;
      }
    }
    
    // Проверяем параметры времени из URL (клик по времени в календаре)
    const hasUrlTime = initialDate && !isNaN(initialHour);
    const urlDateTime = hasUrlTime 
      ? `${initialDate}T${initialHour.toString().padStart(2, "0")}:00`
      : "";
    
    if (subordinateId) {
      const draft = getTaskDraftFromCache(subordinateId);
      if (draft) {
        // Если есть параметры из URL, используем их для time, иначе берём из черновика
        setTime(hasUrlTime ? urlDateTime : draft.time);
        setDuration(draft.duration);
        setDescription(draft.description);
        return;
      }
    }
    
    // Если черновика нет, устанавливаем начальные значения из URL
    if (hasUrlTime) {
      setTime(urlDateTime);
    }
  }, [subordinateId, initialDate, initialHour, selectedTimeFromWindows, restoreFromWindows]);

  // Сохраняем черновик при изменении формы
  useEffect(() => {
    if (subordinateId && !success) {
      setTaskDraftToCache(subordinateId, {
        subordinateId,
        subordinateUsername,
        subordinateFullname,
        time,
        duration,
        description,
      });
    }
  }, [subordinateId, subordinateUsername, subordinateFullname, time, duration, description, success]);

  // Проверка: время не раньше текущего момента
  const isTimeInPast = useMemo(() => {
    if (!time) return false;
    const selectedTime = new Date(time);
    const now = new Date();
    return selectedTime < now;
  }, [time]);

  // Проверяем валидность формы
  const isValid = useMemo(() => {
    return time && parseInt(duration) > 0 && description.trim().length > 0 && !isTimeInPast;
  }, [time, duration, description, isTimeInPast]);

  // Определяем, есть ли кэш свободных окон для этого исполнителя
  useEffect(() => {
    if (subordinateId && hasFreeWindowsCache([subordinateId])) {
      setInFreeWindowsMode(true);
    }
  }, [subordinateId]);

  // Обновляем дату окна при изменении времени (в режиме окон)
  useEffect(() => {
    if (inFreeWindowsMode && time) {
      const parsedDate = new Date(time);
      if (!isNaN(parsedDate.getTime())) {
        const dateStr = parsedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        setSelectedWindowDate(dateStr);
      }
    }
  }, [time, inFreeWindowsMode]);

  // Хелпер для преобразования минут в строку времени
  const minutesToTime = (minutes: number): string => {
    return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
  };

  // Проверка попадания в свободное окно (в режиме окон)
  const windowValidation = useMemo(() => {
    type ValidationResult = {
      valid: boolean;
      message: string;
      fittingWindow: { start: string; end: string } | null;
    };
    
    const emptyResult: ValidationResult = { valid: true, message: "", fittingWindow: null };
    
    if (!inFreeWindowsMode || !subordinateId) {
      return emptyResult;
    }
    
    // Получаем кэш окон для исполнителя
    const cachedData = getFreeWindowsFromCache([subordinateId]);
    if (!cachedData) return emptyResult;
    
    const durationNum = duration ? parseInt(duration, 10) : 0;
    if (!time || !durationNum) return emptyResult;
    
    // Парсим время задания
    const taskDate = new Date(time);
    if (isNaN(taskDate.getTime())) return emptyResult;
    
    const taskStartMinutes = taskDate.getHours() * 60 + taskDate.getMinutes();
    const taskEndMinutes = taskStartMinutes + durationNum;
    
    // Получаем день недели (API: 0=Пн, 6=Вс; JS: 0=Вс, 1=Пн)
    const jsDay = taskDate.getDay();
    const apiDay = jsDay === 0 ? 6 : jsDay - 1;
    
    // Находим расписание для этого дня
    const daySchedule = cachedData.windows.find(s => s.day === apiDay);
    if (!daySchedule || daySchedule.intervals.length === 0) {
      return { valid: false, message: "Нет рабочего расписания на выбранный день", fittingWindow: null };
    }
    
    // Получаем встречи и задания на этот день
    const dateKey = `${taskDate.getFullYear()}-${String(taskDate.getMonth() + 1).padStart(2, "0")}-${String(taskDate.getDate()).padStart(2, "0")}`;
    const busySlots: { start: number; end: number }[] = [];
    
    // Добавляем встречи
    for (const meetings of Object.values(cachedData.meetings)) {
      for (const m of meetings) {
        if (!m.time) continue;
        const mDate = new Date(m.time);
        const mDateKey = `${mDate.getFullYear()}-${String(mDate.getMonth() + 1).padStart(2, "0")}-${String(mDate.getDate()).padStart(2, "0")}`;
        if (mDateKey === dateKey) {
          const mStart = mDate.getHours() * 60 + mDate.getMinutes();
          busySlots.push({ start: mStart, end: mStart + (m.duration || 40) });
        }
      }
    }
    
    // Добавляем задания
    if (cachedData.tasks) {
      for (const tasksList of Object.values(cachedData.tasks)) {
        for (const t of tasksList) {
          if (!t.time) continue;
          const tDate = new Date(t.time);
          const tDateKey = `${tDate.getFullYear()}-${String(tDate.getMonth() + 1).padStart(2, "0")}-${String(tDate.getDate()).padStart(2, "0")}`;
          if (tDateKey === dateKey) {
            const tStart = tDate.getHours() * 60 + tDate.getMinutes();
            busySlots.push({ start: tStart, end: tStart + t.duration });
          }
        }
      }
    }
    
    busySlots.sort((a, b) => a.start - b.start);
    
    // Вычисляем свободные окна
    let freeSlots: { start: number; end: number }[] = [];
    for (const interval of daySchedule.intervals) {
      const [startH, startM] = interval.start.split(":").map(Number);
      const [endH, endM] = interval.end.split(":").map(Number);
      const intervalStart = startH * 60 + startM;
      const intervalEnd = endH * 60 + endM;
      
      let currentStart = intervalStart;
      for (const busy of busySlots) {
        if (busy.end <= currentStart || busy.start >= intervalEnd) continue;
        if (busy.start > currentStart) {
          freeSlots.push({ start: currentStart, end: busy.start });
        }
        currentStart = Math.max(currentStart, busy.end);
      }
      if (currentStart < intervalEnd) {
        freeSlots.push({ start: currentStart, end: intervalEnd });
      }
    }
    
    // Фильтрация по текущему времени
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDay = new Date(taskDate.getFullYear(), taskDate.getMonth(), taskDate.getDate());
    
    if (targetDay < today) {
      return { valid: false, message: "Дата и время задания должны быть не ранее текущего момента", fittingWindow: null };
    }
    
    const currentMinutes = now.getHours() * 60 + now.getMinutes() + 1;
    if (targetDay.getTime() === today.getTime()) {
      if (taskStartMinutes < currentMinutes) {
        return { valid: false, message: "Дата и время задания должны быть не ранее текущего момента", fittingWindow: null };
      }
      
      freeSlots = freeSlots
        .filter(slot => slot.end > currentMinutes)
        .map(slot => slot.start >= currentMinutes ? slot : { ...slot, start: currentMinutes })
        .filter(slot => (slot.end - slot.start) >= durationNum);
    }
    
    // Проверяем, попадает ли задание в свободное окно
    const fittingSlot = freeSlots.find(slot => 
      taskStartMinutes >= slot.start && taskEndMinutes <= slot.end
    );
    
    if (!fittingSlot) {
      return { valid: false, message: "Выбранное время не попадает в свободное окно", fittingWindow: null };
    }
    
    const fittingWindow = {
      start: minutesToTime(fittingSlot.start),
      end: minutesToTime(fittingSlot.end)
    };
    
    return { valid: true, message: "", fittingWindow };
  }, [inFreeWindowsMode, subordinateId, time, duration]);

  // Обработчик создания задания
  const handleSubmit = useCallback(async (forceCreate = false) => {
    if (!isValid || submittingRef.current) return;
    
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    
    try {
      const payload: Record<string, unknown> = {
        assignee_id: subordinateId,
        assigner_id: managerId,
        assigner_username: username,
        description: description.trim(),
        time: time,
        duration: parseInt(duration),
      };
      
      // Добавляем force только если явно запрошено
      if (forceCreate) {
        payload.force = true;
      }
      
      const resp = await fetch(`${API_URL}/create_task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || `HTTP ${resp.status}`);
      }
      
      const data = await resp.json();
      
      // Проверяем, не вернул ли сервер ошибку валидации
      if (data.ok === false && Array.isArray(data.reasons)) {
        const conflictRes = data as TaskConflictResponse;
        const durationNum = parseInt(duration);
        const hasFreeWindows = hasFreeWindowsForDuration(
          conflictRes.windows || [],
          conflictRes.meetings || {},
          conflictRes.tasks || {},
          durationNum
        );
        
        // Сразу обновляем кэш свободных окон актуальными данными от сервера,
        // чтобы они учитывались независимо от действия пользователя
        const freeWindowsData: FreeWindowsData = {
          windows: conflictRes.windows || [],
          meetings: conflictRes.meetings || {},
          tasks: conflictRes.tasks || {},
          meetingDraft: {
            topic: "",
            memberIds: [subordinateId],
            duration: durationNum,
            link: "",
            creatorId: managerId || 0,
            creatorUsername: username,
          },
          taskDraft: {
            subordinateId,
            subordinateUsername,
            subordinateFullname,
            time,
            duration: durationNum,
            description: description.trim(),
            managerId: managerId || 0,
            managerUsername: username,
          },
          type: "task",
        };
        setFreeWindowsToCache([subordinateId], freeWindowsData);
        
        // Сохраняем данные конфликта для диалога
        setConflictReasons(conflictRes.reasons);
        setConflictWindows(conflictRes.windows || []);
        setConflictMeetings(conflictRes.meetings || {});
        setConflictTasks(conflictRes.tasks || {});
        setConflictHasFreeWindows(hasFreeWindows);
        setConflictDialogVisible(true);
        submittingRef.current = false;
        setSubmitting(false);
        return;
      }
      
      if (!data.ok) {
        throw new Error(data.error || "Ошибка создания задания");
      }
      
      // Успешное создание
      setSuccess(true);
      
      // Добавляем задание в кэш месяца
      const newTask: Task = {
        id: data.id,
        assignee_id: subordinateId,
        assigner_id: managerId || 0,
        assigner_username: username,
        assigner_fullname: "", // Будет заполнено при следующей загрузке с сервера
        assignee_username: subordinateUsername,
        assignee_fullname: subordinateFullname,
        description: description.trim(),
        time: time,
        duration: parseInt(duration),
        created_at: new Date().toISOString(),
      };
      addTaskToMonthCache(subordinateId, newTask);
      
      // Добавляем задание в кэш свободных окон, чтобы оно учитывалось при расчёте
      addTaskToFreeWindowsCache(subordinateId, newTask);
      
      // Очищаем черновик после успешного создания
      clearTaskDraftFromCache(subordinateId);
      
      // Возвращаемся в календарь через 1.5 секунды
      setTimeout(() => {
        window.location.hash = "#/calendar";
      }, 1500);
      
    } catch (e: any) {
      setError(e?.message || "Ошибка создания задания");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [isValid, subordinateId, managerId, username, description, time, duration, subordinateUsername, subordinateFullname]);

  // Возврат в календарь
  const handleBack = useCallback(() => {
    if (inFreeWindowsMode && subordinateId && hasFreeWindowsCache([subordinateId])) {
      // Обновляем данные в кэше перед переходом
      const durationNum = parseInt(duration) || 40;
      const cachedData = getFreeWindowsFromCache([subordinateId]);
      if (cachedData) {
        setFreeWindowsToCache([subordinateId], {
          ...cachedData,
          taskDraft: {
            subordinateId,
            subordinateUsername,
            subordinateFullname,
            time,
            duration: durationNum,
            description: description.trim(),
            managerId: managerId || 0,
            managerUsername: username,
          },
        });
      }
      const cacheKey = getFreeWindowsCacheKey([subordinateId]);
      setActiveFreeWindowsKey(cacheKey);
      window.location.hash = `#/calendar?mode=freeWindows&key=${encodeURIComponent(cacheKey)}&duration=${durationNum}`;
    } else {
      window.location.hash = "#/calendar";
    }
  }, [inFreeWindowsMode, subordinateId, subordinateUsername, subordinateFullname, time, duration, description, managerId, username]);

  // --- Обработчики диалога конфликта ---
  const handleCloseConflictDialog = useCallback(() => {
    setConflictDialogVisible(false);
  }, []);

  const handleForceCreate = useCallback(() => {
    setConflictDialogVisible(false);
    handleSubmit(true);
  }, [handleSubmit]);

  const handleShowFreeWindows = useCallback(() => {
    setConflictDialogVisible(false);
    
    const durationNum = parseInt(duration);
    const cacheKey = getFreeWindowsCacheKey([subordinateId]);
    setActiveFreeWindowsKey(cacheKey);
    
    // Переходим в календарь в режиме свободных окон
    window.location.hash = `#/calendar?mode=freeWindows&key=${encodeURIComponent(cacheKey)}&duration=${durationNum}`;
  }, [subordinateId, duration]);

  return (
    <div className="form-page">
      <div className="form-container">
        {/* Заголовок с кнопкой Календарь на одном уровне */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px' }}>
          <button
            type="button"
            onClick={handleBack}
            style={{
              background: 'none',
              border: 'none',
              color: '#007AFF',
              fontSize: '14px',
              cursor: 'pointer',
              padding: 0,
              fontWeight: 500,
              marginRight: '12px',
            }}
          >
            Календарь
          </button>
          <h2 style={{ margin: 0, flex: 1, textAlign: 'center', marginRight: '70px' }}>Новое задание</h2>
        </div>

        {/* Сообщение об успехе */}
        {success && (
          <div
            style={{
              background: "#34C759",
              color: "#fff",
              padding: "12px",
              borderRadius: "10px",
              marginBottom: "12px",
              textAlign: "center",
            }}
          >
            ✓ Задание создано!
          </div>
        )}

        {/* Ошибка */}
        {error && (
          <div
            style={{
              background: "#FF3B30",
              color: "#fff",
              padding: "10px",
              borderRadius: "10px",
              marginBottom: "12px",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} style={{ gap: '10px' }}>
          <label style={{ marginTop: 0, marginBottom: '4px' }}>Исполнитель:</label>
          <div className="selected-list" style={{ marginTop: '4px', marginBottom: 0, padding: '8px' }}>
            <ul>
              <li
                style={{
                  border: "2px solid #2196F3",
                  background: "#90CAF9",
                  borderRadius: "6px",
                  padding: "6px 10px",
                }}
              >
                {subordinateFullname || subordinateUsername || "Не выбран"}
                {subordinateFullname && subordinateUsername && (
                  <span style={{ marginLeft: '8px', color: '#666' }}>
                    ({subordinateUsername})
                  </span>
                )}
              </li>
            </ul>
          </div>

          <label style={{ marginTop: '6px', marginBottom: '4px' }}>Время начала:</label>
          <input
            type="datetime-local"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            disabled={success}
            style={isTimeInPast ? { borderColor: '#FF3B30' } : undefined}
          />
          {isTimeInPast && (
            <div style={{ color: '#FF3B30', fontSize: '12px', marginTop: '4px' }}>
              Время начала должно быть не раньше текущего момента
            </div>
          )}

          <label style={{ marginTop: '6px', marginBottom: '4px' }}>Продолжительность (мин.):</label>
          <input
            type="number"
            placeholder="Например: 40"
            min="1"
            step="1"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            disabled={success}
            onInvalid={(e) => {
              const input = e.target as HTMLInputElement;
              if (input.validity.stepMismatch) {
                input.setCustomValidity("Введите целое число");
              } else {
                input.setCustomValidity("");
              }
            }}
            onInput={(e) => {
              (e.target as HTMLInputElement).setCustomValidity("");
            }}
          />

          {/* Информация о режиме свободных окон */}
          {inFreeWindowsMode && (() => {
            const isSuccess = windowValidation.valid && windowValidation.fittingWindow;
            return (
            <div style={{
              marginTop: "8px",
              padding: "10px 12px",
              background: isSuccess ? "#E8F5E9" : "#FFEBEE",
              borderRadius: "8px",
              border: `1px solid ${isSuccess ? "#C8E6C9" : "#FFCDD2"}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span style={{ 
                color: isSuccess ? "#2E7D32" : "#C62828", 
                fontSize: "13px" 
              }}>
                {windowValidation.valid 
                  ? (windowValidation.fittingWindow 
                    ? `${selectedWindowDate}: ${windowValidation.fittingWindow.start} — ${windowValidation.fittingWindow.end}`
                    : "Укажите время задания")
                  : windowValidation.message
                }
              </span>
              <button
                type="button"
                onClick={() => {
                  // Сохраняем данные в кэш и переходим в календарь
                  const durationNum = parseInt(duration) || 40;
                  const cachedData = getFreeWindowsFromCache([subordinateId]);
                  if (cachedData) {
                    // Обновляем taskDraft в кэше
                    setFreeWindowsToCache([subordinateId], {
                      ...cachedData,
                      taskDraft: {
                        subordinateId,
                        subordinateUsername,
                        subordinateFullname,
                        time,
                        duration: durationNum,
                        description: description.trim(),
                        managerId: managerId || 0,
                        managerUsername: username,
                      },
                    });
                  }
                  const cacheKey = getFreeWindowsCacheKey([subordinateId]);
                  setActiveFreeWindowsKey(cacheKey);
                  window.location.hash = `#/calendar?mode=freeWindows&key=${encodeURIComponent(cacheKey)}&duration=${durationNum}`;
                }}
                style={{
                  background: isSuccess ? "#4CAF50" : "#EF5350",
                  color: "#fff",
                  border: "none",
                  borderRadius: "6px",
                  padding: "6px 10px",
                  fontSize: "12px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                К окнам
              </button>
            </div>
          );})()}

          <label style={{ marginTop: '6px', marginBottom: '4px' }}>Описание задания:</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={success}
            placeholder="Опишите, что нужно сделать..."
            rows={4}
            style={{
              width: "100%",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />

          <button
            type="submit"
            className="submit-btn"
            disabled={!isValid || submitting || success}
            style={{ marginTop: '6px' }}
          >
            {submitting ? "Создание..." : success ? "Создано ✓" : "Создать задание"}
          </button>
        </form>
      </div>

      {/* Диалог конфликта */}
      <TaskConflictDialog
        visible={conflictDialogVisible}
        reasons={conflictReasons}
        hasFreeWindows={conflictHasFreeWindows}
        onForceCreate={handleForceCreate}
        onShowWindows={handleShowFreeWindows}
        onClose={handleCloseConflictDialog}
      />
    </div>
  );
};
