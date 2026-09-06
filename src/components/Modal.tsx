import { useEffect, useRef, type ReactNode } from "react";
import Icon from "./Icon";

export default function Modal({
  title,
  subtitle,
  onClose,
  children,
  feedback,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  feedback?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current!;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-labelledby="modal-title"
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
    >
      <header className="modal-header">
        <div>
          <h2 id="modal-title">{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="닫기"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
        {feedback}
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
