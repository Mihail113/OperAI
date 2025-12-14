import React, { useState, useEffect, useRef, useMemo } from "react";
import "../styles/formPage.css";
import {
  ScheduleDay,
  ScheduleInterval,
  Meeting,
  Subordinate,
  Task,
  getScheduleFromCache,
  setScheduleToCache,
  getMonthMeetingsFromCache,
  setMonthMeetingsToCache,
  getMonthTasksFromCache,
  setMonthTasksToCache,
  getSubordinatesFromCache,
  setSubordinatesToCache,
  getFreeWindowsByKey,
  setActiveFreeWindowsKey,
  setFreeWindowsToCache,
  FreeWindowsData,
  saveMeetingFormDraft,
  getMeetingFormDraft,
  saveTaskFormDraft,
  getTaskFormDraft,
} from "../cache";

const API_URL = import.meta.env.VITE_API_URL as string;

// Employee is the same as Subordinate
type Employee = Subordinate;

// Интерфейс для свободного окна с конкретной датой
interface FreeWindowSlot {
  date: Date;
  start: string;
  end: string;
  startMinutes: number;
  endMinutes: number;
}

// Хелпер для форматирования времени окончания
const getEndTime = (startTime: string, durationMinutes: number): string => {
  const start = new Date(startTime);
  const end = new Date(start.getTime() + durationMinutes * 60000);
  return end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

export const FormCalPage: React.FC = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [showModal, setShowModal] = useState(false);

  // --- Данные ---
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [schedule, setSchedule] = useState<ScheduleDay[]>([]);

  const [myUserId, setMyUserId] = useState<number | null>(null); // получение ID начальника
  const [myUsername, setMyUsername] = useState<string | null>(null);
  const [subordinates, setSubordinates] = useState<Employee[]>([]);
  
  const [isInitLoading, setIsInitLoading] = useState(true); // Первая загрузка (ID)
  const [isEventsLoading, setIsEventsLoading] = useState(false); // Загрузка встреч при смене месяца или сотрудника

  // --- Поиск ---
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // --- Попап встречи ---
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);

  // --- Попап задания ---
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // --- Попап создания встречи (клик на время в календаре) ---
  const [createMeetingPopup, setCreateMeetingPopup] = useState<{
    hour: number;
    participant: { username: string; fullname: string; id: number; isManager?: boolean } | null;
  } | null>(null);

  // --- Линия времени (Current Time Line) ---
  const [nowMinutes, setNowMinutes] = useState(0);

  // --- Режим свободных окон ---
  const [freeWindowsMode, setFreeWindowsMode] = useState(false);
  const [freeWindowsKey, setFreeWindowsKey] = useState<string | null>(null);
  const [freeWindowsDuration, setFreeWindowsDuration] = useState<number>(40);
  const [freeWindowsData, setFreeWindowsData] = useState<FreeWindowsData | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Обновляем текущее время для красной линии
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setNowMinutes(now.getHours() * 60 + now.getMinutes());
    };
    updateTime();
    const interval = setInterval(updateTime, 60000); // раз в минуту
    return () => clearInterval(interval);
  }, []);

  // Скролл к 9:00 при открытии
  useEffect(() => {
    if (showModal && scrollRef.current) {
      // 9 * 60px = 540px
      scrollRef.current.scrollTop = 500;
    }
  }, [showModal]);

  // Проверка режима свободных окон из URL
  useEffect(() => {
    const checkFreeWindowsMode = () => {
      const hash = window.location.hash;
      if (hash.includes("mode=freeWindows")) {
        const params = new URLSearchParams(hash.split("?")[1] || "");
        const key = params.get("key");
        const duration = params.get("duration");
        
        if (key) {
          const data = getFreeWindowsByKey(key);
          if (data) {
            setFreeWindowsMode(true);
            setFreeWindowsKey(key);
            setFreeWindowsDuration(duration ? parseInt(duration, 10) : 40);
            setFreeWindowsData(data);
          }
        }
      } else {
        setFreeWindowsMode(false);
        setFreeWindowsKey(null);
        setFreeWindowsData(null);
      }
    };
    
    checkFreeWindowsMode();
    window.addEventListener("hashchange", checkFreeWindowsMode);
    return () => window.removeEventListener("hashchange", checkFreeWindowsMode);
  }, []);


