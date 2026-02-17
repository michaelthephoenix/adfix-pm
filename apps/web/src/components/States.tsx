type StateProps = {
  message: string;
  onRetry?: () => void;
};

export function LoadingState({ message }: StateProps) {
  return <div className="state-card">{message}</div>;
}

export function ErrorState({ message, onRetry }: StateProps) {
  return (
    <div className="state-card">
      <p>{message}</p>
      {onRetry ? (
        <button type="button" className="ghost-button" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ message }: StateProps) {
  return <div className="state-card">{message}</div>;
}
