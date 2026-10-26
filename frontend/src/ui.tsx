import {
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

export type ToastTone = "success" | "error" | "info";

type ToastItem = { id: number; message: string; tone: ToastTone };

let toastId = 0;

export function notify(message: string, tone: ToastTone = "success") {
  window.dispatchEvent(
    new CustomEvent<{ message: string; tone: ToastTone }>("kestrel:toast", {
      detail: { message, tone },
    })
  );
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    function onToast(event: Event) {
      const detail = (event as CustomEvent<{ message: string; tone: ToastTone }>).detail;
      const id = ++toastId;
      setItems((current) => [...current.slice(-3), { id, ...detail }]);
      window.setTimeout(() => {
        setItems((current) => current.filter((item) => item.id !== id));
      }, 4600);
    }
    window.addEventListener("kestrel:toast", onToast);
    return () => window.removeEventListener("kestrel:toast", onToast);
  }, []);

  if (!items.length) return null;

  return createPortal(
    <div className="toaster" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast toast-${item.tone}`}>
          <span className="toast-icon">
            <Icon
              name={
                item.tone === "success"
                  ? "circle-check"
                  : item.tone === "error"
                    ? "circle-exclamation"
                    : "circle-info"
              }
            />
          </span>
          <span>{item.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
          >
            <Icon name="xmark" />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "normal",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "normal" | "wide" | "small";
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    window.setTimeout(() => {
      const focusable = panelRef.current?.querySelector<HTMLElement>(
        "input, select, textarea, button:not([disabled])"
      );
      focusable?.focus();
    }, 40);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-head">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close dialog">
            <Icon name="xmark" />
          </button>
        </div>
        {children && <div className="modal-body">{children}</div>}
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
  tone = "danger",
  icon = "trash-can",
  className = "btn btn-danger btn-sm",
  disabled,
  afterClose,
}: {
  children: ReactNode;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  tone?: "danger" | "primary" | "warning";
  icon?: string;
  className?: string;
  disabled?: boolean;
  afterClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmClass =
    tone === "danger" ? "btn btn-danger" : tone === "warning" ? "btn btn-warning" : "btn btn-primary";

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setError("");
    afterClose?.();
  }, [busy, afterClose]);

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      await onConfirm();
      setOpen(false);
      afterClose?.();
    } catch (err: any) {
      setError(err?.message || "The operation could not be completed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {icon && <Icon name={icon} />}
        {children}
      </button>
      <Modal
        open={open}
        onClose={close}
        title={title}
        description={typeof description === "string" ? description : undefined}
        size="small"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={close} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={confirmClass} onClick={confirm} disabled={busy}>
              {busy ? (
                <>
                  <Icon name="circle-notch" className="spin" /> Working
                </>
              ) : (
                <>
                  <Icon name={icon || "check"} /> {confirmLabel}
                </>
              )}
            </button>
          </>
        }
      >
        {typeof description !== "string" && description ? <div className="modal-copy">{description}</div> : null}
        {error && <div className="err">{error}</div>}
      </Modal>
    </>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-title">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function StatusPill({ status, label }: { status: string; label?: string }) {
  const normalized = status || "offline";
  return (
    <span className={`status status-${normalized.replace(/_/g, "-")}`}>
      <span className={`status-dot ${normalized}`} />
      {label || normalized}
    </span>
  );
}

export function CopyButton({
  value,
  label = "Copy",
  className = "icon-btn",
  title,
}: {
  value: string;
  label?: string;
  className?: string;
  title?: string;
}) {
  const [copied, setCopied] = useState(false);
  const withLabel = className.split(/\s+/).includes("btn");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      notify("Clipboard access is not available", "error");
    }
  }
  return (
    <button
      type="button"
      className={className}
      title={title || label}
      aria-label={title || label}
      onClick={(event) => {
        event.stopPropagation();
        copy();
      }}
    >
      <Icon name={copied ? "check" : "copy"} />
      {withLabel && <span>{copied ? "Copied" : label}</span>}
    </button>
  );
}

export function LoadingPage({ label = "Loading workspace" }: { label?: string }) {
  return (
    <div className="loading-page" role="status">
      <div className="skeleton-grid">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className="skeleton-bars">
        <i />
        <i />
        <i />
      </div>
      <span className="loading-label">
        <Icon name="circle-notch" className="spin" /> {label}
      </span>
    </div>
  );
}

export function ErrorPanel({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-panel">
      <span className="error-panel-icon">
        <Icon name="triangle-exclamation" />
      </span>
      <div>
        <h3>Something needs attention</h3>
        <p>{message}</p>
      </div>
      {retry && (
        <button type="button" className="btn btn-ghost" onClick={retry}>
          <Icon name="rotate-right" /> Retry
        </button>
      )}
    </div>
  );
}

export function activityInfo(event: string): { icon: string; tone: string; label: string } {
  if (event.startsWith("server:power:start")) return { icon: "play", tone: "success", label: "Power action" };
  if (event.startsWith("server:power:stop")) return { icon: "stop", tone: "neutral", label: "Power action" };
  if (event.startsWith("server:power:restart")) return { icon: "rotate-right", tone: "info", label: "Power action" };
  if (event.startsWith("server:power:kill")) return { icon: "power-off", tone: "danger", label: "Power action" };
  if (event === "server:create") return { icon: "server", tone: "accent", label: "Server created" };
  if (event === "server:delete") return { icon: "trash-can", tone: "danger", label: "Server deleted" };
  if (event === "server:suspend") return { icon: "ban", tone: "warning", label: "Server suspended" };
  if (event === "server:unsuspend") return { icon: "circle-check", tone: "success", label: "Server restored" };
  if (event === "server:transfer") return { icon: "right-left", tone: "info", label: "Ownership transferred" };
  if (event === "server:startup") return { icon: "terminal", tone: "info", label: "Startup updated" };
  if (event === "server:reinstall") return { icon: "arrows-rotate", tone: "warning", label: "Server reinstalled" };
  if (event.startsWith("backup:")) return { icon: "box-archive", tone: "accent", label: "Backup" };
  if (event.startsWith("file:")) return { icon: "file-pen", tone: "neutral", label: "File manager" };
  if (event.startsWith("database:")) return { icon: "database", tone: "accent", label: "Database" };
  if (event.startsWith("network:")) return { icon: "network-wired", tone: "info", label: "Networking" };
  if (event.startsWith("schedule:")) return { icon: "clock", tone: "info", label: "Schedule" };
  if (event === "auth:login") return { icon: "right-to-bracket", tone: "neutral", label: "Signed in" };
  if (event.startsWith("user:")) return { icon: "user-plus", tone: "accent", label: "User management" };
  if (event.startsWith("node:")) return { icon: "network-wired", tone: "accent", label: "Node" };
  if (event.startsWith("settings:")) return { icon: "sliders", tone: "neutral", label: "Settings" };
  return { icon: "circle-info", tone: "neutral", label: "Activity" };
}

export function activityText(event: string): string {
  return event
    .replace(/^server:power:/, "Power ")
    .replace(/^server:/, "")
    .replace(/^auth:/, "")
    .replace(/^backup:/, "Backup ")
    .replace(/^file:/, "File ")
    .replace(/^database:/, "Database ")
    .replace(/^network:/, "Network ")
    .replace(/^schedule:/, "Schedule ")
    .replace(/^user:/, "User ")
    .replace(/^node:/, "Node ")
    .replace(/^settings:/, "Settings ")
    .replace(/^account:/, "Account ")
    .replace(/[:_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function PasswordValue({ value }: { value: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="password-value">
      <code>{visible ? value : "••••••••••••"}</code>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        <Icon name={visible ? "eye-slash" : "eye"} />
      </button>
      <CopyButton value={value} label="Copy password" />
    </span>
  );
}