// 1. Инициализация: Получаем Username -> ID, список подчиненных и данные начальника
  useEffect(() => {
    const controller = new AbortController();
    
    const init = async () => {
      const tg = (window as any).Telegram?.WebApp;
      const user = tg?.initDataUnsafe?.user;
      const username = user?.username ? `@${user.username}` : null;
      // const username = "@riftinink"; // Для тестов локально

      if (!username) {
        setIsInitLoading(false);
        return;
      }
      setMyUsername(username);

      try {
        // 1. Проверяем кэш подчиненных
        const cachedSubordinates = getSubordinatesFromCache(username);
        let managerId: number | null = null;
        let subordinatesList: Employee[] = [];

        if (cachedSubordinates) {
          // Используем данные из кэша
          managerId = cachedSubordinates.managerId;
          subordinatesList = cachedSubordinates.subordinates;
        } else {
          // Загружаем с сервера
          const res = await fetch(`${API_URL}/get_subordinates?username=${username}`, { signal: controller.signal });
          if (!res.ok) throw new Error("Failed to load profile");
          const data = await res.json();

          managerId = data.manager_id;
          subordinatesList = data.subordinates || [];

          // Сохраняем в кэш
          if (managerId) {
            setSubordinatesToCache(username, managerId, subordinatesList);
          }
        }

        setMyUserId(managerId);
        setSubordinates(subordinatesList);

        if (!managerId) return;

        // 2. Параллельно загружаем расписание и встречи для начальника
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth();

        // Проверяем кэш
        const cachedSchedule = getScheduleFromCache(managerId);
        const cachedMeetings = getMonthMeetingsFromCache(managerId, currentYear, currentMonth + 1);

        if (cachedSchedule && cachedMeetings) {
          // Данные уже есть в кэше
          setSchedule(cachedSchedule);
          setMeetings(cachedMeetings);
          return;
        }

        // Загружаем только недостающие данные
        const promises: Promise<void>[] = [];
        let scheduleResult: ScheduleDay[] = cachedSchedule || [];
        let meetingsResult: Meeting[] = cachedMeetings || [];

        if (!cachedSchedule) {
          promises.push(
            fetch(`${API_URL}/get_schedule?id=${managerId}`, { signal: controller.signal })
              .then(r => r.json())
              .then(data => {
                scheduleResult = data.schedule || [];
                setScheduleToCache(managerId, scheduleResult);
              })
          );
        }

        if (!cachedMeetings) {
          promises.push(
            fetch(`${API_URL}/get_month_meetings?id=${managerId}&year=${currentYear}&month=${currentMonth + 1}`, { signal: controller.signal })
              .then(r => r.json())
              .then(data => {
                meetingsResult = data.meetings || [];
                setMonthMeetingsToCache(managerId, currentYear, currentMonth + 1, meetingsResult);
              })
          );
        }

        await Promise.all(promises);

        // Устанавливаем в state
        setSchedule(scheduleResult);
        setMeetings(meetingsResult);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error(e);
        }
      } finally {
        setIsInitLoading(false);
      }
    };

    init();
    
    return () => controller.abort();
  }, []);

  // 2. Загрузка данных при смене месяца или сотрудника (с кэшированием)
  useEffect(() => {
    // Если еще не знаем свой ID - ждем (инициализация еще не завершена)
    if (!myUserId) return;

    const targetId = selectedEmployee ? selectedEmployee.id : myUserId;
    // Задания НЕ загружаются для начальников (у них isManager === true)
    const isManagerSelected = selectedEmployee?.isManager === true;

    // Проверяем кэш (используем shared cache)
    const cachedSchedule = getScheduleFromCache(targetId);
    const cachedMeetings = getMonthMeetingsFromCache(targetId, year, month + 1);
    // Для начальников задания не загружаем
    const cachedTasks = isManagerSelected ? [] : getMonthTasksFromCache(targetId, year, month + 1);

    // Если всё есть в кэше - просто устанавливаем из кэша
    const allCached = cachedSchedule && cachedMeetings && (isManagerSelected || cachedTasks !== undefined);
    if (allCached) {
      setSchedule(cachedSchedule);
      setMeetings(cachedMeetings);
      setTasks(cachedTasks || []);
      return;
    }

    // Иначе загружаем недостающее
    const fetchMissingData = async () => {
      setIsEventsLoading(true);

      try {
        const promises: Promise<void>[] = [];

        // Расписание - загружаем только если нет в кэше
        if (!cachedSchedule) {
          promises.push(
            fetch(`${API_URL}/get_schedule?id=${targetId}`)
              .then(r => r.json())
              .then(data => {
                const scheduleData = data.schedule || [];
                setScheduleToCache(targetId, scheduleData);
                setSchedule(scheduleData);
              })
          );
        } else {
          setSchedule(cachedSchedule);
        }

        // Встречи - загружаем только если нет в кэше
        if (!cachedMeetings) {
          promises.push(
            fetch(`${API_URL}/get_month_meetings?id=${targetId}&year=${year}&month=${month + 1}`)
              .then(r => r.json())
              .then(data => {
                const meetingsData = data.meetings || [];
                setMonthMeetingsToCache(targetId, year, month + 1, meetingsData);
                setMeetings(meetingsData);
              })
          );
        } else {
          setMeetings(cachedMeetings);
        }

        // Задания - загружаем для своего календаря и подчиненных (НЕ для начальников)
        if (!isManagerSelected && cachedTasks === undefined) {
          promises.push(
            fetch(`${API_URL}/get_month_tasks?id=${targetId}&year=${year}&month=${month + 1}`)
              .then(r => r.json())
              .then(data => {
                const tasksData = data.tasks || [];
                setMonthTasksToCache(targetId, year, month + 1, tasksData);
                setTasks(tasksData);
              })
          );
        } else if (isManagerSelected) {
          setTasks([]); // Для начальников задания не показываем
        } else {
          setTasks(cachedTasks || []);
        }

        await Promise.all(promises);
      } catch (e) {
        console.error("Error loading events", e);
      } finally {
        setIsEventsLoading(false);
      }
    };

    fetchMissingData();
  }, [myUserId, year, month, selectedEmployee]); // Перезапуск при смене даты или сотрудника

  // --- Хелперы ---
  const getFirstDayOfMonth = (y: number, m: number) => {
    const day = new Date(y, m, 1).getDay();
    return (day + 6) % 7; 
  };

  const formatDateKey = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Перевод времени "HH:MM" в минуты от начала дня
  const timeToMinutes = (timeStr: string) => {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  };

  // Конвертация JS дня недели в API формат (API: 0=Пн, 6=Вс; JS: 0=Вс, 1=Пн)
  const jsToApiDay = (jsDay: number) => jsDay === 0 ? 6 : jsDay - 1;

  // Проверка: есть ли рабочее расписание в этот день
  const hasScheduleForDate = (date: Date): boolean => {
    const apiDay = jsToApiDay(date.getDay());
    const daySchedule = schedule.find(s => s.day === apiDay);
    return !!(daySchedule && daySchedule.intervals.length > 0);
  };

  // Проверка: есть ли встречи в этот день
  const hasMeetingsForDate = (date: Date): boolean => {
    const dateKey = formatDateKey(date);
    return meetings.some(m => {
      if (!m.time) return false;
      return formatDateKey(new Date(m.time)) === dateKey;
    });
  };

  // Проверка: есть ли задания в этот день (включая многодневные)
  const hasTasksForDate = (date: Date): boolean => {
    const dateKey = formatDateKey(date);
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    return tasks.some(t => {
      if (!t.time) return false;
      const taskStart = new Date(t.time);
      const taskStartDate = new Date(taskStart.getFullYear(), taskStart.getMonth(), taskStart.getDate());
      const taskStartMinutes = taskStart.getHours() * 60 + taskStart.getMinutes();
      const duration = t.duration || 40;
      
      // Вычисляем дату окончания задания
      const taskEndMs = taskStart.getTime() + duration * 60000;
      const taskEnd = new Date(taskEndMs);
      const taskEndDate = new Date(taskEnd.getFullYear(), taskEnd.getMonth(), taskEnd.getDate());
      
      // Проверяем, попадает ли дата в диапазон задания
      return targetDate >= taskStartDate && targetDate <= taskEndDate;
    });
  };

  // Получение рабочих интервалов для дня (для timeline)
  const getWorkIntervalsForDate = (date: Date): ScheduleInterval[] => {
    const apiDay = jsToApiDay(date.getDay());
    const daySchedule = schedule.find(s => s.day === apiDay);
    return daySchedule?.intervals || [];
  };

  // Получение встреч для дня (для timeline)
  const getMeetingsForDate = (date: Date): Meeting[] => {
    const dateKey = formatDateKey(date);
    return meetings.filter(m => {
      if (!m.time) return false;
      return formatDateKey(new Date(m.time)) === dateKey;
    });
  };

  // Получение заданий для дня (для timeline) - базовая версия (только задания начинающиеся в этот день)
  const getTasksForDate = (date: Date): Task[] => {
    const dateKey = formatDateKey(date);
    return tasks.filter(t => {
      if (!t.time) return false;
      return formatDateKey(new Date(t.time)) === dateKey;
    });
  };

  // Интерфейс для сегмента задания (для многодневных заданий)
  interface TaskSegment {
    task: Task;
    dayStartMinutes: number;  // 0 если продолжается с предыдущего дня
    dayEndMinutes: number;    // 1440 если продолжается на следующий день
    isStart: boolean;         // это первый день задания
    isEnd: boolean;           // это последний день задания
  }

  // Получение сегментов заданий для дня (для timeline с поддержкой многодневных заданий)
  const getTaskSegmentsForDate = (date: Date): TaskSegment[] => {
    const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const targetDateMs = targetDate.getTime();
    const nextDayMs = targetDateMs + 24 * 60 * 60 * 1000;
    const segments: TaskSegment[] = [];

    for (const task of tasks) {
      if (!task.time) continue;
      
      const taskStart = new Date(task.time);
      const taskStartMs = taskStart.getTime();
      const duration = task.duration || 40;
      const taskEndMs = taskStartMs + duration * 60000;
      
      // Проверяем, пересекается ли задание с этим днём
      // Задание пересекается, если: начало < конец дня И конец > начало дня
      if (taskStartMs < nextDayMs && taskEndMs > targetDateMs) {
        // Вычисляем границы сегмента для этого дня
        const segmentStartMs = Math.max(taskStartMs, targetDateMs);
        const segmentEndMs = Math.min(taskEndMs, nextDayMs);
        
        // Конвертируем в минуты от начала дня
        const dayStartMinutes = Math.floor((segmentStartMs - targetDateMs) / 60000);
        const dayEndMinutes = Math.floor((segmentEndMs - targetDateMs) / 60000);
        
        // Определяем, является ли этот сегмент началом/концом задания
        const isStart = taskStartMs >= targetDateMs && taskStartMs < nextDayMs;
        const isEnd = taskEndMs > targetDateMs && taskEndMs <= nextDayMs;
        
        segments.push({
          task,
          dayStartMinutes,
          dayEndMinutes,
          isStart,
          isEnd
        });
      }
    }

    return segments;
  };

  // --- Хелперы для пересечений встреч и задач ---

  // Интерфейс для информации о пересечении
  interface OverlapInterval {
    start: number;  // начало пересечения в минутах от начала дня
    end: number;    // конец пересечения в минутах от начала дня
  }

  // Находит все интервалы пересечений между временным диапазоном и задачами
  const findOverlapsWithTasks = (
    itemStart: number,
    itemEnd: number,
    taskSegments: TaskSegment[]
  ): OverlapInterval[] => {
    const overlaps: OverlapInterval[] = [];
    
    for (const segment of taskSegments) {
      // Проверяем пересечение: начало < конец другого И конец > начало другого
      if (itemStart < segment.dayEndMinutes && itemEnd > segment.dayStartMinutes) {
        overlaps.push({
          start: Math.max(itemStart, segment.dayStartMinutes),
          end: Math.min(itemEnd, segment.dayEndMinutes)
        });
      }
    }
    
    // Объединяем перекрывающиеся интервалы
    if (overlaps.length <= 1) return overlaps;
    
    overlaps.sort((a, b) => a.start - b.start);
    const merged: OverlapInterval[] = [overlaps[0]];
    
    for (let i = 1; i < overlaps.length; i++) {
      const last = merged[merged.length - 1];
      if (overlaps[i].start <= last.end) {
        last.end = Math.max(last.end, overlaps[i].end);
      } else {
        merged.push(overlaps[i]);
      }
    }
    
    return merged;
  };

  // Находит все интервалы пересечений между временным диапазоном и встречами
  const findOverlapsWithMeetings = (
    itemStart: number,
    itemEnd: number,
    meetings: Meeting[]
  ): OverlapInterval[] => {
    const overlaps: OverlapInterval[] = [];
    
    for (const meeting of meetings) {
      if (!meeting.time) continue;
      const meetingDate = new Date(meeting.time);
      const meetingStart = meetingDate.getHours() * 60 + meetingDate.getMinutes();
      const meetingEnd = meetingStart + (meeting.duration || 40);
      
      // Проверяем пересечение
      if (itemStart < meetingEnd && itemEnd > meetingStart) {
        overlaps.push({
          start: Math.max(itemStart, meetingStart),
          end: Math.min(itemEnd, meetingEnd)
        });
      }
    }
    
    // Объединяем перекрывающиеся интервалы
    if (overlaps.length <= 1) return overlaps;
    
    overlaps.sort((a, b) => a.start - b.start);
    const merged: OverlapInterval[] = [overlaps[0]];
    
    for (let i = 1; i < overlaps.length; i++) {
      const last = merged[merged.length - 1];
      if (overlaps[i].start <= last.end) {
        last.end = Math.max(last.end, overlaps[i].end);
      } else {
        merged.push(overlaps[i]);
      }
    }
    
    return merged;
  };

  // Интерфейс для визуального сегмента (часть элемента с определённой шириной)
  interface VisualSegment {
    startMinutes: number;
    endMinutes: number;
    isOverlap: boolean;  // true = 50% ширины, false = 100% ширины
  }

  // Разбивает временной диапазон на сегменты по зонам пересечения
  const splitIntoVisualSegments = (
    itemStart: number,
    itemEnd: number,
    overlaps: OverlapInterval[]
  ): VisualSegment[] => {
    if (overlaps.length === 0) {
      return [{ startMinutes: itemStart, endMinutes: itemEnd, isOverlap: false }];
    }

    const segments: VisualSegment[] = [];
    let currentPos = itemStart;

    for (const overlap of overlaps) {
      // Сегмент до пересечения (если есть)
      if (currentPos < overlap.start) {
        segments.push({
          startMinutes: currentPos,
          endMinutes: overlap.start,
          isOverlap: false
        });
      }
      
      // Сегмент пересечения
      segments.push({
        startMinutes: overlap.start,
        endMinutes: overlap.end,
        isOverlap: true
      });
      
      currentPos = overlap.end;
    }

    // Сегмент после последнего пересечения (если есть)
    if (currentPos < itemEnd) {
      segments.push({
        startMinutes: currentPos,
        endMinutes: itemEnd,
        isOverlap: false
      });
    }

    return segments;
  };

  // --- Хелперы для режима свободных окон ---
  
  // Получение всех встреч участников для конкретной даты из кэша окон
  const getFreeWindowsMeetingsForDate = (date: Date): Meeting[] => {
    if (!freeWindowsData) return [];
    const dateKey = formatDateKey(date);
    const allMeetings: Meeting[] = [];
    const excludeId = freeWindowsData.excludeMeetingId;
    
    for (const meetings of Object.values(freeWindowsData.meetings)) {
      for (const m of meetings) {
        // Пропускаем редактируемую встречу — её старое время не занято
        // Используем == для сравнения, чтобы обойти проблему с типами (число vs строка)
        if (excludeId != null && m.id != null && String(m.id) === String(excludeId)) continue;
        
        if (m.time && formatDateKey(new Date(m.time)) === dateKey) {
          // Проверка на дубликаты
          if (!allMeetings.some(existing => existing.id === m.id)) {
            allMeetings.push(m);
          }
        }
      }
    }
    return allMeetings;
  };

  // Получение всех заданий участников для конкретной даты из кэша окон
  const getFreeWindowsTasksForDate = (date: Date): Task[] => {
    if (!freeWindowsData || !freeWindowsData.tasks) return [];
    const dateKey = formatDateKey(date);
    const allTasks: Task[] = [];
    const excludeId = freeWindowsData.excludeTaskId;
    
    for (const tasksList of Object.values(freeWindowsData.tasks)) {
      for (const t of tasksList) {
        // Пропускаем редактируемое задание — его старое время не занято
        if (excludeId != null && t.id != null && String(t.id) === String(excludeId)) continue;
        
        if (t.time && formatDateKey(new Date(t.time)) === dateKey) {
          // Проверка на дубликаты
          if (!allTasks.some(existing => existing.id === t.id)) {
            allTasks.push(t);
          }
        }
      }
    }
    return allTasks;
  };

  // Получение пересечённого расписания для дня недели из кэша окон
  const getFreeWindowsScheduleForDate = (date: Date): ScheduleInterval[] => {
    if (!freeWindowsData) return [];
    const apiDay = jsToApiDay(date.getDay());
    const daySchedule = freeWindowsData.windows.find(s => s.day === apiDay);
    return daySchedule?.intervals || [];
  };

  // Вычисление свободных окон для конкретной даты
  const computeFreeWindowsForDate = (date: Date, minDuration: number): FreeWindowSlot[] => {
    const scheduleIntervals = getFreeWindowsScheduleForDate(date);
    const dayMeetings = getFreeWindowsMeetingsForDate(date);
    const dayTasks = getFreeWindowsTasksForDate(date);
    
    if (scheduleIntervals.length === 0) return [];

    // Собираем занятые интервалы из встреч
    const meetingSlots: { start: number; end: number }[] = dayMeetings.map(m => {
      const meetingDate = new Date(m.time);
      const startMinutes = meetingDate.getHours() * 60 + meetingDate.getMinutes();
      const duration = m.duration || 40;
      return { start: startMinutes, end: startMinutes + duration };
    });
    
    // Собираем занятые интервалы из заданий
    const taskSlots: { start: number; end: number }[] = dayTasks.map(t => {
      const taskDate = new Date(t.time);
      const startMinutes = taskDate.getHours() * 60 + taskDate.getMinutes();
      return { start: startMinutes, end: startMinutes + t.duration };
    });
    
    // Объединяем и сортируем все занятые слоты
    const busySlots = [...meetingSlots, ...taskSlots].sort((a, b) => a.start - b.start);

    const freeSlots: FreeWindowSlot[] = [];

    for (const interval of scheduleIntervals) {
      const [startH, startM] = interval.start.split(":").map(Number);
      const [endH, endM] = interval.end.split(":").map(Number);
      const intervalStart = startH * 60 + startM;
      const intervalEnd = endH * 60 + endM;

      let currentStart = intervalStart;

      for (const busy of busySlots) {
        if (busy.end <= currentStart || busy.start >= intervalEnd) continue;

        if (busy.start > currentStart) {
          const windowDuration = busy.start - currentStart;
          if (windowDuration >= minDuration) {
            freeSlots.push({
              date,
              start: `${Math.floor(currentStart / 60).toString().padStart(2, "0")}:${(currentStart % 60).toString().padStart(2, "0")}`,
              end: `${Math.floor(busy.start / 60).toString().padStart(2, "0")}:${(busy.start % 60).toString().padStart(2, "0")}`,
              startMinutes: currentStart,
              endMinutes: busy.start,
            });
          }
        }
        currentStart = Math.max(currentStart, busy.end);
      }

      if (currentStart < intervalEnd) {
        const windowDuration = intervalEnd - currentStart;
        if (windowDuration >= minDuration) {
          freeSlots.push({
            date,
            start: `${Math.floor(currentStart / 60).toString().padStart(2, "0")}:${(currentStart % 60).toString().padStart(2, "0")}`,
            end: `${Math.floor(intervalEnd / 60).toString().padStart(2, "0")}:${(intervalEnd % 60).toString().padStart(2, "0")}`,
            startMinutes: currentStart,
            endMinutes: intervalEnd,
          });
        }
      }
    }

    // Фильтрация по текущему времени: окна не раньше текущей минуты + 1
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    // Прошлые дни — нет свободных окон
    if (targetDay < today) {
      return [];
    }
    
    // Будущие дни — все окна доступны
    if (targetDay > today) {
      return freeSlots;
    }
    
    // Сегодня — фильтруем по текущему времени
    const currentMinutes = now.getHours() * 60 + now.getMinutes() + 1;
    
    return freeSlots
      .filter(slot => slot.endMinutes > currentMinutes) // Исключаем окна, которые уже закончились
      .map(slot => {
        if (slot.startMinutes >= currentMinutes) {
          return slot; // Окно полностью в будущем
        }
        // Обрезаем окно: начало переносим на currentMinutes
        const newStartMinutes = currentMinutes;
        return {
          ...slot,
          startMinutes: newStartMinutes,
          start: `${Math.floor(newStartMinutes / 60).toString().padStart(2, "0")}:${(newStartMinutes % 60).toString().padStart(2, "0")}`,
        };
      })
      .filter(slot => (slot.endMinutes - slot.startMinutes) >= minDuration); // Проверяем длительность после обрезки
  };

  // Проверка: есть ли свободное окно в этот день (для режима месяца)
  const hasFreeWindowForDate = (date: Date): boolean => {
    if (!freeWindowsMode || !freeWindowsData) return false;
    const freeSlots = computeFreeWindowsForDate(date, freeWindowsDuration);
    return freeSlots.length > 0;
  };

  // Обработка выбора свободного окна
  const handleSelectFreeWindow = (slot: FreeWindowSlot) => {
    if (!freeWindowsData || !freeWindowsKey) return;
    
    // Формируем время начала в формате datetime-local
    const y = slot.date.getFullYear();
    const m = String(slot.date.getMonth() + 1).padStart(2, "0");
    const d = String(slot.date.getDate()).padStart(2, "0");
    const selectedTime = `${y}-${m}-${d}T${slot.start}`;
    
    // Выходим из режима окон
    setActiveFreeWindowsKey(null);
    
    // Для режима заданий переходим в форму задания
    if (freeWindowsData.type === "task" && freeWindowsData.taskDraft) {
      // Обновляем время в taskDraft и сохраняем обратно в кэш
      const draft = freeWindowsData.taskDraft;
      const updatedDraft = { ...draft, time: selectedTime };
      const updatedData = { ...freeWindowsData, taskDraft: updatedDraft };
      
      // Сохраняем обновлённые данные в кэш
      setFreeWindowsToCache(draft.assigneeIds, updatedData);
      
      // Переходим на страницу заданий с параметром восстановления
      window.location.hash = `#/task?restoreFromWindows=1&key=${encodeURIComponent(freeWindowsKey)}&selectedTime=${encodeURIComponent(selectedTime)}`;
      return;
    }
    
    // Для режима встреч переходим на страницу встреч с параметрами
    window.location.hash = `#/meetings?windowStart=${slot.start}&windowEnd=${slot.end}&restoreKey=${encodeURIComponent(freeWindowsKey)}&selectedTime=${encodeURIComponent(selectedTime)}`;
  };

  // --- Actions ---
  const openDay = (day: number) => {
    setSelectedDate(new Date(year, month, day));
    setShowModal(true);
  };

  const handleGoToMeetings = () => {
    // В режиме свободных окон восстанавливаем данные из freeWindowsCache
    if (freeWindowsMode && freeWindowsKey) {
      window.location.hash = `#/meetings?restoreKey=${encodeURIComponent(freeWindowsKey)}`;
    } else {
      window.location.hash = "#/meetings?restoreFormDraft=1";
    }
  };

  // Переход на страницу управления заданиями
  const handleGoToTasks = () => {
    // В режиме свободных окон восстанавливаем данные из freeWindowsCache
    if (freeWindowsMode && freeWindowsKey) {
      window.location.hash = `#/task?restoreKey=${encodeURIComponent(freeWindowsKey)}`;
    } else {
      window.location.hash = "#/task";
    }
  };

  // Переход к форме задания (для режима свободных окон type=task)
  const handleGoToTask = () => {
    if (freeWindowsMode && freeWindowsKey && freeWindowsData?.taskDraft) {
      // Переходим в форму задания с восстановлением данных из кэша
      window.location.hash = `#/task?restoreFromWindows=1&key=${encodeURIComponent(freeWindowsKey)}`;
    } else {
      window.location.hash = "#/calendar";
    }
  };

  // --- Рендер Timeline ---
  const renderTimeline = () => {
    if (!selectedDate) return null;
    const isToday = new Date().toDateString() === selectedDate.toDateString();

    // Константа высоты часа в пикселях
    const HOUR_HEIGHT = 60; 

    // В режиме свободных окон - показываем только зелёные окна
    if (freeWindowsMode && freeWindowsData) {
      const freeSlots = computeFreeWindowsForDate(selectedDate, freeWindowsDuration);
      
      return (
        <div style={{flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
          {/* Верхняя панель модалки */}
          <div style={{padding: '16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#E8F5E9', zIndex: 10}}>
            <button onClick={() => setShowModal(false)} style={{border: 'none', background: 'none', fontSize: '16px', color: '#2E7D32'}}>Закрыть</button>
            <span style={{fontWeight: '600', fontSize: '17px', color: '#2E7D32'}}>
              {selectedDate.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'})}
            </span>
            <div style={{width: 24}}></div>
          </div>

          {/* Информация о режиме */}
          <div style={{padding: '12px 16px', background: '#C8E6C9', borderBottom: '1px solid #A5D6A7'}}>
            <span style={{fontSize: '13px', color: '#1B5E20'}}>
              Выберите свободное окно для {freeWindowsData?.type === "task" ? "задания" : "встречи"} ({freeWindowsDuration} мин.)
            </span>
          </div>

          {/* Скроллируемая область таймлайна */}
          <div ref={scrollRef} style={{flex: 1, overflowY: 'auto', position: 'relative', padding: '10px 0'}}>
            
            {/* Сетка часов (00:00 - 23:00) */}
            {Array.from({length: 24}).map((_, hour) => (
              <div key={hour} style={{height: `${HOUR_HEIGHT}px`, position: 'relative', display: 'flex'}}>
                <div style={{width: '50px', textAlign: 'right', paddingRight: '10px', fontSize: '12px', color: '#999', transform: 'translateY(-6px)'}}>
                  {`${hour}:00`}
                </div>
                <div style={{flex: 1, borderTop: '1px solid #f0f0f0'}}></div>
              </div>
            ))}

            {/* Свободные окна - зелёные блоки */}
            {freeSlots.map((slot, idx) => {
              const top = (slot.startMinutes / 60) * HOUR_HEIGHT + 10;
              const height = ((slot.endMinutes - slot.startMinutes) / 60) * HOUR_HEIGHT;

              return (
                <div 
                  key={`free-${idx}`}
                  onClick={() => handleSelectFreeWindow(slot)}
                  style={{
                    position: 'absolute',
                    top: `${top}px`,
                    left: '60px',
                    right: '10px',
                    height: `${height}px`,
                    minHeight: '20px',
                    background: '#C8E6C9',
                    borderLeft: '4px solid #4CAF50',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    overflow: 'hidden',
                    fontSize: '12px',
                    zIndex: 2,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center'
                  }}
                >
                  <div style={{
                    fontWeight: '600', 
                    color: '#2E7D32', 
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis'
                  }}>
                    Свободно
                  </div>
                  <div style={{
                    color: '#388E3C', 
                    fontSize: '11px',
                    whiteSpace: 'nowrap'
                  }}>
                    {slot.start} — {slot.end}
                  </div>
                </div>
              );
            })}

            {freeSlots.length === 0 && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center',
                color: '#888',
                fontSize: '14px'
              }}>
                Нет свободных окон на этот день
              </div>
            )}
          </div>
        </div>
      );
    }

    // Обычный режим
    // Для начальников скрываем расписание, встречи и задания (данные загружены для расчёта окон, но не отображаются)
    const isManagerSelected = selectedEmployee?.isManager === true;
    const workIntervals = isManagerSelected ? [] : getWorkIntervalsForDate(selectedDate);
    const dayMeetings = isManagerSelected ? [] : getMeetingsForDate(selectedDate);
    const dayTaskSegments = isManagerSelected ? [] : getTaskSegmentsForDate(selectedDate);

    return (
      <div style={{flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden'}}>
        {/* Верхняя панель модалки */}
        <div style={{padding: '16px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: isManagerSelected ? '#FFF9C4' : '#fff', zIndex: 10}}>
          <button onClick={() => setShowModal(false)} style={{border: 'none', background: 'none', fontSize: '16px', color: '#007AFF'}}>Закрыть</button>
          <span style={{fontWeight: '600', fontSize: '17px'}}>
            {selectedDate.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'})}
          </span>
          <div style={{width: 24}}></div>
        </div>

        {/* Информация о скрытии данных начальника */}
        {isManagerSelected && (
          <div style={{padding: '12px 16px', background: '#FFF9C4', borderBottom: '1px solid #FFD54F'}}>
            <span style={{fontSize: '13px', color: '#F57F17'}}>
              Расписание и встречи начальника скрыты. Данные учитываются при расчёте свободных окон.
            </span>
          </div>
        )}

        {/* Скроллируемая область таймлайна */}
        <div ref={scrollRef} style={{flex: 1, overflowY: 'auto', position: 'relative', padding: '10px 0'}}>
          
          {/* Сетка часов (00:00 - 23:00) */}
          {Array.from({length: 24}).map((_, hour) => {
            // Проверяем, можно ли кликнуть на этот час (только будущее время)
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const selectedDay = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate());
            const isPastDay = selectedDay < today;
            const isCurrentDay = selectedDay.getTime() === today.getTime();
            const currentHour = now.getHours();
            const isPastHour = isCurrentDay && hour <= currentHour;
            const isClickable = !isPastDay && !isPastHour;
            
            return (
              <div 
                key={hour} 
                style={{
                  height: `${HOUR_HEIGHT}px`, 
                  position: 'relative', 
                  display: 'flex', 
                  cursor: isClickable ? 'pointer' : 'default'
                }}
                onClick={() => {
                  if (!isClickable) return;
                  // Показываем попап создания встречи
                  setCreateMeetingPopup({
                    hour,
                    participant: selectedEmployee ? {
                      username: selectedEmployee.username,
                      fullname: selectedEmployee.fullname,
                      id: selectedEmployee.id,
                      isManager: selectedEmployee.isManager
                    } : null
                  });
                }}
              >
                {/* Время слева */}
                <div style={{width: '50px', textAlign: 'right', paddingRight: '10px', fontSize: '12px', color: '#999', transform: 'translateY(-6px)'}}>
                  {`${hour}:00`}
                </div>
                {/* Линия */}
                <div style={{flex: 1, borderTop: '1px solid #f0f0f0'}}></div>
              </div>
            );
          })}

          {/* Рабочие часы - серый фон (z-index: 1, под встречами) - скрыты для начальников */}
          {workIntervals.map((interval, idx) => {
            const startMinutes = timeToMinutes(interval.start);
            const endMinutes = timeToMinutes(interval.end);
            const top = (startMinutes / 60) * HOUR_HEIGHT + 10;
            const height = ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT;

            return (
              <div 
                key={`work-${idx}`}
                style={{
                  position: 'absolute',
                  top: `${top}px`,
                  left: '60px',
                  right: '10px',
                  height: `${height}px`,
                  background: '#E0E0E0',
                  borderRadius: '4px',
                  zIndex: 1,
                  opacity: 0.5,
                  pointerEvents: 'none'
                }}
              />
            );
          })}

          {/* Красная линия текущего времени (только если сегодня) */}
          {isToday && (
            <div style={{
              position: 'absolute',
              top: `${(nowMinutes / 60) * HOUR_HEIGHT + 10}px`,
              left: '50px',
              right: 0,
              height: '2px',
              background: '#FF3B30',
              zIndex: 5,
              pointerEvents: 'none'
            }}>
              <div style={{
                width: '8px', height: '8px', background: '#FF3B30', borderRadius: '50%', 
                position: 'absolute', left: '-4px', top: '-3px'
              }} />
            </div>
          )}

          {/* Встречи - синие блоки (z-index зависит от времени начала: позже = выше) - скрыты для начальников */}
          {dayMeetings.map((meeting) => {
            if (!meeting.time) return null;
            const meetingDate = new Date(meeting.time);
            const meetingStartMinutes = meetingDate.getHours() * 60 + meetingDate.getMinutes();
            const duration = meeting.duration || 40;
            const meetingEndMinutes = meetingStartMinutes + duration;
            // z-index: базовый 2 + смещение по времени (позже начинается = выше отображается)
            const meetingZIndex = 2 + meetingStartMinutes;

            // Находим пересечения с задачами и разбиваем на визуальные сегменты
            const overlaps = findOverlapsWithTasks(meetingStartMinutes, meetingEndMinutes, dayTaskSegments);
            const visualSegments = splitIntoVisualSegments(meetingStartMinutes, meetingEndMinutes, overlaps);
            
            // Общая высота встречи для определения, показывать ли подробности
            const totalHeight = (duration / 60) * HOUR_HEIGHT;

            return visualSegments.map((vs, segIdx) => {
              const segmentTop = (vs.startMinutes / 60) * HOUR_HEIGHT + 10;
              const segmentHeight = ((vs.endMinutes - vs.startMinutes) / 60) * HOUR_HEIGHT;
              
              // Для пересечения - левая половина (ширина = 50% - 35px), иначе полная ширина
              // Левый отступ 60px, правый 10px. При 50/50: каждая часть = (100% - 70px) / 2 = 50% - 35px
              const leftStyle = '60px';
              const widthStyle = vs.isOverlap ? 'calc(50% - 35px)' : undefined;
              const rightStyle = vs.isOverlap ? undefined : '10px';
              
              // Определяем borderRadius для сегмента (только верхние углы у первого, нижние у последнего)
              const isFirstSegment = segIdx === 0;
              const isLastSegment = segIdx === visualSegments.length - 1;
              const borderRadius = isFirstSegment && isLastSegment 
                ? '4px' 
                : isFirstSegment 
                  ? '4px 4px 0 0' 
                  : isLastSegment 
                    ? '0 0 4px 4px' 
                    : '0';
              
              // Смещение текста: сколько пикселей от начала встречи до начала этого сегмента
              const textOffsetMinutes = vs.startMinutes - meetingStartMinutes;
              const textOffsetPx = (textOffsetMinutes / 60) * HOUR_HEIGHT;
              
              // boxShadow только на первом сегменте чтобы не создавать визуальные полосы
              const segmentBoxShadow = isFirstSegment ? '0 1px 3px rgba(0,0,0,0.1)' : 'none';

              return (
                <div 
                  key={`meeting-${meeting.id}-seg-${segIdx}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedMeeting(meeting);
                  }}
                  style={{
                    position: 'absolute',
                    top: `${segmentTop}px`,
                    left: leftStyle,
                    right: rightStyle,
                    width: widthStyle,
                    height: `${segmentHeight}px`,
                    minHeight: '2px',
                    background: '#E3F2FD',
                    borderLeft: '4px solid #2196F3',
                    borderRadius: borderRadius,
                    padding: '0',
                    overflow: 'hidden',
                    fontSize: '12px',
                    zIndex: meetingZIndex,
                    boxShadow: segmentBoxShadow,
                    cursor: 'pointer',
                    boxSizing: 'border-box'
                  }}
                >
                  {/* Текстовый блок, смещённый вверх чтобы "течь" через сегменты */}
                  <div style={{
                    position: 'relative',
                    top: `-${textOffsetPx}px`,
                    height: `${totalHeight}px`,
                    padding: '4px 8px',
                    boxSizing: 'border-box'
                  }}>
                    <div style={{
                      fontWeight: '600', 
                      color: '#1565C0', 
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {meeting.topic}
                    </div>
                    {totalHeight >= 36 && (
                      <div style={{
                        color: '#1976D2', 
                        fontSize: '11px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {meetingDate.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} • {duration} мин
                      </div>
                    )}
                  </div>
                </div>
              );
            });
          })}

          {/* Задания - красные блоки (z-index зависит от времени начала: позже = выше) */}
          {dayTaskSegments.map((segment, taskIdx) => {
            const { task, dayStartMinutes, dayEndMinutes, isStart, isEnd } = segment;
            // z-index: базовый 2 + смещение по времени (позже начинается = выше отображается)
            const taskZIndex = 2 + dayStartMinutes;
            const taskDuration = dayEndMinutes - dayStartMinutes;
            
            // Форматируем время для отображения
            const formatMinutes = (mins: number) => {
              const h = Math.floor(mins / 60);
              const m = mins % 60;
              return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
            };

            // Находим пересечения со встречами и разбиваем на визуальные сегменты
            const overlaps = findOverlapsWithMeetings(dayStartMinutes, dayEndMinutes, dayMeetings);
            const visualSegments = splitIntoVisualSegments(dayStartMinutes, dayEndMinutes, overlaps);
            
            // Общая высота задачи для определения, показывать ли подробности
            const totalHeight = (taskDuration / 60) * HOUR_HEIGHT;

            return visualSegments.map((vs, segIdx) => {
              const segmentTop = (vs.startMinutes / 60) * HOUR_HEIGHT + 10;
              const segmentHeight = ((vs.endMinutes - vs.startMinutes) / 60) * HOUR_HEIGHT;
              
              // Для пересечения - правая половина (от середины до правого края)
              // Середина: 60px + (100% - 70px) / 2 = 50% + 25px
              const leftStyle = vs.isOverlap ? 'calc(50% + 25px)' : '60px';
              const rightStyle = '10px';
              
              // borderLeft для всех сегментов задачи
              const showBorderLeft = true;
              
              // Определяем borderRadius с учётом многодневных заданий и визуальных сегментов
              const isFirstVisualSegment = segIdx === 0;
              const isLastVisualSegment = segIdx === visualSegments.length - 1;
              
              // Верхние углы скруглены если это начало задания И первый визуальный сегмент
              const topRadius = (isStart && isFirstVisualSegment) ? '4px' : '0';
              // Нижние углы скруглены если это конец задания И последний визуальный сегмент
              const bottomRadius = (isEnd && isLastVisualSegment) ? '4px' : '0';
              const borderRadius = `${topRadius} ${topRadius} ${bottomRadius} ${bottomRadius}`;
              
              // Смещение текста: сколько пикселей от начала задачи до начала этого сегмента
              const textOffsetMinutes = vs.startMinutes - dayStartMinutes;
              const textOffsetPx = (textOffsetMinutes / 60) * HOUR_HEIGHT;
              
              // boxShadow только на первом сегменте чтобы не создавать визуальные полосы
              const segmentBoxShadow = isFirstVisualSegment ? '0 1px 3px rgba(0,0,0,0.1)' : 'none';

              return (
                <div 
                  key={`task-${task.id}-${taskIdx}-seg-${segIdx}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedTask(task);
                  }}
                  style={{
                    position: 'absolute',
                    top: `${segmentTop}px`,
                    left: leftStyle,
                    right: rightStyle,
                    height: `${segmentHeight}px`,
                    minHeight: '2px',
                    background: '#FFEBEE',
                    borderLeft: showBorderLeft ? '4px solid #F44336' : 'none',
                    borderRadius: borderRadius,
                    padding: '0',
                    overflow: 'hidden',
                    fontSize: '12px',
                    zIndex: taskZIndex,
                    boxShadow: segmentBoxShadow,
                    cursor: 'pointer',
                    boxSizing: 'border-box'
                  }}
                >
                  {/* Текстовый блок, смещённый вверх чтобы "течь" через сегменты */}
                  <div style={{
                    position: 'relative',
                    top: `-${textOffsetPx}px`,
                    height: `${totalHeight}px`,
                    padding: '4px 8px',
                    boxSizing: 'border-box'
                  }}>
                    <div style={{
                      fontWeight: '600', 
                      color: '#C62828', 
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {!isStart && '↓ '}{task.description || 'Задание'}{!isEnd && ' →'}
                    </div>
                    {totalHeight >= 36 && (
                      <div style={{
                        color: '#D32F2F', 
                        fontSize: '11px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {formatMinutes(dayStartMinutes)} — {formatMinutes(dayEndMinutes)} ({taskDuration} мин)
                      </div>
                    )}
                  </div>
                </div>
              );
            });
          })}

        </div>
      </div>
    );
  };

  // --- Основной UI ---
  const firstDayIndex = getFirstDayOfMonth(year, month);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const filteredEmployees = subordinates.filter(e => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return e.fullname.toLowerCase().includes(q) || e.username.toLowerCase().includes(q);
  });

  // Обработка выхода из режима свободных окон (кнопка "Отмена")
  const handleExitFreeWindowsMode = () => {
    // Для режима заданий - сохраняем черновик и выходим в обычный календарь
    if (freeWindowsData?.type === "task") {
      // Сохраняем черновик задания в taskFormDraftCache (аналогично встречам)
      if (freeWindowsData.taskDraft) {
        saveTaskFormDraft({
          selectedAssigneeIds: freeWindowsData.taskDraft.assigneeIds,
          time: freeWindowsData.taskDraft.time,
          duration: String(freeWindowsData.taskDraft.duration),
          description: freeWindowsData.taskDraft.description,
          editId: freeWindowsData.taskDraft.editId ?? null,
          origDescription: freeWindowsData.taskDraft.origDescription,
          origTime: freeWindowsData.taskDraft.origTime,
          origDuration: freeWindowsData.taskDraft.origDuration,
          origAssigneeIds: freeWindowsData.taskDraft.origAssigneeIds,
        });
      }
      
      setFreeWindowsMode(false);
      setFreeWindowsKey(null);
      setFreeWindowsData(null);
      setActiveFreeWindowsKey(null);
      window.location.hash = "#/calendar";
      return;
    }
    
    // Для режима встреч - сохраняем данные встречи в meetingFormDraftCache перед выходом
    if (freeWindowsData?.meetingDraft) {
      const draft = freeWindowsData.meetingDraft;
      saveMeetingFormDraft({
        topic: draft.topic,
        memberIds: draft.memberIds,
        time: draft.time ?? "", // Сохраняем введённое время
        duration: String(draft.duration),
        link: draft.link,
        editId: draft.editId ?? null,
        origTopic: draft.origTopic,
        origMemberIds: draft.origMemberIds,
        origTime: draft.origTime,
        origDuration: draft.origDuration,
        origLink: draft.origLink,
      });
    }
    
    setFreeWindowsMode(false);
    setFreeWindowsKey(null);
    setFreeWindowsData(null);
    setActiveFreeWindowsKey(null);
    window.location.hash = "#/calendar";
  };

  return (
    <div style={{ padding: '20px', maxWidth: '600px', margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Режим свободных окон - специальный заголовок */}
      {freeWindowsMode ? (
        <>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px'}}>
            {/* Кнопка возврата: Задание для type=task, Встречи для type=meeting */}
            {freeWindowsData?.type === "task" ? (
              <button
                onClick={handleGoToTask}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#007AFF',
                  fontSize: '14px',
                  cursor: 'pointer',
                  padding: 0,
                  fontWeight: 500,
                }}
              >
                Задание
              </button>
            ) : (
              <button
                onClick={handleGoToMeetings}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#007AFF',
                  fontSize: '14px',
                  cursor: 'pointer',
                  padding: 0,
                  fontWeight: 500,
                }}
              >
                Встречи
              </button>
            )}
            <h2 style={{margin: 0, fontSize: '22px', fontWeight: '700', color: '#2E7D32'}}>Свободные окна</h2>
            <button
              onClick={handleExitFreeWindowsMode}
              style={{
                background: 'none',
                border: 'none',
                color: '#FF3B30',
                fontSize: '14px',
                cursor: 'pointer',
                padding: 0,
                fontWeight: 500,
              }}
            >
              Отмена
            </button>
          </div>
          <div style={{
            background: '#E8F5E9',
            borderRadius: '10px',
            padding: '12px 16px',
            marginBottom: '20px',
            border: '1px solid #C8E6C9'
          }}>
            <p style={{margin: 0, color: '#1B5E20', fontSize: '14px'}}>
              Выберите подходящее время для {freeWindowsData?.type === "task" ? "задания" : "встречи"} длительностью {freeWindowsDuration} мин.
              Зелёные точки показывают дни со свободными окнами.
            </p>
          </div>
        </>
      ) : (
        <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
          <button
            onClick={handleGoToMeetings}
            style={{
              background: 'none',
              border: 'none',
              color: '#007AFF',
              fontSize: '14px',
              cursor: 'pointer',
              padding: 0,
              fontWeight: 500,
            }}
          >
            Встречи
          </button>
          <h2 style={{margin: 0, fontSize: '22px', fontWeight: '700', color: selectedEmployee?.isManager ? '#F57F17' : undefined}}>{selectedEmployee ? selectedEmployee.fullname : "Мой календарь"}</h2>
          <button
            onClick={handleGoToTasks}
            style={{
              background: 'none',
              border: 'none',
              color: '#007AFF',
              fontSize: '14px',
              cursor: 'pointer',
              padding: 0,
              fontWeight: 500,
            }}
          >
            Задания
          </button>
        </div>
      )}
      
      {/* Поиск (скрыт в режиме свободных окон) */}
      {!freeWindowsMode && (
        <div style={{display: 'flex', gap: '10px', marginBottom: '20px', position: 'relative'}}>
          <div style={{flex: 1, position: 'relative'}}>
            <span style={{position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '16px', pointerEvents: 'none', zIndex: 1}}>🔍</span>
            <input 
              type="text" 
              placeholder="Сотрудник..." 
              value={searchQuery} 
              onChange={(e) => setSearchQuery(e.target.value)} 
              onFocus={() => setIsSearchFocused(true)} 
              style={{width: '100%', padding: '10px 32px 10px 36px', borderRadius: '10px', border: '1px solid #ddd', background: '#f5f5f5', outline: 'none', boxSizing: 'border-box'}} 
            />
            {searchQuery && (
              <button 
                onClick={() => {setSearchQuery(""); setIsSearchFocused(false);}}
                style={{position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '16px', color: '#999', lineHeight: 1}}
              >
                ✕
              </button>
            )}
          </div>
          <button onClick={() => {setSelectedEmployee(null); setSearchQuery("")}} style={{background: selectedEmployee ? '#ddd' : '#40d0b0', color: selectedEmployee ? '#333' : '#fff', border: 'none', borderRadius: '10px', padding: '0 15px', fontWeight: '600'}}>Моё</button>
          
          {isSearchFocused && searchQuery && (
            <div style={{position: 'absolute', top: '100%', left: 0, right: 70, background: 'white', zIndex: 10, border: '1px solid #eee', borderRadius: '10px', maxHeight: '200px', overflow: 'auto', boxShadow: '0 4px 10px rgba(0,0,0,0.1)'}}>
              {filteredEmployees.length > 0 ? (
                filteredEmployees.map(e => (
                  <div 
                    key={e.id} 
                    onClick={() => {setSelectedEmployee(e); setSearchQuery(`${e.username} — ${e.fullname}`); setIsSearchFocused(false)}} 
                    style={{
                      padding: '10px', 
                      borderBottom: '1px solid #eee', 
                      cursor: 'pointer',
                      ...(e.isManager ? { background: '#FFF9C4' } : {})
                    }}
                  >
                    {e.username} — {e.fullname}
                  </div>
                ))
              ) : (
                <p style={{padding: '10px', color: '#888', margin: 0}}>Совпадений нет</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Календарь Сетка */}
      <div style={{background: '#fff', borderRadius: '20px', padding: '15px', boxShadow: '0 2px 15px rgba(0,0,0,0.05)'}}>
        <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '15px', alignItems: 'center'}}>
          <button onClick={() => setCurrentDate(new Date(year, month - 1, 1))} style={{border: 'none', background: 'none', fontSize: '18px'}}>◀</button>
          <span style={{fontWeight: 'bold', textTransform: 'capitalize'}}>{currentDate.toLocaleDateString('ru-RU', {month: 'long', year: 'numeric'})}</span>
          <button onClick={() => setCurrentDate(new Date(year, month + 1, 1))} style={{border: 'none', background: 'none', fontSize: '18px'}}>▶</button>
        </div>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '5px'}}>
          {['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(d => <div key={d} style={{textAlign: 'center', fontSize: '12px', color: '#888', marginBottom: '5px'}}>{d}</div>)}
          {Array(firstDayIndex).fill(0).map((_,i) => <div key={`e-${i}`}/>)}
          {Array(daysInMonth).fill(0).map((_, i) => {
             const d = i + 1;
             const dayDate = new Date(year, month, d);
             const isToday = new Date().toDateString() === dayDate.toDateString();
             
             // В режиме свободных окон показываем только зелёные точки
             if (freeWindowsMode) {
               const hasFreeWindow = hasFreeWindowForDate(dayDate);
               return (
                 <div key={d} onClick={() => openDay(d)} style={{aspectRatio: '1', borderRadius: '10px', background: isToday ? '#40d0b0' : '#f5f5f5', color: isToday?'#fff':'#333', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'}}>
                   <span style={{fontWeight: '600'}}>{d}</span>
                   <div style={{display: 'flex', gap: '3px', marginTop: '3px'}}>
                     {hasFreeWindow && <div style={{width: '5px', height: '5px', borderRadius: '50%', background: isToday ? '#fff' : '#4CAF50'}}/>}
                   </div>
                 </div>
               );
             }
             
             // Обычный режим
             // Для начальников не показываем точки (их данные скрыты)
             const isManagerSelected = selectedEmployee?.isManager === true;
             const hasSchedule = !isManagerSelected && hasScheduleForDate(dayDate);
             const hasMeetings = !isManagerSelected && hasMeetingsForDate(dayDate);
             const hasTasks = !isManagerSelected && hasTasksForDate(dayDate);
             return (
               <div key={d} onClick={() => openDay(d)} style={{aspectRatio: '1', borderRadius: '10px', background: isToday ? '#40d0b0' : '#f5f5f5', color: isToday?'#fff':'#333', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'}}>
                 <span style={{fontWeight: '600'}}>{d}</span>
                 <div style={{display: 'flex', gap: '3px', marginTop: '3px'}}>
                   {hasSchedule && <div style={{width: '5px', height: '5px', borderRadius: '50%', background: isToday ? 'rgba(255,255,255,0.7)' : '#9E9E9E'}}/>}
                   {hasMeetings && <div style={{width: '5px', height: '5px', borderRadius: '50%', background: isToday ? '#fff' : '#2196F3'}}/>}
                   {hasTasks && <div style={{width: '5px', height: '5px', borderRadius: '50%', background: isToday ? '#FFCDD2' : '#F44336'}}/>}
                 </div>
               </div>
             )
          })}
        </div>
      </div>

      {/* FULLSCREEN MODAL */}
      {showModal && (
        <div style={{position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#fff', zIndex: 9999, display: 'flex', flexDirection: 'column'}}>
          {renderTimeline()}
        </div>
      )}

      {/* MEETING DETAIL POPUP */}
      {selectedMeeting && (
        <div 
          style={{
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            background: 'rgba(0, 0, 0, 0.5)', 
            zIndex: 10000, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            padding: '60px 16px'
          }}
          onClick={() => setSelectedMeeting(null)}
        >
          <div 
            style={{
              background: '#fff',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '400px',
              maxHeight: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexShrink: 0
            }}>
              <button 
                onClick={() => setSelectedMeeting(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  color: '#999',
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1
                }}
              >
                ✕
              </button>
              <span style={{fontWeight: '600', fontSize: '17px', color: '#333'}}>Встреча</span>
            </div>

            {/* Scrollable Content */}
            <div style={{
              padding: '20px',
              overflowY: 'auto',
              flex: 1
            }}>
              {/* Topic */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Тема</div>
                <div style={{fontSize: '16px', fontWeight: '600', color: '#333'}}>{selectedMeeting.topic}</div>
              </div>

              {/* Time */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Время</div>
                <div style={{fontSize: '15px', color: '#333'}}>
                  {selectedMeeting.time && (
                    <>
                      {new Date(selectedMeeting.time).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                      <br />
                      {new Date(selectedMeeting.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                      {' — '}
                      {getEndTime(selectedMeeting.time, selectedMeeting.duration || 40)}
                      <span style={{color: '#888', marginLeft: '8px'}}>
                        ({selectedMeeting.duration || 40} мин)
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Creator */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Создатель</div>
                <div style={{fontSize: '15px', color: '#333'}}>{selectedMeeting.creator_name || '—'}</div>
              </div>

              {/* Participants */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>
                  Участники ({selectedMeeting.participants?.length || 0})
                </div>
                <div style={{display: 'flex', flexDirection: 'column', gap: '8px'}}>
                  {(selectedMeeting.participants || []).map((participant, idx) => (
                    <div 
                      key={idx}
                      style={{
                        padding: '10px 12px',
                        background: '#f5f5f5',
                        borderRadius: '8px',
                        fontSize: '14px',
                        color: '#333'
                      }}
                    >
                      {participant.fullname || participant.username}
                    </div>
                  ))}
                </div>
              </div>

              {/* Link */}
              {selectedMeeting.link && (
                <div>
                  <div style={{fontSize: '12px', color: '#888', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Ссылка</div>
                  <a 
                    href={selectedMeeting.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'block',
                      padding: '12px 16px',
                      background: '#E3F2FD',
                      borderRadius: '10px',
                      color: '#1976D2',
                      textDecoration: 'none',
                      fontWeight: '500',
                      textAlign: 'center'
                    }}
                  >
                    Перейти к звонку
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TASK DETAIL POPUP */}
      {selectedTask && (
        <div 
          style={{
            position: 'fixed', 
            top: 0, 
            left: 0, 
            right: 0, 
            bottom: 0, 
            background: 'rgba(0, 0, 0, 0.5)', 
            zIndex: 10000, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            padding: '60px 16px'
          }}
          onClick={() => setSelectedTask(null)}
        >
          <div 
            style={{
              background: '#fff',
              borderRadius: '16px',
              width: '100%',
              maxWidth: '400px',
              maxHeight: '100%',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{
              padding: '16px 20px',
              borderBottom: '1px solid #FFCDD2',
              background: '#FFEBEE',
              borderRadius: '16px 16px 0 0',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              flexShrink: 0
            }}>
              <button 
                onClick={() => setSelectedTask(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  color: '#C62828',
                  cursor: 'pointer',
                  padding: 0,
                  lineHeight: 1
                }}
              >
                ✕
              </button>
              <span style={{fontWeight: '600', fontSize: '17px', color: '#C62828'}}>Задание</span>
            </div>

            {/* Scrollable Content */}
            <div style={{
              padding: '20px',
              overflowY: 'auto',
              flex: 1
            }}>
              {/* Description */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Описание</div>
                <div style={{fontSize: '16px', fontWeight: '600', color: '#333'}}>{selectedTask.description || '—'}</div>
              </div>

              {/* Time */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Время</div>
                <div style={{fontSize: '15px', color: '#333'}}>
                  {selectedTask.time && (
                    <>
                      {new Date(selectedTask.time).toLocaleDateString('ru-RU', {
                        day: 'numeric',
                        month: 'long',
                        year: 'numeric'
                      })}
                      <br />
                      {new Date(selectedTask.time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                      {' — '}
                      {getEndTime(selectedTask.time, selectedTask.duration || 40)}
                      <span style={{color: '#888', marginLeft: '8px'}}>
                        ({selectedTask.duration || 40} мин)
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Creator (Assigner) */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Создатель</div>
                <div style={{fontSize: '15px', color: '#333'}}>{selectedTask.assigner_fullname || selectedTask.assigner_username || '—'}</div>
              </div>

              {/* Executors (Assignees) */}
              <div style={{marginBottom: '20px'}}>
                <div style={{fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>
                  {selectedTask.assignees && selectedTask.assignees.length > 1 ? 'Исполнители' : 'Исполнитель'}
                </div>
                <div style={{fontSize: '15px', color: '#333'}}>
                  {selectedTask.assignees && selectedTask.assignees.length > 0
                    ? selectedTask.assignees.map(a => a.fullname || a.username).join(', ')
                    : (selectedTask.assignee_fullname || selectedTask.assignee_username || '—')
                  }
                </div>
              </div>

              {/* Created At */}
              {selectedTask.created_at && (
                <div>
                  <div style={{fontSize: '12px', color: '#888', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px'}}>Создано</div>
                  <div style={{fontSize: '14px', color: '#666'}}>
                    {new Date(selectedTask.created_at).toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CREATE/RESCHEDULE MEETING POPUP */}
      {createMeetingPopup && selectedDate && (() => {
        // Получаем черновик для проверки режима редактирования
        const draft = getMeetingFormDraft();
        const isEditMode = draft?.editId != null;
        const meetingTopic = draft?.topic || '';
        const meetingDuration = draft?.duration || '';
        const originalTime = draft?.origTime || draft?.time || '';
        
        // Форматируем оригинальное время
        let originalTimeFormatted = '';
        if (originalTime) {
          const origDate = new Date(originalTime);
          if (!isNaN(origDate.getTime())) {
            originalTimeFormatted = `${origDate.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'})}, ${origDate.toLocaleTimeString('ru-RU', {hour: '2-digit', minute: '2-digit'})}`;
          }
        }
        
        // Форматируем новое время
        const newTimeFormatted = `${selectedDate.toLocaleDateString('ru-RU', {day: 'numeric', month: 'long'})}, ${String(createMeetingPopup.hour).padStart(2, '0')}:00`;
        
        return (
          <div 
            style={{
              position: 'fixed', 
              top: 0, 
              left: 0, 
              right: 0, 
              bottom: 0, 
              background: 'rgba(0, 0, 0, 0.5)', 
              zIndex: 10001, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              padding: '20px'
            }}
            onClick={() => setCreateMeetingPopup(null)}
          >
            <div 
              style={{
                background: '#fff',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '340px',
                padding: '24px',
                boxShadow: '0 10px 40px rgba(0,0,0,0.2)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 style={{margin: '0 0 16px 0', fontSize: '18px', fontWeight: '600', color: '#333', textAlign: 'center'}}>
                {isEditMode 
                  ? 'Желаете перенести встречу?' 
                  : (createMeetingPopup.participant && createMeetingPopup.participant.isManager !== true
                    ? 'Создать встречу или назначить задание?'
                    : 'Желаете создать встречу?')}
              </h3>
              
              {/* В режиме редактирования показываем тему */}
              {isEditMode && meetingTopic && (
                <div style={{marginBottom: '16px', padding: '12px', background: '#FFF3E0', borderRadius: '10px'}}>
                  <div style={{fontSize: '13px', color: '#E65100', marginBottom: '4px'}}>Тема</div>
                  <div style={{fontSize: '15px', fontWeight: '600', color: '#E65100'}}>
                    {meetingTopic}
                  </div>
                </div>
              )}
              
              {/* В режиме редактирования показываем С / На */}
              {isEditMode && originalTimeFormatted ? (
                <>
                  <div style={{marginBottom: '12px', padding: '12px', background: '#FFEBEE', borderRadius: '10px'}}>
                    <div style={{fontSize: '13px', color: '#C62828', marginBottom: '4px'}}>С</div>
                    <div style={{fontSize: '15px', fontWeight: '600', color: '#C62828'}}>
                      {originalTimeFormatted}
                    </div>
                  </div>
                  <div style={{marginBottom: '16px', padding: '12px', background: '#E8F5E9', borderRadius: '10px'}}>
                    <div style={{fontSize: '13px', color: '#2E7D32', marginBottom: '4px'}}>На</div>
                    <div style={{fontSize: '15px', fontWeight: '600', color: '#2E7D32'}}>
                      {newTimeFormatted}
                    </div>
                  </div>
                </>
              ) : (
                <div style={{marginBottom: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '10px'}}>
                  <div style={{fontSize: '13px', color: '#888', marginBottom: '4px'}}>Время начала</div>
                  <div style={{fontSize: '16px', fontWeight: '600', color: '#333'}}>
                    {newTimeFormatted}
                  </div>
                </div>
              )}
              
              {/* Продолжительность (в режиме редактирования) */}
              {isEditMode && meetingDuration && (
                <div style={{marginBottom: '16px', padding: '12px', background: '#f5f5f5', borderRadius: '10px'}}>
                  <div style={{fontSize: '13px', color: '#888', marginBottom: '4px'}}>Продолжительность</div>
                  <div style={{fontSize: '15px', fontWeight: '600', color: '#333'}}>
                    {meetingDuration} мин.
                  </div>
                </div>
              )}

              {createMeetingPopup.participant && (
                <div style={{marginBottom: '16px', padding: '12px', background: '#E3F2FD', borderRadius: '10px'}}>
                  <div style={{fontSize: '13px', color: '#1565C0', marginBottom: '4px'}}>
                    {createMeetingPopup.participant.isManager !== true && !isEditMode ? 'Сотрудник' : 'И приглашенным участником'}
                  </div>
                  <div style={{fontSize: '15px', fontWeight: '600', color: '#1976D2'}}>
                    {createMeetingPopup.participant.username}
                  </div>
                  <div style={{fontSize: '14px', color: '#1976D2'}}>
                    {createMeetingPopup.participant.fullname}
                  </div>
                </div>
              )}

              {/* Определяем, показывать ли кнопку задания (только для подчиненных, не в режиме редактирования) */}
              {(() => {
                const canAssignTask = createMeetingPopup.participant && 
                                      createMeetingPopup.participant.isManager !== true && 
                                      !isEditMode;
                
                if (canAssignTask) {
                  // 3 кнопки: Создать встречу, Назначить задание, Отмена
                  return (
                    <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                      <button
                        onClick={() => {
                          // Формируем дату и время для встречи
                          const y = selectedDate.getFullYear();
                          const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
                          const d = String(selectedDate.getDate()).padStart(2, '0');
                          const hour = String(createMeetingPopup.hour).padStart(2, '0');
                          const dateStr = `${y}-${m}-${d}`;
                          
                          const existingDraft = getMeetingFormDraft();
                          if (existingDraft) {
                            saveMeetingFormDraft({
                              topic: existingDraft.topic || '',
                              memberIds: existingDraft.memberIds || [],
                              time: existingDraft.time || '',
                              duration: existingDraft.duration || '',
                              link: existingDraft.link || '',
                              editId: existingDraft.editId,
                              origTopic: existingDraft.origTopic,
                              origMemberIds: existingDraft.origMemberIds,
                              origTime: existingDraft.origTime,
                              origDuration: existingDraft.origDuration,
                              origLink: existingDraft.origLink,
                            });
                          }
                          
                          let url = `#/meetings?quickCreate=1&date=${dateStr}&hour=${hour}`;
                          if (createMeetingPopup.participant) {
                            url += `&participantId=${createMeetingPopup.participant.id}`;
                          }
                          
                          setCreateMeetingPopup(null);
                          setShowModal(false);
                          window.location.hash = url;
                        }}
                        style={{
                          width: '100%',
                          padding: '14px',
                          background: '#007AFF',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '10px',
                          fontSize: '16px',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        Создать встречу
                      </button>
                      <button
                        onClick={() => {
                          // Переход в режим создания задания
                          const y = selectedDate.getFullYear();
                          const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
                          const d = String(selectedDate.getDate()).padStart(2, '0');
                          const dateStr = `${y}-${m}-${d}`;
                          const hour = String(createMeetingPopup.hour).padStart(2, '0');
                          const newTime = `${dateStr}T${hour}:00`;
                          
                          const p = createMeetingPopup.participant!;
                          
                          // Сохраняем/обновляем черновик задания перед переходом
                          const existingDraft = getTaskFormDraft();
                          if (existingDraft) {
                            // Есть черновик — мержим: сохраняем описание и продолжительность, обновляем время и добавляем участника
                            const mergedIds = existingDraft.selectedAssigneeIds.includes(p.id)
                              ? existingDraft.selectedAssigneeIds
                              : [...existingDraft.selectedAssigneeIds, p.id];
                            saveTaskFormDraft({
                              selectedAssigneeIds: mergedIds,
                              time: newTime,
                              duration: existingDraft.duration || '40',
                              description: existingDraft.description || '',
                              editId: existingDraft.editId,
                              origDescription: existingDraft.origDescription,
                              origTime: existingDraft.origTime,
                              origDuration: existingDraft.origDuration,
                              origAssigneeIds: existingDraft.origAssigneeIds,
                            });
                          } else {
                            // Нет черновика — создаём новый с данными из календаря
                            saveTaskFormDraft({
                              selectedAssigneeIds: [p.id],
                              time: newTime,
                              duration: '40',
                              description: '',
                              editId: null,
                            });
                          }
                          
                          setCreateMeetingPopup(null);
                          setShowModal(false);
                          window.location.hash = '#/task';
                        }}
                        style={{
                          width: '100%',
                          padding: '14px',
                          background: '#34C759',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '10px',
                          fontSize: '16px',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        Назначить задание
                      </button>
                      <button
                        onClick={() => setCreateMeetingPopup(null)}
                        style={{
                          width: '100%',
                          padding: '14px',
                          background: '#FF3B30',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '10px',
                          fontSize: '16px',
                          fontWeight: '600',
                          cursor: 'pointer'
                        }}
                      >
                        Отмена
                      </button>
                    </div>
                  );
                }
                
                // Обычные 2 кнопки (для начальников или режима редактирования)
                return (
                  <div style={{display: 'flex', gap: '12px'}}>
                    <button
                      onClick={() => setCreateMeetingPopup(null)}
                      style={{
                        flex: 1,
                        padding: '14px',
                        background: '#FFEBEE',
                        color: '#C62828',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '16px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Нет
                    </button>
                    <button
                      onClick={() => {
                        const y = selectedDate.getFullYear();
                        const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
                        const d = String(selectedDate.getDate()).padStart(2, '0');
                        const hour = String(createMeetingPopup.hour).padStart(2, '0');
                        const dateStr = `${y}-${m}-${d}`;
                        
                        const existingDraft = getMeetingFormDraft();
                        if (existingDraft) {
                          saveMeetingFormDraft({
                            topic: existingDraft.topic || '',
                            memberIds: existingDraft.memberIds || [],
                            time: existingDraft.time || '',
                            duration: existingDraft.duration || '',
                            link: existingDraft.link || '',
                            editId: existingDraft.editId,
                            origTopic: existingDraft.origTopic,
                            origMemberIds: existingDraft.origMemberIds,
                            origTime: existingDraft.origTime,
                            origDuration: existingDraft.origDuration,
                            origLink: existingDraft.origLink,
                          });
                        }
                        
                        let url = `#/meetings?quickCreate=1&date=${dateStr}&hour=${hour}`;
                        if (createMeetingPopup.participant) {
                          url += `&participantId=${createMeetingPopup.participant.id}`;
                        }
                        
                        setCreateMeetingPopup(null);
                        setShowModal(false);
                        window.location.hash = url;
                      }}
                      style={{
                        flex: 1,
                        padding: '14px',
                        background: '#4CAF50',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '10px',
                        fontSize: '16px',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Да
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })()}
    </div>
  );
};