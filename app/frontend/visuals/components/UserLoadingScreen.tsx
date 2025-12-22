import React from "react";

interface UserLoadingScreenProps {
  title: string;
  isLoading: boolean;
  loadingMessage?: string;
  error: string | null;
}

const DEFAULT_LOADING_MESSAGE = "Загрузка данных пользователя...";
const DEFAULT_ERROR_MESSAGE = "Не удалось получить данные пользователя. Пожалуйста, откройте приложение через Telegram.";

export const UserLoadingScreen: React.FC<UserLoadingScreenProps> = ({
  title,
  isLoading,
  loadingMessage = DEFAULT_LOADING_MESSAGE,
  error
}) => {
  return (
    <div className="form-page">
      <div className="form-container">
        <h2>{title}</h2>
        <div style={{ textAlign: "center", padding: "2rem", color: isLoading ? "#666" : "crimson" }}>
          {isLoading ? (
            <>
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
              <div>{loadingMessage}</div>
            </>
          ) : (
            <div>{error || DEFAULT_ERROR_MESSAGE}</div>
          )}
        </div>
      </div>
    </div>
  );
};
