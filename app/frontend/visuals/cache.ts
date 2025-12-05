// Shared cache module for calendar and meetings data
// This cache persists across component mounts/unmounts (navigation between pages)

// --- Types ---
export interface ScheduleInterval {
  start: string;
  end: string;
}

export interface ScheduleDay {
  day: number;
  intervals: ScheduleInterval[];
}

export interface Participant {
  username: string;
  fullname: string;
  id?: number;
}

export interface Meeting {
  id: number;
  topic: string;
  participants: Participant[];
  member_ids?: number[];
  time: string;
  duration: number | null;
  link: string;
  creator_name?: string;
}

export interface Subordinate {
  id: number;
  username: string;
  fullname: string;
  isManager?: boolean;  // true для непосредственных начальников
}

export interface SubordinatesData {
  managerId: number;
  subordinates: Subordinate[];
}

// --- Cache Storage ---
// Schedule cache: userId -> ScheduleDay[]
const scheduleCache = new Map<number, ScheduleDay[]>();

// Month meetings cache: "userId-year-month" -> Meeting[]
const monthMeetingsCache = new Map<string, Meeting[]>();

// Creator meetings cache: creatorId -> Meeting[]
const creatorMeetingsCache = new Map<number, Meeting[]>();

// Subordinates cache: username -> { managerId, subordinates }
let subordinatesCache: { username: string; data: SubordinatesData } | null = null;

// --- Subordinates Cache (shared between meetings and calendar pages) ---
export const getSubordinatesFromCache = (username: string): SubordinatesData | undefined => {
  if (subordinatesCache && subordinatesCache.username === username) {
    return subordinatesCache.data;
  }
  return undefined;
};

export const setSubordinatesToCache = (username: string, managerId: number, subordinates: Subordinate[]): void => {
  subordinatesCache = {
    username,
    data: { managerId, subordinates: [...subordinates] }
  };
};

// --- Schedule Cache ---
export const getScheduleFromCache = (userId: number): ScheduleDay[] | undefined => {
  return scheduleCache.get(userId);
};

export const setScheduleToCache = (userId: number, schedule: ScheduleDay[]): void => {
  scheduleCache.set(userId, schedule);
};

// --- Month Meetings Cache (for calendar view) ---
export const getMonthMeetingsCacheKey = (userId: number, year: number, month: number): string => {
  return `${userId}-${year}-${month}`;
};

export const getMonthMeetingsFromCache = (userId: number, year: number, month: number): Meeting[] | undefined => {
  const key = getMonthMeetingsCacheKey(userId, year, month);
  const cached = monthMeetingsCache.get(key);
  // Return a COPY to avoid shared references with React state
  return cached ? [...cached] : undefined;
};

export const setMonthMeetingsToCache = (userId: number, year: number, month: number, meetings: Meeting[]): void => {
  const key = getMonthMeetingsCacheKey(userId, year, month);
  // Store a COPY to avoid shared references with React state
  monthMeetingsCache.set(key, [...meetings]);
};

// --- Creator Meetings Cache (for meetings page) ---
export const getCreatorMeetingsFromCache = (creatorId: number): Meeting[] | undefined => {
  const cached = creatorMeetingsCache.get(creatorId);
  // Return a COPY to avoid shared references with React state
  return cached ? [...cached] : undefined;
};

export const setCreatorMeetingsToCache = (creatorId: number, meetings: Meeting[]): void => {
  // Store a COPY to avoid shared references with React state
  creatorMeetingsCache.set(creatorId, [...meetings]);
};

// --- Helper: Extract year and month from meeting time ---
const getYearMonthFromTime = (timeStr: string): { year: number; month: number } => {
  const date = new Date(timeStr);
  return { year: date.getFullYear(), month: date.getMonth() + 1 }; // month is 1-based for cache key
};

// --- Precise Month Meetings Cache Updates ---

/**
 * Add meeting to user's month cache (only if that month is already cached)
 * @returns true if added, false if month wasn't cached
 */
export const addMeetingToMonthCache = (userId: number, meeting: Meeting): boolean => {
  const { year, month } = getYearMonthFromTime(meeting.time);
  const key = getMonthMeetingsCacheKey(userId, year, month);
  const cached = monthMeetingsCache.get(key);
  
  if (!cached) return false; // Month not cached, don't add
  
  // Check if meeting already exists (avoid duplicates)
  if (!cached.some(m => m.id === meeting.id)) {
    cached.push(meeting);
  }
  return true;
};

/**
 * Remove meeting from user's month cache
 */
export const removeMeetingFromMonthCache = (userId: number, meetingId: number, meetingTime: string): void => {
  const { year, month } = getYearMonthFromTime(meetingTime);
  const key = getMonthMeetingsCacheKey(userId, year, month);
  const cached = monthMeetingsCache.get(key);
  
  if (!cached) return;
  
  const index = cached.findIndex(m => m.id === meetingId);
  if (index !== -1) {
    cached.splice(index, 1);
  }
};

