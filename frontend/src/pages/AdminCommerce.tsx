import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  BillingOrder,
  PaymentMethod,
  Plan,
  RedeemCode,
  api,
  fmtDate,
} from "../api";
import { Icon } from "../icons";
import {
  ConfirmButton,
  CopyButton,
  EmptyState,
  ErrorPanel,
  LoadingPage,
  Modal,
  PageHeader,
  notify,
} from "../ui";

type CommerceTab = "orders" | "plans" | "payments" | "redeem";

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      reject(new Error("Use a PNG, JPEG or WebP image"));
      return;
    }
    if (file.size > 2_500_000) {
      reject(new Error("Keep the image under 2.4 MB"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("The image could not be read"));
    reader.readAsDataURL(file);
  });
}

function orderTone(status: string): string {
  if (status === "approved") return "pill-ok";
  if (status === "rejected") return "pill-danger";
  if (status === "cancelled") return "pill-neutral";
  return "pill-warning";
}

const emptyPlan: Plan = {
  id: 0,
  slug: "",
  name: "",
  tagline: "",
  description: "",
  price_cents: 0,
  currency: "MYR",
  billing_period: "month",
  memory: 1024,
  cpu: 100,
  disk: 5120,
  swap: 0,
  io: 500,
  server_slots: 1,
  database_limit: 1,
  backup_limit: 3,
  allocation_limit: 1,
  features: [],
  artifact: { motif: "foundation", serial: "", caption: "" },
  accent: "#43b8f5",
  badge: "",
  sort_order: 0,
  featured: false,
  active: true,
};

const MOTIFS = ["foundation", "orbit", "lattice", "crest"];

