import {
  FormEvent,
  KeyboardEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  api,
  streamAiChat,
  type AiProviderMessage,
  type AiProviderOption,
} from "./api";
import { Icon } from "./icons";
import { ConfirmButton, notify } from "./ui";

export type CopilotSeed = { text: string; nonce: number } | null;

const SUGGESTIONS = [
  "Read my terminal buffer and explain the last error.",
  "Audit this server directory for obvious misconfigurations.",
  "Which files are safe to remove to reclaim disk space?",
  "Write a safe backup and restart checklist for this server.",
];

function stamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Inline({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function Prose({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (!list.length) return;
    const items = list;
    list = [];
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {items.map((item, index) => (
          <li key={index}>
            <Inline text={item} />
          </li>
        ))}
      </ul>
    );
  };
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) {
      flush();
      return;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+\.\s+(.+)$/.exec(line);
    if (bullet || numbered) {
      list.push((bullet || numbered)?.[1] || line);
      return;
    }
    flush();
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push(
        <h4 key={`head-${index}`}>
          <Inline text={heading[2]} />
        </h4>
      );
      return;
    }
    blocks.push(
      <p key={`line-${index}`}>
        <Inline text={line} />
      </p>
    );
  });
  flush();
  return <>{blocks}</>;
}

function CodeBlock({
  code,
  language,
  onInsert,
}: {
  code: string;
  language: string;
  onInsert: (command: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const single = !code.trim().includes("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      notify("Clipboard access was blocked by the browser", "error");
    }
  }

  return (
    <div className="copilot-code">
      <div className="copilot-code-head">
        <span>{language || "shell"}</span>
        <div>
          <button type="button" onClick={copy} title="Copy snippet">
            <Icon name={copied ? "check" : "copy"} /> {copied ? "Copied" : "Copy"}
          </button>
          {single && (
            <button type="button" onClick={() => onInsert(code.trim())} title="Insert at the terminal prompt">
              <Icon name="arrow-turn-down" /> Insert
            </button>
          )}
        </div>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function RichText({
  content,
  onInsert,
}: {
  content: string;
  onInsert: (command: string) => void;
}) {
  const parts = content.split("```");
  return (
    <div className="copilot-rich">
      {parts.map((part, index) => {
        if (index % 2 === 1) {
          const lines = part.split("\n");
          const language = (lines[0] || "").trim().slice(0, 24) || "shell";
          const code = lines.slice(1).join("\n").replace(/\n+$/, "");
          return (
            <CodeBlock
              key={`code-${index}`}
              code={code}
              language={language}
              onInsert={onInsert}
            />
          );
        }
        return <Prose key={`prose-${index}`} text={part} />;
      })}
    </div>
  );
}

export function AiCopilot({
  serverId,
  serverName,
  getContext,
  onInsert,
  seed,
  canConfigure,
  cwd,
  sudo,
}: {
  serverId: string;
  serverName: string;
  getContext: () => string;
  onInsert: (command: string) => void;
  seed: CopilotSeed;
  canConfigure: boolean;
  cwd: string;
  sudo: boolean;
}) {
  const [messages, setMessages] = useState<AiProviderMessage[]>([]);
  const [providers, setProviders] = useState<AiProviderOption[]>([]);
  const [providerId, setProviderId] = useState<number | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [attach, setAttach] = useState(true);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<{ total_tokens: number; latency_ms: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.aiHistory(serverId);
      setMessages(response.data);
      setProviders(response.meta.providers);
      setProviderId(response.meta.default_provider_id || null);
      setConfigured(response.meta.configured);
    } catch (err: any) {
      setError(err.message || "Unable to load the copilot conversation");
    } finally {
      setLoading(false);
    }
  }, [serverId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!seed?.text) return;
    setInput(
      `Explain this terminal selection and tell me what to do next:\n\n\`\`\`\n${seed.text.slice(0, 6000)}\n\`\`\``
    );
    window.setTimeout(() => textareaRef.current?.focus(), 60);
  }, [seed?.nonce, seed?.text]);

  useEffect(() => {
    const element = threadRef.current;
    if (element && stickRef.current) element.scrollTop = element.scrollHeight;
  }, [messages, error, loading]);

  function onThreadScroll() {
    const element = threadRef.current;
    if (!element) return;
    stickRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 90;
  }

  function patchMessage(id: number, patch: Partial<AiProviderMessage>) {
    setMessages((current) =>
      current.map((message) => (message.id === id ? { ...message, ...patch } : message))
    );
  }

  async function send(text?: string) {
    const prompt = (text ?? input).trim();
    if (!prompt || sending) return;
    if (!providerId) {
      setError("Choose an AI provider before starting a conversation");
      return;
    }
    const provider = providers.find((item) => item.id === providerId);
    const turn = -Date.now();
    const userMessage: AiProviderMessage = {
      id: turn - 1,
      role: "user",
      content: prompt,
      provider_id: providerId,
      model: provider?.model || "",
      created_at: new Date().toISOString(),
    };
    const assistantMessage: AiProviderMessage = {
      id: turn,
      role: "assistant",
      content: "",
      provider_id: providerId,
      model: provider?.model || "",
      created_at: new Date().toISOString(),
      streaming: true,
    };
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setInput("");
    setError("");
    setUsage(null);
    setSending(true);
    stickRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    let context = "";
    if (attach) context = getContext().slice(-12000);
    let received = false;
    try {
      await streamAiChat(
        serverId,
        {
          message: prompt,
          provider_id: providerId,
          context,
          cwd,
          sudo,
        },
        (event, payload) => {
          if (event === "delta" && typeof payload?.text === "string") {
            received = true;
            setMessages((current) =>
              current.map((message) =>
                message.id === turn
                  ? { ...message, content: message.content + payload.text }
                  : message
              )
            );
          } else if (event === "done") {
            patchMessage(turn, {
              id: Number(payload?.message_id) || turn,
              streaming: false,
            });
            if (payload?.usage?.total_tokens != null) {
              setUsage({
                total_tokens: Number(payload.usage.total_tokens) || 0,
                latency_ms: Number(payload.latency_ms) || 0,
              });
            }
          } else if (event === "error") {
            const text = String(payload?.message || "The copilot request failed");
            setError(text);
            setMessages((current) =>
              current.map((message) =>
                message.id === turn
                  ? {
                      ...message,
                      streaming: false,
                      content: message.content || "No response was returned.",
                    }
                  : message
              )
            );
          }
        },
        controller.signal
      );
      if (!received) {
        setMessages((current) =>
          current.map((message) =>
            message.id === turn
              ? {
                  ...message,
                  streaming: false,
                  content: message.content || "No response was returned.",
                }
              : message
          )
        );
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setMessages((current) =>
          current.map((message) =>
            message.id === turn
              ? {
                  ...message,
                  streaming: false,
                  content: message.content
                    ? `${message.content}\n\n_Generation stopped._`
                    : "Generation stopped.",
                }
              : message
          )
        );
      } else {
        setError(err?.message || "The copilot request failed");
        setMessages((current) =>
          current.map((message) =>
            message.id === turn
              ? {
                  ...message,
                  streaming: false,
                  content: message.content || "No response was returned.",
                }
              : message
          )
        );
      }
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  async function clear() {
    try {
      await api.clearAiHistory(serverId);
      setMessages([]);
      setUsage(null);
      setError("");
      notify("Copilot conversation cleared");
    } catch (err: any) {
      notify(err.message || "Unable to clear the conversation", "error");
    }
  }

  const provider = providers.find((item) => item.id === providerId);
  const empty = !loading && configured && messages.length === 0;

  return (
    <div className="copilot">
      <div className="copilot-head">
        <div className="copilot-identity">
          <span className="copilot-mark">
            <Icon name="brain" />
          </span>
          <div>
            <strong>Operations copilot</strong>
            <span>
              {configured === false
                ? "No provider connected"
                : provider
                  ? `${provider.name} · ${provider.model}`
                  : "Server-aware assistant"}
            </span>
          </div>
        </div>
        <div className="copilot-head-actions">
          <button type="button" className="icon-btn" title="Reload conversation" onClick={load}>
            <Icon name="arrows-rotate" />
          </button>
          <ConfirmButton
            className="icon-btn copilot-clear"
            icon="trash-can"
            title="Clear this conversation?"
            description="The chat history for this server is deleted. Provider configuration and usage records are kept."
            confirmLabel="Clear conversation"
            onConfirm={clear}
          >
            <span className="sr-only">Clear conversation</span>
          </ConfirmButton>
        </div>
      </div>

      {configured && (
        <div className="copilot-controls">
          <label className="copilot-provider">
            <Icon name="microchip" />
            <select
              value={providerId ?? ""}
              onChange={(event) => setProviderId(Number(event.target.value) || null)}
              disabled={sending}
              aria-label="AI provider"
            >
              {providers.map((item) => (
                <option value={item.id} key={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={`copilot-attach ${attach ? "is-on" : ""}`}
            onClick={() => setAttach((value) => !value)}
            title="Attach the visible terminal buffer to the next message"
            aria-pressed={attach}
          >
            <Icon name="paperclip" /> buffer
          </button>
        </div>
      )}

      <div className="copilot-thread" ref={threadRef} onScroll={onThreadScroll}>
        {loading ? (
          <div className="copilot-loading">
            <Icon name="circle-notch" className="spin" /> Loading conversation
          </div>
        ) : configured === false ? (
          <div className="copilot-empty">
            <span className="copilot-empty-mark">
              <Icon name="plug-circle-xmark" />
            </span>
            <h3>Connect an AI provider</h3>
            <p>
              Add an OpenAI-compatible endpoint, Anthropic, Gemini, Azure or a local
              Ollama model. Keys stay on the panel host.
            </p>
            {canConfigure ? (
              <Link className="btn btn-primary btn-sm" to="/admin/ai">
                <Icon name="sliders" /> Open AI providers
              </Link>
            ) : (
              <p className="copilot-muted">Ask an administrator to connect a provider.</p>
            )}
          </div>
        ) : empty ? (
          <div className="copilot-welcome">
            <div className="copilot-welcome-head">
              <span className="copilot-signal" />
              <span>Grounded in {serverName}</span>
            </div>
            <h3>What are we fixing?</h3>
            <p>
              The copilot sees this server's egg, limits, power state and, when the buffer
              is attached, your visible terminal output. Nothing is executed for you.
            </p>
            <div className="copilot-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  className="copilot-suggestion"
                  onClick={() => send(suggestion)}
                  disabled={sending}
                >
                  <span>{suggestion}</span>
                  <Icon name="arrow-right" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <article className={`copilot-msg ${message.role}`} key={message.id}>
              <div className="copilot-msg-head">
                <span className="copilot-msg-author">
                  {message.role === "assistant" ? (
                    <>
                      <Icon name="brain" /> Copilot
                    </>
                  ) : (
                    <>
                      <Icon name="user" /> You
                    </>
                  )}
                </span>
                <span className="copilot-msg-meta">
                  {message.streaming ? "streaming" : stamp(message.created_at)}
                </span>
              </div>
              <div className="copilot-msg-body">
                {message.role === "assistant" ? (
                  <RichText content={message.content} onInsert={onInsert} />
                ) : (
                  <p>{message.content}</p>
                )}
                {message.streaming && <span className="copilot-cursor" />}
              </div>
            </article>
          ))
        )}
        {error && (
          <div className="copilot-error" role="alert">
            <Icon name="circle-exclamation" />
            <span>{error}</span>
          </div>
        )}
      </div>

      {configured && (
        <form className="copilot-compose" onSubmit={submit}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about this server, a config, or the last error..."
            rows={3}
            maxLength={8000}
            disabled={sending}
            aria-label="Message the operations copilot"
          />
          <div className="copilot-compose-bar">
            <span className="copilot-context">
              {usage
                ? `${usage.total_tokens.toLocaleString()} tokens · ${(usage.latency_ms / 1000).toFixed(1)}s`
                : attach
                  ? "terminal buffer attached"
                  : "no terminal context"}
            </span>
            <div className="copilot-compose-actions">
              {sending ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Icon name="stop" /> Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn-primary btn-sm"
                  disabled={!input.trim() || !providerId}
                >
                  Send <Icon name="arrow-up" />
                </button>
              )}
            </div>
          </div>
          <div className="copilot-safety">
            <Icon name="shield-halved" />
            Suggestions only. Commands are inserted for review, never run automatically.
          </div>
        </form>
      )}
    </div>
  );
}
