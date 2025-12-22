import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import "../styles/formPage.css";
import { useTelegramUser } from "../hooks/useTelegramUser";
import { UserLoadingScreen } from "../components/UserLoadingScreen";
import {
  Task,
  Meeting,
  ScheduleDay,
  ScheduleInterval,
  Subordinate,
  getSubordinatesFromCache,
  setSubordinatesToCache,
  addTaskToMonthCache,
  removeTaskFromMonthCache,
  FreeWindowsData,
  setFreeWindowsToCache,
  getFreeWindowsCacheKey,
  setActiveFreeWindowsKey,
  getFreeWindowsFromCache,
  getFreeWindowsByKey,
  hasFreeWindowsCache,
  // Task form draft cache
  saveTaskFormDraft,
  getTaskFormDraft,
  clearTaskFormDraft,
  // Creator tasks cache
  getCreatorTasksFromCache,
  setCreatorTasksToCache,
  addTaskToCreatorCache,
  removeTaskFromCreatorCache,
} from "../cache";

const API_URL = import.meta.env.VITE_API_URL as string;

// --- Хелпер для проверки наличия свободных окон нужной длительности (с учётом заданий) ---
const hasFreeWindowsForDurationTask = (
  windows: ScheduleDay[],
  meetings: Record<number, Meeting[]>,
  tasks: Record<number, Task[]>,
  durationMinutes: number,
  excludeTaskId?: number | null
): boolean => {
  // Для каждого дня недели вычисляем свободные окна
  for (const daySchedule of windows) {
    const dayFreeWindows = computeFreeWindowsForDayTask(daySchedule, meetings, tasks, durationMinutes, excludeTaskId);
    if (dayFreeWindows.length > 0) {
      return true;
    }
  }
  return false;
};