/**
 * Update meeting in user's month cache:
 * - Remove old meeting data
 * - Add new meeting data only if the new month is cached
 */
export const updateMeetingInMonthCache = (
  userId: number, 
  oldMeetingId: number, 
  oldTime: string, 
  newMeeting: Meeting
): void => {
  // Remove old meeting
  removeMeetingFromMonthCache(userId, oldMeetingId, oldTime);
  // Add new meeting (only if month is cached)
  addMeetingToMonthCache(userId, newMeeting);
};

// --- Precise Creator Meetings Cache Updates ---

/**
 * Add meeting to creator's meetings cache
 */
export const addMeetingToCreatorCache = (creatorId: number, meeting: Meeting): void => {
  const cached = creatorMeetingsCache.get(creatorId);
  
  if (!cached) return; // Creator cache not initialized, will be fetched on next load
  
  // Check if meeting already exists (avoid duplicates)
  if (!cached.some(m => m.id === meeting.id)) {
    cached.push(meeting);
  }
};

/**
 * Remove meeting from creator's meetings cache
 */
export const removeMeetingFromCreatorCache = (creatorId: number, meetingId: number): void => {
  const cached = creatorMeetingsCache.get(creatorId);
  
  if (!cached) return;
  
  const index = cached.findIndex(m => m.id === meetingId);
  if (index !== -1) {
    cached.splice(index, 1);
  }
};

/**
 * Update meeting in creator's meetings cache
 */
export const updateMeetingInCreatorCache = (
  creatorId: number, 
  meetingId: number, 
  updates: Partial<Meeting>
): void => {
  const cached = creatorMeetingsCache.get(creatorId);
  
  if (!cached) return;
  
  const meeting = cached.find(m => m.id === meetingId);
  if (meeting) {
    Object.assign(meeting, updates);
  }
};

// --- Invalidation functions (kept for compatibility) ---

// Invalidate creator meetings cache
export const invalidateCreatorMeetingsCache = (creatorId: number): void => {
  creatorMeetingsCache.delete(creatorId);
};

// Invalidate all month meetings caches for a specific user
export const invalidateMonthMeetingsCacheForUser = (userId: number): void => {
  for (const key of monthMeetingsCache.keys()) {
    if (key.startsWith(`${userId}-`)) {
      monthMeetingsCache.delete(key);
    }
  }
};

// Invalidate all caches (useful for debugging or force refresh)
export const clearAllCaches = (): void => {
  scheduleCache.clear();
  monthMeetingsCache.clear();
  creatorMeetingsCache.clear();
  subordinatesCache = null;
  freeWindowsCache.clear();
};

// --- Free Windows Cache (for conflict resolution) ---

export interface MeetingDraft {
  topic: string;
  memberIds: number[];
  duration: number;
  link: string;
  time?: string;  // Введённое пользователем время встречи
  creatorId: number;
  creatorUsername: string;
  editId?: number | null;  // ID редактируемой встречи (для режима редактирования)
  // Оригинальные значения встречи (для корректного isEditChanged при возврате с календаря)
  origTopic?: string;
  origMemberIds?: number[];
  origDuration?: string;
  origLink?: string;
  origTime?: string;
}

export interface FreeWindowsData {
  windows: ScheduleDay[];                    // Пересечённое расписание (7 дней)
  meetings: Record<number, Meeting[]>;       // Все встречи участников по worker_id
  meetingDraft: MeetingDraft;                // Черновик встречи
  excludeMeetingId?: number | null;          // ID редактируемой встречи (исключить из расчёта окон)
}

// Ключ: JSON.stringify отсортированных memberIds
const freeWindowsCache = new Map<string, FreeWindowsData>();

/**
 * Генерирует ключ кэша из набора участников
 */
export const getFreeWindowsCacheKey = (memberIds: number[]): string => {
  return JSON.stringify([...memberIds].sort((a, b) => a - b));
};

/**
 * Получает данные свободных окон из кэша
 */
export const getFreeWindowsFromCache = (memberIds: number[]): FreeWindowsData | undefined => {
  const key = getFreeWindowsCacheKey(memberIds);
  const cached = freeWindowsCache.get(key);
  if (!cached) return undefined;
  
  // Возвращаем глубокую копию чтобы избежать мутаций
  return {
    windows: cached.windows.map(w => ({ ...w, intervals: [...w.intervals] })),
    meetings: Object.fromEntries(
      Object.entries(cached.meetings).map(([k, v]) => [k, [...v]])
    ),
    meetingDraft: { 
      ...cached.meetingDraft, 
      memberIds: [...cached.meetingDraft.memberIds],
      origMemberIds: cached.meetingDraft.origMemberIds ? [...cached.meetingDraft.origMemberIds] : undefined
    },
    excludeMeetingId: cached.excludeMeetingId,
  };
};

