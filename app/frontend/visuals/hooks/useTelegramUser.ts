import { useState, useEffect } from 'react';

interface TelegramUser {
  username: string | null;
  tgId: number | null;
  isLoading: boolean;
  error: string | null;
}

export function useTelegramUser(maxRetries = 10, retryDelay = 100): TelegramUser {
  const [username, setUsername] = useState<string | null>(null);
  const [tgId, setTgId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let retryCount = 0;
    let timeoutId: NodeJS.Timeout;

    const tryGetUser = () => {
      const tg = (window as any).Telegram?.WebApp;
      const user = tg?.initDataUnsafe?.user;

      if (user?.username) {
        setUsername(`@${user.username}`);
        setTgId(user.id ? Number(user.id) : null);
        setIsLoading(false);
        return;
      }

      if (user?.id && !user?.username) {
        setUsername(null);
        setTgId(Number(user.id));
        setIsLoading(false);
        setError('У вас не настроен username в Telegram. Пожалуйста, настройте его в настройках Telegram.');
        return;
      }

      retryCount++;
      if (retryCount < maxRetries) {
        timeoutId = setTimeout(tryGetUser, retryDelay * retryCount);
      } else {
        setIsLoading(false);
        setError('Не удалось получить данные пользователя. Пожалуйста, откройте приложение через Telegram.');
      }
    };

    tryGetUser();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [maxRetries, retryDelay]);

  return { username, tgId, isLoading, error };
}
