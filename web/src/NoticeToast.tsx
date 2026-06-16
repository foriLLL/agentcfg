export type ToastNotice = {
  readonly tone: 'success' | 'error';
  readonly title: string;
  readonly copy: string;
};

type NoticeToastProps = {
  readonly notice: ToastNotice | null;
  readonly remoteAccessWarning: string | null;
  readonly onDismiss: () => void;
};

export function NoticeToast({ notice, onDismiss, remoteAccessWarning }: NoticeToastProps) {
  if (notice === null && remoteAccessWarning === null) {
    return null;
  }

  return (
    <div className="toast-region" aria-label="页面提示">
      {remoteAccessWarning !== null && (
        <section className="toast toast--error" role="alert" aria-live="polite">
          <span className="toast__indicator" aria-hidden="true" />
          <div className="toast__copy">
            <strong>远程访问警告</strong>
            <span>{remoteAccessWarning}</span>
          </div>
        </section>
      )}
      {notice !== null && (
        <section className={`toast toast--${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
          <span className="toast__indicator" aria-hidden="true" />
          <div className="toast__copy">
            <strong>{notice.title}</strong>
            <span>{notice.copy}</span>
          </div>
          <button className="toast__dismiss" type="button" onClick={onDismiss} aria-label="关闭提示">
            <span aria-hidden="true">x</span>
          </button>
        </section>
      )}
    </div>
  );
}