/**
 * Сохраняет данные свободных окон в кэш
 */
export const setFreeWindowsToCache = (memberIds: number[], data: FreeWindowsData): void => {
  const key = getFreeWindowsCacheKey(memberIds);
  // Сохраняем глубокую копию
  freeWindowsCache.set(key, {
    windows: data.windows.map(w => ({ ...w, intervals: [...w.intervals] })),
    meetings: Object.fromEntries(
      Object.entries(data.meetings).map(([k, v]) => [k, [...v]])
    ),
    meetingDraft: { 
      ...data.meetingDraft, 
      memberIds: [...data.meetingDraft.memberIds],
      origMemberIds: data.meetingDraft.origMemberIds ? [...data.meetingDraft.origMemberIds] : undefined
    },
    excludeMeetingId: data.excludeMeetingId,  // Сохраняем ID встречи для исключения из расчёта окон
  });
};

/**
 * Вычитает созданную встречу из свободных окон в кэше.
 * Добавляет встречу в массив meetings для каждого участника.
 */
export const subtractMeetingFromFreeWindowsCache = (memberIds: number[], meeting: Meeting): void => {
  const key = getFreeWindowsCacheKey(memberIds);
  const cached = freeWindowsCache.get(key);
  if (!cached) return;
  
  // Добавляем или обновляем встречу у каждого участника
  for (const memberId of memberIds) {
    const memberMeetings = cached.meetings[memberId];
    if (memberMeetings) {
      const idx = memberMeetings.findIndex(m => m.id === meeting.id);
      if (idx !== -1) {
        memberMeetings[idx] = meeting; // Обновляем существующую встречу
      } else {
        memberMeetings.push(meeting);
      }
    } else {
      cached.meetings[memberId] = [meeting];
    }
  }
};

/**
 * Проверяет, существует ли кэш для данного набора участников
 */
export const hasFreeWindowsCache = (memberIds: number[]): boolean => {
  const key = getFreeWindowsCacheKey(memberIds);
  return freeWindowsCache.has(key);
};

/**
 * Удаляет кэш свободных окон для набора участников
 */
export const removeFreeWindowsFromCache = (memberIds: number[]): void => {
  const key = getFreeWindowsCacheKey(memberIds);
  freeWindowsCache.delete(key);
};

/**
 * Получает активный ключ кэша окон (для передачи между страницами)
 */
export const getActiveFreeWindowsKey = (): string | null => {
  return activeFreeWindowsKey;
};

/**
 * Устанавливает активный ключ кэша окон
 */
export const setActiveFreeWindowsKey = (key: string | null): void => {
  activeFreeWindowsKey = key;
};

// Активный ключ кэша окон (используется при переходе между страницами)
let activeFreeWindowsKey: string | null = null;

/**
 * Получает данные свободных окон по ключу (для использования в календаре)
 */
export const getFreeWindowsByKey = (key: string): FreeWindowsData | undefined => {
  const cached = freeWindowsCache.get(key);
  if (!cached) return undefined;
  
  return {
    windows: cached.windows.map(w => ({ ...w, intervals: [...w.intervals] })),
    meetings: Object.fromEntries(
      Object.entries(cached.meetings).map(([k, v]) => [k, [...v]])
    ),
    meetingDraft: { 
      ...cached.meetingDraft, 
      memberIds: [...cached.meetingDraft.memberIds],
      origMemberIds: cached.meetingDraft.origMemberIds ? [...cached.meetingDraft.origMemberIds] : undefined
    },
    excludeMeetingId: cached.excludeMeetingId,  // ID редактируемой встречи для исключения
  };
};

// --- Meeting Form Draft Cache (для сохранения формы при переходе в календарь) ---

export interface MeetingFormDraft {
  topic: string;
  memberIds: number[];
  time: string;
  duration: string;
  link: string;
  editId: number | null;
  origTopic?: string;
  origMemberIds?: number[];
  origTime?: string;
  origDuration?: string;
  origLink?: string;
}

let meetingFormDraftCache: MeetingFormDraft | null = null;

export const saveMeetingFormDraft = (draft: MeetingFormDraft): void => {
  meetingFormDraftCache = { ...draft, memberIds: [...draft.memberIds] };
  if (draft.origMemberIds) {
    meetingFormDraftCache.origMemberIds = [...draft.origMemberIds];
  }
};

export const getMeetingFormDraft = (): MeetingFormDraft | null => {
  if (!meetingFormDraftCache) return null;
  return {
    ...meetingFormDraftCache,
    memberIds: [...meetingFormDraftCache.memberIds],
    origMemberIds: meetingFormDraftCache.origMemberIds ? [...meetingFormDraftCache.origMemberIds] : undefined,
  };
};

export const clearMeetingFormDraft = (): void => {
  meetingFormDraftCache = null;
};