export default function AdminCommerce() {
  const [tab, setTab] = useState<CommerceTab>("orders");
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [plans, setPlans] = useState<Plan[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [codes, setCodes] = useState<RedeemCode[]>([]);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [review, setReview] = useState<{ order: BillingOrder; mode: "approve" | "reject" } | null>(null);
  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [editMethod, setEditMethod] = useState<PaymentMethod | null>(null);
  const [editCode, setEditCode] = useState<RedeemCode | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ordersResponse, plansResponse, methodsResponse, codesResponse] = await Promise.all([
        api.adminOrders(statusFilter),
        api.adminPlans(),
        api.adminPaymentMethods(),
        api.adminRedeemCodes(),
      ]);
      setOrders(ordersResponse.data);
      setCounts(ordersResponse.counts);
      setPlans(plansResponse.data);
      setMethods(methodsResponse.data);
      setCodes(codesResponse.data);
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load commerce data");
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingCount = counts.pending || 0;
  const readyMethods = methods.filter((method) => method.configured).length;
  const activePlans = plans.filter((plan) => plan.active).length;

  if (!plans.length && !orders.length && !methods.length && error) {
    return <ErrorPanel message={error} retry={load} />;
  }

  async function reviewOrder(reason: string) {
    if (!review) return;
    setBusy(true);
    try {
      if (review.mode === "approve") {
        const result = await api.adminApproveOrder(review.order.id, reason);
        notify(result.server ? `Approved. ${result.server.name} is provisioned.` : "Order approved.");
      } else {
        await api.adminRejectOrder(review.order.id, reason);
        notify("Order rejected and the buyer can read your note.");
      }
      setReview(null);
      await load();
    } catch (err: any) {
      notify(err.message || "The review could not be saved", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page admin-commerce">
      <PageHeader
        eyebrow="Commerce"
        title="Orders, plans and payment channels"
        description="Review manual DANA and Touch 'n Go payments, tune the plan catalogue, and issue redeem codes without leaving the panel."
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={load}>
              <Icon name="rotate-right" /> Refresh
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setEditPlan({ ...emptyPlan })}>
              <Icon name="plus" /> New plan
            </button>
          </>
        }
      />

      <section className="commerce-kpis">
        <div className="commerce-kpi is-warning">
          <span><Icon name="clock" /></span>
          <div><strong>{pendingCount}</strong><small>Orders awaiting review</small></div>
        </div>
        <div className="commerce-kpi">
          <span><Icon name="layer-group" /></span>
          <div><strong>{activePlans}</strong><small>Published plans</small></div>
        </div>
        <div className="commerce-kpi is-success">
          <span><Icon name="wallet" /></span>
          <div><strong>{readyMethods}</strong><small>Ready payment channels</small></div>
        </div>
        <div className="commerce-kpi">
          <span><Icon name="gift" /></span>
          <div><strong>{codes.filter((code) => code.active).length}</strong><small>Active redeem codes</small></div>
        </div>
      </section>

      <nav className="segmented" aria-label="Commerce sections">
        <button type="button" className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>
          <Icon name="receipt" /> Orders {pendingCount > 0 && <span className="seg-count">{pendingCount}</span>}
        </button>
        <button type="button" className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")}>
          <Icon name="layer-group" /> Plans
        </button>
        <button type="button" className={tab === "payments" ? "active" : ""} onClick={() => setTab("payments")}>
          <Icon name="wallet" /> Payment methods
        </button>
        <button type="button" className={tab === "redeem" ? "active" : ""} onClick={() => setTab("redeem")}>
          <Icon name="gift" /> Redeem codes
        </button>
      </nav>

      {tab === "orders" && (
        <section className="card commerce-panel">
          <div className="card-head">
            <div>
              <span className="eyebrow">Review queue</span>
              <h2>Manual payments</h2>
            </div>
            <div className="status-filter">
              {["pending", "approved", "rejected", "cancelled", ""].map((status) => (
                <button
                  key={status || "all"}
                  type="button"
                  className={statusFilter === status ? "active" : ""}
                  onClick={() => setStatusFilter(status)}
                >
                  {status ? status.charAt(0).toUpperCase() + status.slice(1) : "All"}
                  {status && counts[status] ? <span>{counts[status]}</span> : null}
                </button>
              ))}
            </div>
          </div>
          {orders.length === 0 ? (
            <EmptyState
              icon="receipt"
              title={statusFilter ? `No ${statusFilter} orders` : "No orders have been placed"}
              description="New checkout orders appear here with their receipt, reference and target server."
            />
          ) : (
            <div className="admin-order-list">
              {orders.map((order) => (
                <article className="admin-order" key={order.id}>
                  <div className="admin-order-main">
                    <div className="admin-order-head">
                      <span className={`order-icon plan-${order.plan?.slug || "starter"}`} style={{ "--plan-accent": order.plan?.accent || "#43b8f5" } as CSSProperties}>
                        <Icon name="receipt" />
                      </span>
                      <div>
                        <strong>{order.plan?.name || "Plan"} · {order.code}</strong>
                        <span>{order.buyer.username} ({order.buyer.email}) · {fmtDate(order.created_at)}</span>
                      </div>
                      <span className={`pill ${orderTone(order.status)}`}>{order.status}</span>
                    </div>
                    <div className="admin-order-grid">
                      <span><b>Amount</b>{money(order.amount_cents)}</span>
                      <span><b>Method</b>{order.payment_method?.name || "Redeem code"}</span>
                      <span><b>Target</b>{order.target_server_name || order.server_name || "New deployment"}</span>
                      <span><b>Reference</b>{order.reference || "—"}</span>
                    </div>
                    {order.notes && <p className="admin-order-note">{order.notes}</p>}
                    {order.admin_note && <div className="notice"><Icon name="circle-info" /> {order.admin_note}</div>}
                  </div>
                  <aside className="admin-order-side">
                    {order.proof_data ? (
                      <a href={order.proof_data} target="_blank" rel="noreferrer" className="receipt-thumb">
                        <img src={order.proof_data} alt={`Receipt for ${order.code}`} />
                        <span>Receipt</span>
                      </a>
                    ) : (
                      <div className="receipt-thumb empty"><Icon name="image" /><span>No receipt</span></div>
                    )}
                    {order.status === "pending" && (
                      <div className="admin-order-actions">
                        <button type="button" className="btn btn-success btn-sm" onClick={() => setReview({ order, mode: "approve" })}>
                          <Icon name="check" /> Approve
                        </button>
                        <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setReview({ order, mode: "reject" })}>
                          <Icon name="xmark" /> Reject
                        </button>
                      </div>
                    )}
                    {order.server_id && (
                      <Link className="btn btn-ghost btn-sm" to={`/admin/servers`}>
                        <Icon name="server" /> View servers
                      </Link>
                    )}
                  </aside>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "plans" && (
        <section className="commerce-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Catalogue</span><h2>Published plans</h2></div>
            <button type="button" className="btn btn-primary" onClick={() => setEditPlan({ ...emptyPlan })}>
              <Icon name="plus" /> New plan
            </button>
          </div>
          <div className="admin-plan-grid">
            {plans.map((plan) => (
              <article className={`admin-plan-card plan-${plan.slug} ${plan.active ? "" : "is-disabled"}`} key={plan.id} style={{ "--plan-accent": plan.accent } as CSSProperties}>
                <div className="admin-plan-head">
                  <span className="admin-plan-swatch" />
                  <div>
                    <strong>{plan.name}</strong>
                    <span>{plan.slug}</span>
                  </div>
                  <span className={`pill ${plan.active ? "pill-ok" : "pill-neutral"}`}>{plan.active ? "Live" : "Hidden"}</span>
                </div>
                <p>{plan.tagline}</p>
                <div className="admin-plan-stats">
                  <span><b>{money(plan.price_cents)}</b> / {plan.billing_period}</span>
                  <span>{plan.memory} MB</span>
                  <span>{plan.cpu}% CPU</span>
                  <span>{plan.server_slots} slots</span>
                </div>
                <div className="admin-plan-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditPlan(plan)}>
                    <Icon name="pen" /> Edit
                  </button>
                  <ConfirmButton
                    className="btn btn-danger-ghost btn-sm"
                    title={`Hide ${plan.name}?`}
                    description="The plan disappears from checkout but existing servers keep their limits."
                    confirmLabel="Hide plan"
                    onConfirm={async () => {
                      await api.adminDisablePlan(plan.id);
                      notify("Plan hidden");
                      load();
                    }}
                  >
                    Hide
                  </ConfirmButton>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "payments" && (
        <section className="commerce-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Channels</span><h2>DANA, Touch 'n Go and manual transfer</h2></div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                setEditMethod({
                  id: 0,
                  name: "",
                  kind: "dana_qr",
                  account_name: "",
                  account_id: "",
                  qr_image: "",
                  instructions: "",
                  enabled: true,
                  sort_order: methods.length * 10,
                })
              }
            >
              <Icon name="plus" /> Add method
            </button>
          </div>
          <div className="payment-admin-grid">
            {methods.map((method) => (
              <article className={`payment-admin-card ${method.configured ? "is-ready" : "needs-setup"} ${method.enabled ? "" : "is-disabled"}`} key={method.id}>
                <div className="payment-admin-head">
                  <span className={`method-icon kind-${method.kind}`}><Icon name={method.kind.includes("tng") ? "wallet" : method.kind.includes("dana") ? "qrcode" : "building-columns"} /></span>
                  <div><strong>{method.name}</strong><span>{method.kind.replace(/_/g, " ")}</span></div>
                  <span className={`pill ${method.configured && method.enabled ? "pill-ok" : "pill-warning"}`}>
                    {method.configured ? (method.enabled ? "Ready" : "Disabled") : "Setup needed"}
                  </span>
                </div>
                <div className="payment-admin-details">
                  {method.qr_image ? <img src={method.qr_image} alt={`${method.name} QR`} /> : <div className="payment-admin-qr"><Icon name="qrcode" /><span>No QR image</span></div>}
                  <div>
                    <span><b>Account name</b>{method.account_name || "—"}</span>
                    <span><b>Account ID</b>{method.account_id ? <code>{method.account_id}</code> : "—"}</span>
                    {method.account_id && <CopyButton value={method.account_id} label="Copy" className="btn btn-ghost btn-xs" />}
                  </div>
                </div>
                <div className="admin-plan-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditMethod(method)}>
                    <Icon name="pen" /> Configure
                  </button>
                  <ConfirmButton
                    className="btn btn-danger-ghost btn-sm"
                    title={`Disable ${method.name}?`}
                    description="Customers can no longer choose this method for new orders."
                    confirmLabel="Disable"
                    onConfirm={async () => {
                      await api.adminDisablePaymentMethod(method.id);
                      notify("Payment method disabled");
                      load();
                    }}
                  >
                    Disable
                  </ConfirmButton>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "redeem" && (
        <section className="commerce-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">Gift access</span><h2>Redeem codes</h2></div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() =>
                setEditCode({
                  id: 0,
                  code: "",
                  plan_id: plans[0]?.id || 0,
                  max_uses: 1,
                  uses: 0,
                  expires_at: null,
                  active: true,
                  note: "",
                  created_by: null,
                  created_at: "",
                })
              }
            >
              <Icon name="plus" /> Create code
            </button>
          </div>
          {codes.length === 0 ? (
            <EmptyState icon="gift" title="No redeem codes" description="Create a code to grant a plan without a payment review." />
          ) : (
            <div className="redeem-admin-list">
              {codes.map((code) => (
                <article className="redeem-admin-row" key={code.id}>
                  <div className="redeem-code-block">
                    <span className="redeem-code">{code.code}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Copy code"
                      onClick={async () => {
                        await navigator.clipboard.writeText(code.code);
                        notify("Code copied");
                      }}
                    >
                      <Icon name="copy" />
                    </button>
                  </div>
                  <div className="redeem-admin-meta">
                    <span><b>Plan</b>{code.plan_name || "—"}</span>
                    <span><b>Uses</b>{code.uses} / {code.max_uses}</span>
                    <span><b>Expires</b>{code.expires_at ? fmtDate(code.expires_at) : "Never"}</span>
                    <span><b>Note</b>{code.note || "—"}</span>
                  </div>
                  <div className="redeem-admin-actions">
                    <span className={`pill ${code.active && !code.expired ? "pill-ok" : "pill-neutral"}`}>
                      {code.expired ? "Expired" : code.active ? "Active" : "Paused"}
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditCode(code)}>
                      <Icon name="pen" /> Edit
                    </button>
                    <ConfirmButton
                      className="btn btn-danger-ghost btn-sm"
                      title={`Delete ${code.code}?`}
                      description="Existing redemptions keep their servers. The code cannot be used again."
                      confirmLabel="Delete code"
                      onConfirm={async () => {
                        await api.adminDeleteRedeemCode(code.id);
                        notify("Redeem code deleted");
                        load();
                      }}
                    >
                      Delete
                    </ConfirmButton>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {review && (
        <ReviewOrderModal
          order={review.order}
          mode={review.mode}
          busy={busy}
          onClose={() => setReview(null)}
          onSubmit={reviewOrder}
        />
      )}

      {editPlan && (
        <PlanEditor
          plan={editPlan}
          onClose={() => setEditPlan(null)}
          onSaved={() => {
            setEditPlan(null);
            load();
          }}
        />
      )}

      {editMethod && (
        <PaymentEditor
          method={editMethod}
          onClose={() => setEditMethod(null)}
          onSaved={() => {
            setEditMethod(null);
            load();
          }}
        />
      )}

      {editCode && (
        <RedeemEditor
          code={editCode}
          plans={plans}
          onClose={() => setEditCode(null)}
          onSaved={() => {
            setEditCode(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ReviewOrderModal({
  order,
  mode,
  busy,
  onClose,
  onSubmit,
}: {
  order: BillingOrder;
  mode: "approve" | "reject";
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState(mode === "approve" ? "Payment verified" : "The receipt could not be verified.");
  return (
    <Modal
      open
      onClose={onClose}
      title={mode === "approve" ? `Approve ${order.code}?` : `Reject ${order.code}?`}
      description={
        mode === "approve"
          ? "Approval provisions the server or applies the plan immediately."
          : "The buyer sees this note in their order ledger."
      }
      size="small"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Close</button>
          <button
            type="button"
            className={mode === "approve" ? "btn btn-success" : "btn btn-danger"}
            disabled={busy}
            onClick={() => onSubmit(reason)}
          >
            <Icon name={busy ? "circle-notch" : mode === "approve" ? "check" : "xmark"} className={busy ? "spin" : ""} />
            {mode === "approve" ? "Approve and provision" : "Reject order"}
          </button>
        </>
      }
    >
      <div className="review-summary">
        <span><b>Buyer</b>{order.buyer.username}</span>
        <span><b>Plan</b>{order.plan?.name || "—"}</span>
        <span><b>Amount</b>{money(order.amount_cents)}</span>
        <span><b>Target</b>{order.target_server_name || order.server_name || "New server"}</span>
      </div>
      <label className="field">
        <span>{mode === "approve" ? "Approval note" : "Reason"}</span>
        <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {mode === "approve" && (
        <div className="notice">
          <Icon name="shield-halved" />
          The account must be unbanned and the target node must have capacity. Failures leave the order pending with a note.
        </div>
      )}
    </Modal>
  );
}

function PlanEditor({ plan, onClose, onSaved }: { plan: Plan; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    ...plan,
    price: (plan.price_cents / 100).toFixed(2),
    featuresText: plan.features.join("\n"),
    motif: plan.artifact?.motif || "foundation",
    serial: plan.artifact?.serial || "",
    caption: plan.artifact?.caption || "",
  });
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        name: form.name,
        slug: form.slug,
        tagline: form.tagline,
        description: form.description,
        price_cents: Math.max(0, Math.round(Number(form.price || 0) * 100)),
        currency: form.currency || "MYR",
        billing_period: form.billing_period || "month",
        memory: Number(form.memory),
        cpu: Number(form.cpu),
        disk: Number(form.disk),
        swap: Number(form.swap || 0),
        io: Number(form.io || 500),
        server_slots: Number(form.server_slots),
        database_limit: Number(form.database_limit),
        backup_limit: Number(form.backup_limit),
        allocation_limit: Number(form.allocation_limit),
        features: form.featuresText.split("\n").map((line) => line.trim()).filter(Boolean),
        artifact: { motif: form.motif, serial: form.serial, caption: form.caption },
        accent: form.accent,
        badge: form.badge,
        sort_order: Number(form.sort_order || 0),
        featured: form.featured,
        active: form.active,
      };
      if (plan.id) await api.adminUpdatePlan(plan.id, body);
      else await api.adminCreatePlan(body);
      notify(plan.id ? "Plan updated" : "Plan created");
      onSaved();
    } catch (err: any) {
      notify(err.message || "The plan could not be saved", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={plan.id ? `Edit ${plan.name}` : "Create a plan"}
      description="Plan limits become the server limits when an order is approved."
      size="wide"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="plan-form" className="btn btn-primary" disabled={busy}>
            <Icon name={busy ? "circle-notch" : "floppy-disk"} className={busy ? "spin" : ""} /> Save plan
          </button>
        </>
      }
    >
      <form id="plan-form" className="form plan-form" onSubmit={submit}>
        <div className="field-row">
          <label className="field"><span>Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label className="field"><span>Slug</span><input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="generated from the name" /></label>
        </div>
        <label className="field"><span>Tagline</span><input value={form.tagline} onChange={(event) => setForm({ ...form, tagline: event.target.value })} maxLength={160} /></label>
        <label className="field"><span>Description</span><textarea rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={2000} /></label>
        <div className="field-row">
          <label className="field"><span>Price (MYR)</span><input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></label>
          <label className="field"><span>Billing period</span><select value={form.billing_period} onChange={(event) => setForm({ ...form, billing_period: event.target.value })}><option value="month">Month</option><option value="year">Year</option><option value="one-time">One time</option></select></label>
        </div>
        <div className="field-row triple">
          <label className="field"><span>Memory (MB)</span><input type="number" min="32" value={form.memory} onChange={(event) => setForm({ ...form, memory: Number(event.target.value) })} /></label>
          <label className="field"><span>CPU (%)</span><input type="number" min="10" value={form.cpu} onChange={(event) => setForm({ ...form, cpu: Number(event.target.value) })} /></label>
          <label className="field"><span>Disk (MB)</span><input type="number" min="128" value={form.disk} onChange={(event) => setForm({ ...form, disk: Number(event.target.value) })} /></label>
        </div>
        <div className="field-row triple">
          <label className="field"><span>Server slots</span><input type="number" min="1" value={form.server_slots} onChange={(event) => setForm({ ...form, server_slots: Number(event.target.value) })} /></label>
          <label className="field"><span>Databases</span><input type="number" min="0" value={form.database_limit} onChange={(event) => setForm({ ...form, database_limit: Number(event.target.value) })} /></label>
          <label className="field"><span>Backups</span><input type="number" min="0" value={form.backup_limit} onChange={(event) => setForm({ ...form, backup_limit: Number(event.target.value) })} /></label>
        </div>
        <div className="field-row">
          <label className="field"><span>Allocations</span><input type="number" min="1" value={form.allocation_limit} onChange={(event) => setForm({ ...form, allocation_limit: Number(event.target.value) })} /></label>
          <label className="field"><span>Sort order</span><input type="number" value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: Number(event.target.value) })} /></label>
        </div>
        <label className="field"><span>Features, one per line</span><textarea rows={5} value={form.featuresText} onChange={(event) => setForm({ ...form, featuresText: event.target.value })} /></label>
        <div className="field-row">
          <label className="field"><span>Accent</span><div className="color-field"><input type="color" value={form.accent} onChange={(event) => setForm({ ...form, accent: event.target.value })} /><input value={form.accent} onChange={(event) => setForm({ ...form, accent: event.target.value })} /></div></label>
          <label className="field"><span>Badge</span><input value={form.badge} onChange={(event) => setForm({ ...form, badge: event.target.value })} maxLength={40} /></label>
        </div>
        <div className="field-row triple">
          <label className="field"><span>Artifact motif</span><select value={form.motif} onChange={(event) => setForm({ ...form, motif: event.target.value })}>{MOTIFS.map((motif) => <option key={motif} value={motif}>{motif}</option>)}</select></label>
          <label className="field"><span>Serial</span><input value={form.serial} onChange={(event) => setForm({ ...form, serial: event.target.value })} maxLength={20} /></label>
          <label className="field"><span>Caption</span><input value={form.caption} onChange={(event) => setForm({ ...form, caption: event.target.value })} maxLength={40} /></label>
        </div>
        <div className="check-row">
          <label><input type="checkbox" checked={form.featured} onChange={(event) => setForm({ ...form, featured: event.target.checked })} /> Featured plan</label>
          <label><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Published</label>
        </div>
      </form>
    </Modal>
  );
}

function PaymentEditor({
  method,
  onClose,
  onSaved,
}: {
  method: PaymentMethod;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: method.name,
    kind: method.kind,
    account_name: method.account_name,
    account_id: method.account_id,
    qr_image: method.qr_image,
    instructions: method.instructions,
    enabled: method.enabled,
    sort_order: method.sort_order || 0,
  });
  const [busy, setBusy] = useState(false);
  const [qrName, setQrName] = useState(method.qr_image ? "Current QR image" : "");

  async function attach(file?: File) {
    if (!file) return;
    try {
      const data = await readImage(file);
      setForm((current) => ({ ...current, qr_image: data }));
      setQrName(file.name);
    } catch (err: any) {
      notify(err.message, "error");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = { ...form, sort_order: Number(form.sort_order) };
      if (method.id) await api.adminUpdatePaymentMethod(method.id, body);
      else await api.adminCreatePaymentMethod(body);
      notify(method.id ? "Payment method updated" : "Payment method created");
      onSaved();
    } catch (err: any) {
      notify(err.message || "The payment method could not be saved", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={method.id ? `Configure ${method.name}` : "Add a payment method"}
      description="A method needs a QR image or account ID before customers can use it."
      size="wide"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="payment-form" className="btn btn-primary" disabled={busy}>
            <Icon name={busy ? "circle-notch" : "floppy-disk"} className={busy ? "spin" : ""} /> Save method
          </button>
        </>
      }
    >
      <form id="payment-form" className="form payment-form" onSubmit={submit}>
        <div className="field-row">
          <label className="field"><span>Name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
          <label className="field">
            <span>Type</span>
            <select value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>
              <option value="dana_qr">DANA QR</option>
              <option value="dana_account">DANA account</option>
              <option value="tng_qr">Touch 'n Go QR</option>
              <option value="tng_account">Touch 'n Go account</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="manual">Manual</option>
            </select>
          </label>
        </div>
        <div className="field-row">
          <label className="field"><span>Account name</span><input value={form.account_name} onChange={(event) => setForm({ ...form, account_name: event.target.value })} /></label>
          <label className="field"><span>Account / wallet ID</span><input value={form.account_id} onChange={(event) => setForm({ ...form, account_id: event.target.value })} /></label>
        </div>
        <label className="field"><span>Instructions</span><textarea rows={3} value={form.instructions} onChange={(event) => setForm({ ...form, instructions: event.target.value })} /></label>
        <div className="payment-editor-qr">
          <div>
            <span className="field-label">QR image</span>
            {form.qr_image ? <img src={form.qr_image} alt="Payment QR preview" /> : <div className="payment-admin-qr"><Icon name="qrcode" /><span>No QR image</span></div>}
          </div>
          <div className="form">
            <label className={`upload-zone ${form.qr_image ? "has-file" : ""}`}>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => attach(event.target.files?.[0])} />
              <Icon name="cloud-arrow-up" />
              <div><strong>{qrName || "Upload QR image"}</strong><span>PNG, JPEG or WebP under 2.4 MB</span></div>
            </label>
            <label className="field"><span>Or image URL</span><input value={form.qr_image.startsWith("data:") ? "" : form.qr_image} onChange={(event) => setForm({ ...form, qr_image: event.target.value })} placeholder="https://..." /></label>
          </div>
        </div>
        <div className="field-row">
          <label className="field"><span>Sort order</span><input type="number" value={form.sort_order} onChange={(event) => setForm({ ...form, sort_order: Number(event.target.value) })} /></label>
          <label className="check-row"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> Enabled for checkout</label>
        </div>
      </form>
    </Modal>
  );
}

function RedeemEditor({
  code,
  plans,
  onClose,
  onSaved,
}: {
  code: RedeemCode;
  plans: Plan[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    code: code.code,
    plan_id: code.plan_id || plans[0]?.id || 0,
    max_uses: code.max_uses || 1,
    expires_at: code.expires_at ? code.expires_at.slice(0, 16) : "",
    note: code.note || "",
    active: code.active,
  });
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const body = {
        ...form,
        code: form.code.trim(),
        plan_id: Number(form.plan_id),
        max_uses: Number(form.max_uses),
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      };
      if (code.id) await api.adminUpdateRedeemCode(code.id, body);
      else await api.adminCreateRedeemCode(body);
      notify(code.id ? "Redeem code updated" : "Redeem code created");
      onSaved();
    } catch (err: any) {
      notify(err.message || "The code could not be saved", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={code.id ? "Edit redeem code" : "Create a redeem code"}
      description="A code grants its plan immediately without a payment review."
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="redeem-form" className="btn btn-primary" disabled={busy}>
            <Icon name={busy ? "circle-notch" : "floppy-disk"} className={busy ? "spin" : ""} /> Save code
          </button>
        </>
      }
    >
      <form id="redeem-form" className="form" onSubmit={submit}>
        <label className="field"><span>Code (leave blank to generate)</span><input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="MDN-GIFT-XXXX-XXXX" /></label>
        <div className="field-row">
          <label className="field"><span>Plan</span><select value={form.plan_id} onChange={(event) => setForm({ ...form, plan_id: Number(event.target.value) })}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
          <label className="field"><span>Maximum uses</span><input type="number" min="1" max="1000" value={form.max_uses} onChange={(event) => setForm({ ...form, max_uses: Number(event.target.value) })} /></label>
        </div>
        <label className="field"><span>Expires at (optional)</span><input type="datetime-local" value={form.expires_at} onChange={(event) => setForm({ ...form, expires_at: event.target.value })} /></label>
        <label className="field"><span>Note</span><input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} maxLength={300} /></label>
        <label className="check-row"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Active and redeemable</label>
      </form>
    </Modal>
  );
}