// --- Хелпер для вычисления свободных окон на конкретный день (с учётом заданий) ---
const computeFreeWindowsForDayTask = (
  daySchedule: ScheduleDay,
  allMeetings: Record<number, Meeting[]>,
  allTasks: Record<number, Task[]>,
  minDuration: number,
  excludeTaskId?: number | null
): ScheduleInterval[] => {
  if (!daySchedule.intervals || daySchedule.intervals.length === 0) {
    return [];
  }

  // Собираем все занятые слоты (встречи + задания) на этот день недели
  const dayOfWeek = daySchedule.day;
  const busySlots: { start: number; end: number }[] = [];

  // Добавляем встречи
  for (const meetings of Object.values(allMeetings)) {
    for (const m of meetings) {
      if (!m.time) continue;
      const meetingDate = new Date(m.time);
      // JS: 0=Sunday, 1=Monday... API: 0=Monday, 6=Sunday
      const meetingDayOfWeek = meetingDate.getDay() === 0 ? 6 : meetingDate.getDay() - 1;
      
      if (meetingDayOfWeek === dayOfWeek) {
        const startMinutes = meetingDate.getHours() * 60 + meetingDate.getMinutes();
        const duration = m.duration || 40;
        busySlots.push({
          start: startMinutes,
          end: startMinutes + duration,
        });
      }
    }
  }

  // Добавляем задания (исключая редактируемое)
  for (const tasks of Object.values(allTasks)) {
    for (const t of tasks) {
      // Исключаем редактируемое задание
      if (excludeTaskId != null && t.id === excludeTaskId) continue;
      
      if (!t.time) continue;
      const taskDate = new Date(t.time);
      const taskDayOfWeek = taskDate.getDay() === 0 ? 6 : taskDate.getDay() - 1;
      
      if (taskDayOfWeek === dayOfWeek) {
        const startMinutes = taskDate.getHours() * 60 + taskDate.getMinutes();
        const duration = t.duration || 40;
        busySlots.push({
          start: startMinutes,
          end: startMinutes + duration,
        });
      }
    }
  }

  // Сортируем занятые слоты по времени начала
  busySlots.sort((a, b) => a.start - b.start);

  // Вычисляем свободные промежутки
  const freeWindows: ScheduleInterval[] = [];
  
  for (const interval of daySchedule.intervals) {
    const [startH, startM] = interval.start.split(":").map(Number);
    const [endH, endM] = interval.end.split(":").map(Number);
    const intervalStart = startH * 60 + startM;
    const intervalEnd = endH * 60 + endM;

    // Вычитаем занятые слоты из этого интервала
    let currentStart = intervalStart;
    
    for (const busy of busySlots) {
      if (busy.end <= currentStart || busy.start >= intervalEnd) {
        continue; // Слот не пересекается с текущим интервалом
      }
      
      if (busy.start > currentStart) {
        // Есть свободное окно до занятого слота
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

    // Проверяем окно после последнего занятого слота
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

// --- Тип исполнителя задания (из API) ---
interface TaskAssignee {
  id: number;
  username: string;
  fullname: string;
}

// --- Тип задания с исполнителями ---
interface TaskWithAssignees {
  id: number;
  description: string;
  time: string;
  duration: number;
  assignees: TaskAssignee[];
  assignee_ids: number[];
}

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
  isEdit: boolean;
}

const TaskConflictDialog: React.FC<TaskConflictDialogProps> = ({
  visible,
  reasons,
  hasFreeWindows,
  onForceCreate,
  onShowWindows,
  onClose,
  isEdit,
}) => {
  if (!visible) return null;

  const reasonMessages: string[] = [];
  if (reasons.includes("schedule")) {
    reasonMessages.push("Задание не укладывается в рабочее расписание исполнителей");
  }
  if (reasons.includes("conflict")) {
    reasonMessages.push("Задание пересекается с другими событиями (встречами/заданиями)");
  }

  const actionWord = isEdit ? "изменить" : "создать";
  const questionText = hasFreeWindows
    ? `Хотите ли вы все равно ${actionWord} задание, или выбрать другое время?`
    : `Хотите ли вы все равно ${actionWord} задание? В ближайшее время для задания с такой продолжительностью у исполнителей нет свободных окон.`;

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
            {isEdit ? "Изменить" : "Создать"}
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

// --- Хелпер для форматирования даты/времени ---
const formatDateTime = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
    const day = date.getDate();
    const month = months[date.getMonth()];
    const hours = date.getHours().toString().padStart(2, "0");
    const minutes = date.getMinutes().toString().padStart(2, "0");
    return `${day} ${month}, ${hours}:${minutes}`;
  } catch {
    return isoString;
  }
};

// --- Хелпер для форматирования продолжительности ---
const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours} ч`;
  return `${hours} ч ${mins} мин`;
};

// --- Хелпер сравнения массивов ---
const sameNumberArray = (a: number[], b: number[]): boolean => {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
};

const sameString = (a: string, b: string): boolean => a === b;

// Хелпер для преобразования минут в строку времени
const minutesToTime = (minutes: number): string => {
  return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
};

// Хелпер для преобразования времени в минуты
const timeToMinutes = (timeStr: string): number => {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

export const FormTaskPage: React.FC = () => {
  // Данные пользователя
  const { username, isLoading: tgLoading, error: tgError } = useTelegramUser();

  // Состояние списка заданий
  const [tasks, setTasks] = useState<TaskWithAssignees[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  // Состояние формы
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState("40");
  const [description, setDescription] = useState("");
  const [selectedAssigneeIds, setSelectedAssigneeIds] = useState<number[]>([]);

  // Состояние редактирования
  const [editId, setEditId] = useState<number | null>(null);
  const [origDescription, setOrigDescription] = useState("");
  const [origTime, setOrigTime] = useState("");
  const [origDuration, setOrigDuration] = useState("");
  const [origAssigneeIds, setOrigAssigneeIds] = useState<number[]>([]);

  // Подчиненные для выбора
  const [subordinates, setSubordinates] = useState<Subordinate[]>([]);
  const [managerId, setManagerId] = useState<number | null>(null);

  // UI состояния
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Диалог подтверждения удаления
  const [deleteConfirmTask, setDeleteConfirmTask] = useState<TaskWithAssignees | null>(null);

  // Диалог конфликта
  const [conflictDialogVisible, setConflictDialogVisible] = useState(false);
  const [conflictReasons, setConflictReasons] = useState<string[]>([]);
  const [conflictWindows, setConflictWindows] = useState<ScheduleDay[]>([]);
  const [conflictMeetings, setConflictMeetings] = useState<Record<number, Meeting[]>>({});
  const [conflictTasks, setConflictTasks] = useState<Record<number, Task[]>>({});
  const [conflictHasFreeWindows, setConflictHasFreeWindows] = useState(false);

  // Состояние для режима свободных окон (при возврате с календаря)
  const [selectedWindowInfo, setSelectedWindowInfo] = useState<{start: string; end: string} | null>(null);
  const [selectedWindowDate, setSelectedWindowDate] = useState<string | null>(null);
  const [inFreeWindowsMode, setInFreeWindowsMode] = useState(false);

  // Поиск подчиненных
  const [searchQuery, setSearchQuery] = useState("");

  // Загрузка подчиненных
  useEffect(() => {
    // Ждём пока хук useTelegramUser получит username
    if (!username) return;

    const cached = getSubordinatesFromCache(username);
    if (cached) {
      setSubordinates(cached.subordinates);
      setManagerId(cached.managerId);
      return;
    }

    const fetchSubordinates = async () => {
      try {
        const resp = await fetch(`${API_URL}/get_subordinates?username=${encodeURIComponent(username)}`);
        if (!resp.ok) return;
        const data = await resp.json();
        const subs: Subordinate[] = (data.subordinates || []).map((w: any) => ({
          id: w.id,
          username: w.username,
          fullname: w.fullname,
          isManager: w.isManager,
        }));
        const mgrId = data.manager_id || null;
        setSubordinates(subs);
        setManagerId(mgrId);
        if (mgrId) {
          setSubordinatesToCache(username, mgrId, subs);
        }
      } catch (e) {
        console.error("Failed to fetch subordinates:", e);
      }
    };
    fetchSubordinates();
  }, [username]);

  // Обработка URL параметров и восстановление черновика
  useEffect(() => {
    const processUrlParams = () => {
      const hash = window.location.hash;
      
      // Проверяем, есть ли параметры для страницы заданий
      if (!hash.includes("#/task")) return;
      
      // Парсим параметры из URL
      const params = new URLSearchParams(hash.split("?")[1] || "");
      const subordinateIdParam = params.get("subordinateId");
      const dateParam = params.get("date");
      const hourParam = params.get("hour");
      const restoreFromWindows = params.get("restoreFromWindows");
      const restoreKey = params.get("key");
      const selectedTime = params.get("selectedTime");
      
      // Восстановление из режима свободных окон (с выбранным временем)
      if (restoreFromWindows === "1" && restoreKey) {
        const cached = getFreeWindowsByKey(restoreKey);
        if (cached?.taskDraft) {
          const draft = cached.taskDraft;
          setDescription(draft.description);
          setDuration(String(draft.duration));
          setSelectedAssigneeIds(draft.assigneeIds);
          
          // Устанавливаем время (либо выбранное, либо из черновика)
          if (selectedTime) {
            setTime(selectedTime.slice(0, 16)); // Убираем секунды
          } else if (draft.time) {
            setTime(draft.time);
          }
          
          // Восстанавливаем режим редактирования если был
          if (draft.editId != null) {
            setEditId(draft.editId);
            setOrigDescription(draft.origDescription || "");
            setOrigTime(draft.origTime || "");
            setOrigDuration(draft.origDuration || "");
            setOrigAssigneeIds(draft.origAssigneeIds || []);
          }
          
          // Устанавливаем режим свободных окон
          setInFreeWindowsMode(true);
        }
        
        // Очищаем URL от параметров
        history.replaceState(null, "", "#/task");
        return;
      }
      
      // Восстановление из freeWindowsCache (без выбора окна - возврат по кнопке "Задания")
      const restoreKeyParam = params.get("restoreKey");
      if (restoreKeyParam) {
        const cached = getFreeWindowsByKey(restoreKeyParam);
        if (cached?.taskDraft) {
          const draft = cached.taskDraft;
          setDescription(draft.description);
          setDuration(String(draft.duration));
          setSelectedAssigneeIds(draft.assigneeIds);
          
          // Восстанавливаем введённое время (если было)
          if (draft.time) {
            setTime(draft.time);
          }
          
          // Восстанавливаем режим редактирования если был
          if (draft.editId != null) {
            setEditId(draft.editId);
            setOrigDescription(draft.origDescription || "");
            setOrigTime(draft.origTime || "");
            setOrigDuration(draft.origDuration || "");
            setOrigAssigneeIds(draft.origAssigneeIds || []);
          }
          
          // Устанавливаем режим свободных окон
          setInFreeWindowsMode(true);
        }
        
        // Очищаем URL от параметров
        history.replaceState(null, "", "#/task");
        return;
      }
      
      if (subordinateIdParam && dateParam && hourParam) {
        // Переход из календаря с параметрами
        const newSubordinateId = parseInt(subordinateIdParam, 10);
        const newTime = `${dateParam}T${String(hourParam).padStart(2, '0')}:00`;
        
        // Восстанавливаем черновик из кэша
        const draft = getTaskFormDraft();
        
        if (draft) {
          // Есть черновик — мержим: сохраняем описание и продолжительность, обновляем время и добавляем участника
          setDescription(draft.description);
          setDuration(draft.duration);
          setTime(newTime);
          
          // Добавляем нового участника если его ещё нет
          const mergedIds = draft.selectedAssigneeIds.includes(newSubordinateId)
            ? draft.selectedAssigneeIds
            : [...draft.selectedAssigneeIds, newSubordinateId];
          setSelectedAssigneeIds(mergedIds);
          
          // Восстанавливаем режим редактирования если был
          if (draft.editId !== null) {
            setEditId(draft.editId);
            setOrigDescription(draft.origDescription || "");
            setOrigTime(draft.origTime || "");
            setOrigDuration(draft.origDuration || "");
            setOrigAssigneeIds(draft.origAssigneeIds || []);
          }
        } else {
          // Нет черновика — создаём новый с данными из URL
          setTime(newTime);
          setSelectedAssigneeIds([newSubordinateId]);
        }
        
        // Очищаем URL от параметров через history.replaceState (не вызывает hashchange и re-mount)
        history.replaceState(null, "", "#/task");
      }
    };
    
    const restoreDraftOnMount = () => {
      const hash = window.location.hash;
      // Только если нет параметров в URL
      if (hash.includes("subordinateId=") || hash.includes("restoreFromWindows=")) return;
      
      const draft = getTaskFormDraft();
      if (draft) {
        // Восстанавливаем черновик полностью
        setDescription(draft.description);
        setDuration(draft.duration);
        setTime(draft.time);
        setSelectedAssigneeIds(draft.selectedAssigneeIds);
        
        if (draft.editId !== null) {
          setEditId(draft.editId);
          setOrigDescription(draft.origDescription || "");
          setOrigTime(draft.origTime || "");
          setOrigDuration(draft.origDuration || "");
          setOrigAssigneeIds(draft.origAssigneeIds || []);
        }
        
        // Очищаем черновик после восстановления
        clearTaskFormDraft();
      }
    };
    
    // Обрабатываем параметры при монтировании
    processUrlParams();
    restoreDraftOnMount();
    
    // Слушаем изменения hash для обработки навигации из календаря
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.includes("#/task") && hash.includes("subordinateId=")) {
        processUrlParams();
      }
      if (hash.includes("#/task") && hash.includes("restoreFromWindows=")) {
        processUrlParams();
      }
      if (hash.includes("#/task") && hash.includes("restoreKey=")) {
        processUrlParams();
      }
    };
    
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  // Загрузка заданий (с использованием кэша)
  useEffect(() => {
    if (!managerId) return;

    // Проверяем кэш
    const cachedTasks = getCreatorTasksFromCache(managerId);
    if (cachedTasks) {
      setTasks(cachedTasks);
      setLoadingTasks(false);
      return;
    }

    // Кэша нет — загружаем с сервера
    const fetchTasks = async () => {
      setLoadingTasks(true);
      try {
        const resp = await fetch(`${API_URL}/get_tasks?id=${managerId}`);
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const tasksData = data.tasks || [];
        setTasks(tasksData);
        // Сохраняем в кэш
        setCreatorTasksToCache(managerId, tasksData);
      } catch (e) {
        console.error("Failed to fetch tasks:", e);
      } finally {
        setLoadingTasks(false);
      }
    };
    fetchTasks();
  }, [managerId]);

  // Проверка: время не раньше текущего момента
  const isTimeInPast = useMemo(() => {
    if (!time) return false;
    const selectedTime = new Date(time);
    const now = new Date();
    return selectedTime < now;
  }, [time]);

  // Проверка изменений при редактировании
  const isEditChanged = useMemo(() => {
    if (editId === null) return false;
    return !sameString(description.trim(), origDescription)
      || !sameNumberArray(selectedAssigneeIds, origAssigneeIds)
      || !sameString(time, origTime)
      || !sameString(duration, origDuration);
  }, [editId, description, selectedAssigneeIds, time, duration, origDescription, origAssigneeIds, origTime, origDuration]);

  // Валидность формы
  const isValid = useMemo(() => {
    const baseValid = time && parseInt(duration) > 0 && description.trim().length > 0 && selectedAssigneeIds.length > 0 && !isTimeInPast;
    if (editId !== null) {
      return baseValid && isEditChanged;
    }
    return baseValid;
  }, [time, duration, description, selectedAssigneeIds, isTimeInPast, editId, isEditChanged]);

  // Обновляем дату окна при изменении времени задания (в режиме окон)
  useEffect(() => {
    if ((selectedWindowInfo || inFreeWindowsMode) && time) {
      const parsedDate = new Date(time);
      if (!isNaN(parsedDate.getTime())) {
        const dateStr = parsedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        setSelectedWindowDate(dateStr);
      }
    }
  }, [time, selectedWindowInfo, inFreeWindowsMode]);

  // Проверка попадания в свободное окно (в режиме окон)
  const windowValidation = useMemo(() => {
    type ValidationResult = {
      valid: boolean;
      message: string;
      newWindow: { start: string; end: string } | null;
      fittingWindow: { start: string; end: string } | null;
    };
    
    const emptyResult: ValidationResult = { valid: true, message: "", newWindow: null, fittingWindow: null };
    
    // Работаем если есть selectedWindowInfo ИЛИ активен режим окон
    if (!selectedWindowInfo && !inFreeWindowsMode) {
      return emptyResult;
    }
    
    // Получаем кэш окон для текущих участников
    const cachedData = getFreeWindowsFromCache(selectedAssigneeIds);
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
      return { valid: false, message: "Нет рабочего расписания на выбранный день", newWindow: null, fittingWindow: null };
    }
    
    // ID задания для исключения (при редактировании)
    const excludeTaskId = cachedData.excludeTaskId;
    const excludeMeetingId = cachedData.excludeMeetingId;
    
    // Получаем встречи и задания на этот день
    const dateKey = `${taskDate.getFullYear()}-${String(taskDate.getMonth() + 1).padStart(2, "0")}-${String(taskDate.getDate()).padStart(2, "0")}`;
    const busySlots: { start: number; end: number }[] = [];
    
    // Собираем встречи
    for (const meetings of Object.values(cachedData.meetings)) {
      for (const m of meetings) {
        if (!m.time) continue;
        if (excludeMeetingId != null && m.id === excludeMeetingId) continue;
        
        const mDate = new Date(m.time);
        const mDateKey = `${mDate.getFullYear()}-${String(mDate.getMonth() + 1).padStart(2, "0")}-${String(mDate.getDate()).padStart(2, "0")}`;
        if (mDateKey === dateKey) {
          const mStart = mDate.getHours() * 60 + mDate.getMinutes();
          busySlots.push({ start: mStart, end: mStart + (m.duration || 40) });
        }
      }
    }
    
    // Собираем задания
    if (cachedData.tasks) {
      for (const tasks of Object.values(cachedData.tasks)) {
        for (const t of tasks) {
          if (!t.time) continue;
          // Исключаем редактируемое задание
          if (excludeTaskId != null && t.id != null && String(t.id) === String(excludeTaskId)) continue;
          
          const tDate = new Date(t.time);
          const tDateKey = `${tDate.getFullYear()}-${String(tDate.getMonth() + 1).padStart(2, "0")}-${String(tDate.getDate()).padStart(2, "0")}`;
          if (tDateKey === dateKey) {
            const tStart = tDate.getHours() * 60 + tDate.getMinutes();
            busySlots.push({ start: tStart, end: tStart + (t.duration || 40) });
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
      return { valid: false, message: "Дата и время задания должны быть не ранее текущего момента", newWindow: null, fittingWindow: null };
    }
    
    const currentMinutes = now.getHours() * 60 + now.getMinutes() + 1;
    if (targetDay.getTime() === today.getTime()) {
      if (taskStartMinutes < currentMinutes) {
        return { valid: false, message: "Дата и время задания должны быть не ранее текущего момента", newWindow: null, fittingWindow: null };
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
      return { valid: false, message: "Выбранное время не попадает в свободное окно", newWindow: null, fittingWindow: null };
    }
    
    const fittingWindow = {
      start: minutesToTime(fittingSlot.start),
      end: minutesToTime(fittingSlot.end)
    };
    
    if (selectedWindowInfo) {
      const originalStart = timeToMinutes(selectedWindowInfo.start);
      const originalEnd = timeToMinutes(selectedWindowInfo.end);
      
      if (fittingSlot.start === originalStart && fittingSlot.end === originalEnd) {
        return { valid: true, message: "", newWindow: null, fittingWindow };
      }
      return { valid: true, message: "", newWindow: fittingWindow, fittingWindow };
    }
    
    return { valid: true, message: "", newWindow: null, fittingWindow };
  }, [selectedWindowInfo, inFreeWindowsMode, selectedAssigneeIds, time, duration]);

  // Фильтрованные подчиненные для выпадающего списка (без начальников)
  const filteredSubordinates = useMemo(() => {
    // Исключаем начальников — им нельзя давать задания
    const nonManagers = subordinates.filter(s => !s.isManager);
    if (!searchQuery.trim()) return nonManagers;
    const q = searchQuery.toLowerCase();
    return nonManagers.filter(s => 
      s.fullname.toLowerCase().includes(q) || 
      s.username.toLowerCase().includes(q)
    );
  }, [subordinates, searchQuery]);

  // --- Обработчики выбора исполнителей ---
  const toggleAssignee = (id: number) => {
    setSelectedAssigneeIds(prev => 
      prev.includes(id) 
        ? prev.filter(x => x !== id) 
        : [...prev, id]
    );
  };

  const removeAssignee = (id: number) => {
    setSelectedAssigneeIds(prev => prev.filter(x => x !== id));
  };

  // --- Обработчик редактирования ---
  const handleEdit = (task: TaskWithAssignees) => {
    setEditId(task.id);
    setDescription(task.description);
    setTime(task.time.slice(0, 16));
    setDuration(String(task.duration));
    setSelectedAssigneeIds(task.assignee_ids);

    setOrigDescription(task.description);
    setOrigTime(task.time.slice(0, 16));
    setOrigDuration(String(task.duration));
    setOrigAssigneeIds(task.assignee_ids);

    setSuccess(false);
    setError(null);
  };

  // --- Сброс формы ---
  const resetForm = useCallback(() => {
    setEditId(null);
    setDescription("");
    setTime("");
    setDuration("40");
    setSelectedAssigneeIds([]);
    setOrigDescription("");
    setOrigTime("");
    setOrigDuration("");
    setOrigAssigneeIds([]);
    setSuccess(false);
    setError(null);
    // Очищаем черновик после сброса формы
    clearTaskFormDraft();
    // Сбрасываем режим свободных окон
    setSelectedWindowInfo(null);
    setSelectedWindowDate(null);
    setInFreeWindowsMode(false);
  }, []);

  // Функция сохранения текущего состояния формы в кэш свободных окон
  const saveFormToFreeWindowsCache = useCallback(() => {
    const existingData = getFreeWindowsFromCache(selectedAssigneeIds);
    if (!existingData) return;
    
    const durationNum = duration ? parseInt(duration, 10) : 40;
    const updatedData: FreeWindowsData = {
      ...existingData,
      taskDraft: {
        assigneeIds: selectedAssigneeIds,
        time: time,
        duration: durationNum,
        description: description.trim(),
        managerId: managerId!,
        managerUsername: username,
        editId: editId,
        origDescription: editId ? origDescription : undefined,
        origTime: editId ? origTime : undefined,
        origDuration: editId ? origDuration : undefined,
        origAssigneeIds: editId ? origAssigneeIds : undefined,
      },
    };
    
    setFreeWindowsToCache(selectedAssigneeIds, updatedData);
  }, [selectedAssigneeIds, time, duration, description, managerId, username, editId, origDescription, origTime, origDuration, origAssigneeIds]);

  // --- Обработчик удаления ---
  const handleDelete = useCallback(async (task: TaskWithAssignees) => {
    try {
      setDeletingId(task.id);
      const resp = await fetch(`${API_URL}/delete_task?task_id=${task.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigner_username: username }),
      });
      
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      
      const data = await resp.json();
      if (!data.ok) {
        throw new Error(data.error || "Ошибка удаления");
      }

      // Удаляем из локального состояния
      setTasks(prev => prev.filter(t => t.id !== task.id));

      // Удаляем из кэша создателя
      if (managerId) {
        removeTaskFromCreatorCache(managerId, task.id);
      }

      // Удаляем из кэша месяца для каждого исполнителя
      for (const assigneeId of task.assignee_ids) {
        removeTaskFromMonthCache(assigneeId, task.id, task.time);
      }

      // Если удаляли редактируемое задание, сбрасываем форму
      if (editId === task.id) {
        resetForm();
      }
    } catch (e: any) {
      setError(e?.message || "Ошибка удаления");
    } finally {
      setDeletingId(null);
      setDeleteConfirmTask(null);
    }
  }, [username, editId, resetForm, managerId]);

  // --- Обработчик создания/обновления ---
  const handleSubmit = useCallback(async (forceCreate = false) => {
    if (!isValid || submittingRef.current) return;

    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      if (editId === null) {
        // Создание нового задания
        const payload: Record<string, unknown> = {
          assignee_ids: selectedAssigneeIds,
          assigner_id: managerId,
          assigner_username: username,
          description: description.trim(),
          time: time,
          duration: parseInt(duration),
        };

        if (forceCreate) {
          payload.force = true;
        }

        const resp = await fetch(`${API_URL}/create_task`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          throw new Error(await resp.text());
        }

        const data = await resp.json();

        if (data.ok === false && Array.isArray(data.reasons)) {
          // Конфликт — проверяем наличие свободных окон
          const conflictRes = data as TaskConflictResponse;
          const durationNum = parseInt(duration) || 40;
          const hasFreeWindows = hasFreeWindowsForDurationTask(
            conflictRes.windows || [],
            conflictRes.meetings || {},
            conflictRes.tasks || {},
            durationNum
          );
          
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
          throw new Error(data.error || "Ошибка создания");
        }

        // Успешное создание
        setSuccess(true);

        // Добавляем в локальный список
        const newTask: TaskWithAssignees = {
          id: data.id,
          description: description.trim(),
          time: time,
          duration: parseInt(duration),
          assignees: subordinates
            .filter(s => selectedAssigneeIds.includes(s.id))
            .map(s => ({ id: s.id, username: s.username, fullname: s.fullname })),
          assignee_ids: selectedAssigneeIds,
        };
        setTasks(prev => [newTask, ...prev]);

        // Добавляем в кэш создателя
        if (managerId) {
          addTaskToCreatorCache(managerId, newTask);
        }

        // Добавляем в кэш месяца для каждого исполнителя
        for (const assigneeId of selectedAssigneeIds) {
          addTaskToMonthCache(assigneeId, {
            id: newTask.id,
            assigner_id: managerId || 0,
            assigner_username: username,
            assigner_fullname: "",
            description: newTask.description,
            time: newTask.time,
            duration: newTask.duration,
            assignees: newTask.assignees,
            assignee_ids: newTask.assignee_ids,
          });
        }

        // Сброс формы через 1.5 секунды
        setTimeout(() => {
          resetForm();
        }, 1500);

      } else {
        // Обновление существующего задания
        const payload: Record<string, any> = { id: editId };

        if (!sameString(description.trim(), origDescription)) {
          payload.description = description.trim();
        }
        if (!sameString(time, origTime)) {
          payload.date = time.split("T")[0];
          payload.time = time.split("T")[1] + ":00";
        }
        if (!sameString(duration, origDuration)) {
          payload.duration = parseInt(duration);
        }

        // Вычисляем добавленных и удалённых исполнителей
        const addedIds = selectedAssigneeIds.filter(id => !origAssigneeIds.includes(id));
        const removedIds = origAssigneeIds.filter(id => !selectedAssigneeIds.includes(id));

        if (addedIds.length > 0) {
          payload.added_assignee_ids = addedIds;
        }
        if (removedIds.length > 0) {
          payload.removed_assignee_ids = removedIds;
        }

        if (forceCreate) {
          payload.force = true;
        }

        const resp = await fetch(`${API_URL}/update_task`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!resp.ok) {
          throw new Error(await resp.text());
        }

        const data = await resp.json();

        if (data.ok === false && Array.isArray(data.reasons)) {
          // Конфликт — проверяем наличие свободных окон
          const conflictRes = data as TaskConflictResponse;
          const durationNum = parseInt(duration) || parseInt(origDuration) || 40;
          const hasFreeWindows = hasFreeWindowsForDurationTask(
            conflictRes.windows || [],
            conflictRes.meetings || {},
            conflictRes.tasks || {},
            durationNum,
            editId  // Исключаем редактируемое задание
          );
          
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
          throw new Error(data.error || "Ошибка обновления");
        }

        // Успешное обновление
        setSuccess(true);

        // Обновляем в локальном списке
        const updatedTask: TaskWithAssignees = {
          id: editId,
          description: payload.description ?? origDescription,
          time: time,
          duration: payload.duration ?? parseInt(origDuration),
          assignees: subordinates
            .filter(s => selectedAssigneeIds.includes(s.id))
            .map(s => ({ id: s.id, username: s.username, fullname: s.fullname })),
          assignee_ids: selectedAssigneeIds,
        };
        setTasks(prev => prev.map(t => t.id === editId ? updatedTask : t));

        // Обновляем в кэше создателя
        if (managerId) {
          // Удаляем старую версию и добавляем новую (чтобы обновить все поля)
          removeTaskFromCreatorCache(managerId, editId);
          addTaskToCreatorCache(managerId, updatedTask);
        }

        // Обновляем кэш месяца
        for (const id of [...origAssigneeIds, ...selectedAssigneeIds]) {
          removeTaskFromMonthCache(id, editId, origTime);
        }
        for (const id of selectedAssigneeIds) {
          addTaskToMonthCache(id, {
            id: updatedTask.id,
            assigner_id: managerId || 0,
            assigner_username: username,
            assigner_fullname: "",
            description: updatedTask.description,
            time: updatedTask.time,
            duration: updatedTask.duration,
            assignees: updatedTask.assignees,
            assignee_ids: updatedTask.assignee_ids,
          });
        }

        // Сброс формы через 1.5 секунды
        setTimeout(() => {
          resetForm();
        }, 1500);
      }
    } catch (e: any) {
      setError(e?.message || "Ошибка");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [isValid, editId, selectedAssigneeIds, managerId, username, description, time, duration, origDescription, origTime, origDuration, origAssigneeIds, subordinates, resetForm]);

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
    
    // Сохраняем данные в кэш свободных окон
    const durationNum = parseInt(duration) || 40;
    const freeWindowsData: FreeWindowsData = {
      windows: conflictWindows,
      meetings: conflictMeetings,
      tasks: conflictTasks,
      meetingDraft: {
        topic: "",
        memberIds: selectedAssigneeIds,
        duration: durationNum,
        link: "",
        time: time,
        creatorId: managerId!,
        creatorUsername: username,
      },
      taskDraft: {
        assigneeIds: selectedAssigneeIds,
        time: time,
        duration: durationNum,
        description: description.trim(),
        managerId: managerId!,
        managerUsername: username,
        editId: editId,
        origDescription: editId ? origDescription : undefined,
        origTime: editId ? origTime : undefined,
        origDuration: editId ? origDuration : undefined,
        origAssigneeIds: editId ? origAssigneeIds : undefined,
      },
      excludeTaskId: editId,
      type: "task",
    };
    
    setFreeWindowsToCache(selectedAssigneeIds, freeWindowsData);
    
    // Устанавливаем активный ключ для календаря
    const cacheKey = getFreeWindowsCacheKey(selectedAssigneeIds);
    setActiveFreeWindowsKey(cacheKey);
    
    // Переходим в календарь в режиме свободных окон
    window.location.hash = `#/calendar?mode=freeWindows&key=${encodeURIComponent(cacheKey)}&duration=${durationNum}`;
  }, [conflictWindows, conflictMeetings, conflictTasks, selectedAssigneeIds, time, duration, description, managerId, username, editId, origDescription, origTime, origDuration, origAssigneeIds]);

  // --- Возврат в календарь ---
  const handleBack = useCallback(() => {
    // В режиме свободных окон сохраняем данные в freeWindowsCache
    if (inFreeWindowsMode && selectedAssigneeIds.length > 0) {
      saveFormToFreeWindowsCache();
      const cacheKey = getFreeWindowsCacheKey(selectedAssigneeIds);
      setActiveFreeWindowsKey(cacheKey);
      const durationNum = duration ? parseInt(duration, 10) : 40;
      window.location.hash = `#/calendar?mode=freeWindows&key=${encodeURIComponent(cacheKey)}&duration=${durationNum}`;
      return;
    }
    
    // Сохраняем черновик формы перед уходом
    if (description.trim() || time || selectedAssigneeIds.length > 0) {
      saveTaskFormDraft({
        selectedAssigneeIds,
        time,
        duration,
        description,
        editId,
        origDescription: editId ? origDescription : undefined,
        origTime: editId ? origTime : undefined,
        origDuration: editId ? origDuration : undefined,
        origAssigneeIds: editId ? origAssigneeIds : undefined,
      });
    }
    window.location.hash = "#/calendar";
  }, [description, time, duration, selectedAssigneeIds, editId, origDescription, origTime, origDuration, origAssigneeIds, inFreeWindowsMode, saveFormToFreeWindowsCache]);

  // Экран загрузки или ошибки пользователя Telegram
  if (tgLoading || tgError || !username) {
    return (
      <UserLoadingScreen
        title="Новое задание"
        isLoading={tgLoading}
        error={tgError}
      />
    );
  }

  return (
    <div className="form-page">
      <div className="form-container">
        {/* Заголовок */}
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
          <h2 style={{ margin: 0, flex: 1, textAlign: 'center', marginRight: '70px' }}>
            {editId !== null ? "Редактировать" : "Новое задание"}
          </h2>
        </div>

        {/* Сообщение об успехе */}
        {success && (
          <div style={{
            background: "#34C759",
            color: "#fff",
            padding: "12px",
            borderRadius: "10px",
            marginBottom: "12px",
            textAlign: "center",
          }}>
            ✓ {editId !== null ? "Задание обновлено!" : "Задание создано!"}
          </div>
        )}

        {/* Ошибка */}
        {error && (
          <div style={{
            background: "#FF3B30",
            color: "#fff",
            padding: "10px",
            borderRadius: "10px",
            marginBottom: "12px",
          }}>
            {error}
          </div>
        )}

        {/* Форма */}
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} style={{ gap: '10px' }}>
          {/* Поиск и выбор исполнителей */}
          <label>Поиск по имени:</label>
          <input
            type="text"
            placeholder="Начните вводить ФИО или @ник..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            disabled={success}
          />

          {searchQuery && (
            <div className="custom-select">
              {filteredSubordinates.length > 0 ? (
                filteredSubordinates.map(sub => {
                  const isSelected = selectedAssigneeIds.includes(sub.id);
                  return (
                    <div
                      key={sub.id}
                      className="option"
                      onClick={() => toggleAssignee(sub.id)}
                      style={{
                        border: "2px solid #2196F3",
                        background: isSelected ? "#90CAF9" : "transparent",
                        borderRadius: "6px",
                        marginBottom: "4px",
                      }}
                    >
                      {sub.username} — {sub.fullname}
                    </div>
                  );
                })
              ) : (
                <p style={{ marginTop: 8, color: "#888" }}>Совпадений нет</p>
              )}
            </div>
          )}

          {/* Выбранные исполнители */}
          {selectedAssigneeIds.length > 0 && (
            <div className="selected-list">
              <h4>Выбранные исполнители:</h4>
              <ul>
                {selectedAssigneeIds.map(id => {
                  const sub = subordinates.find(s => s.id === id);
                  if (!sub) return null;
                  return (
                    <li
                      key={id}
                      style={{
                        border: "2px solid #2196F3",
                        background: "#90CAF9",
                        borderRadius: "6px",
                        padding: "8px 12px",
                        marginBottom: "4px",
                      }}
                    >
                      {sub.username} — {sub.fullname}{" "}
                      <button type="button" onClick={() => removeAssignee(id)}>
                        ✖
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

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
          />

          {/* Информация о режиме свободных окон */}
          {(selectedWindowInfo || inFreeWindowsMode) && (() => {
            // Зелёный только если валидно И есть подходящее окно
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
                  saveFormToFreeWindowsCache();
                  const cacheKey = getFreeWindowsCacheKey(selectedAssigneeIds);
                  setActiveFreeWindowsKey(cacheKey);
                  const durationNum = duration ? parseInt(duration, 10) : 40;
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
              boxSizing: 'border-box',
            }}
          />

          <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
            {editId !== null && (
              <button
                type="button"
                onClick={() => {
                  if (inFreeWindowsMode) {
                    // В режиме свободных окон просто выходим из него, сохраняя все данные формы и режим редактирования
                    setInFreeWindowsMode(false);
                    setSelectedWindowInfo(null);
                    setSelectedWindowDate(null);
                  } else {
                    // В обычном режиме — полный сброс формы
                    resetForm();
                  }
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  background: '#E5E5EA',
                  color: '#333',
                  border: 'none',
                  borderRadius: '10px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Отмена
              </button>
            )}
            <button
              type="submit"
              className="submit-btn"
              disabled={!isValid || submitting || success}
              style={{ flex: editId !== null ? 1 : undefined }}
            >
              {submitting ? "Сохранение..." : success ? "Сохранено ✓" : editId !== null ? "Сохранить" : "Создать задание"}
            </button>
          </div>
        </form>

        {/* Список заданий */}
        <div className="meeting-list">
          <h3>Созданные задания</h3>
          {loadingTasks && <p>Загрузка...</p>}
          {!loadingTasks && tasks.length === 0 && <p>Нет активных заданий</p>}

          {tasks.map(task => (
            <div
              key={task.id}
              className="meeting-item"
              style={editId === task.id ? { background: '#E3F2FD', border: '2px solid #2196F3' } : undefined}
            >
              <p><strong>Описание:</strong> {task.description}</p>
              <p><strong>Время:</strong> {formatDateTime(task.time)}</p>
              <p><strong>Продолжительность:</strong> {formatDuration(task.duration)}</p>
              <p><strong>Исполнители:</strong> {task.assignees.map(a => a.fullname || a.username).join(", ")}</p>
              <div className="meeting-actions">
                <button onClick={() => handleEdit(task)} disabled={deletingId === task.id}>
                  ✏️ Редактировать
                </button>
                <button onClick={() => setDeleteConfirmTask(task)} disabled={deletingId === task.id}>
                  {deletingId === task.id ? 'Удаление…' : '🗑 Удалить'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Диалог подтверждения удаления */}
      {deleteConfirmTask && (
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
          onClick={() => setDeleteConfirmTask(null)}
        >
          <div
            style={{
              background: "#fff",
              borderRadius: "16px",
              width: "100%",
              maxWidth: "350px",
              padding: "24px",
              boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ margin: "0 0 16px 0", fontSize: "16px", color: "#333" }}>
              Удалить задание?
            </p>
            <p style={{ margin: "0 0 20px 0", fontSize: "14px", color: "#666" }}>
              {deleteConfirmTask.description.length > 50 
                ? deleteConfirmTask.description.slice(0, 50) + "..." 
                : deleteConfirmTask.description}
            </p>
            <div style={{ display: "flex", gap: "10px" }}>
              <button
                onClick={() => setDeleteConfirmTask(null)}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: "#E5E5EA",
                  color: "#333",
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "16px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Отмена
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmTask)}
                style={{
                  flex: 1,
                  padding: "12px",
                  background: "#FF3B30",
                  color: "#fff",
                  border: "none",
                  borderRadius: "10px",
                  fontSize: "16px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Диалог конфликта */}
      <TaskConflictDialog
        visible={conflictDialogVisible}
        reasons={conflictReasons}
        hasFreeWindows={conflictHasFreeWindows}
        onForceCreate={handleForceCreate}
        onShowWindows={handleShowFreeWindows}
        onClose={handleCloseConflictDialog}
        isEdit={editId !== null}
      />
    </div>
  );
};
