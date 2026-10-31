import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  BillingCatalog,
  BillingOrder,
  PaymentMethod,
  Plan,
  Server,
  User,
  WorkloadOption,
  api,
  fmtDate,
} from "../api";
import { Icon } from "../icons";
import {
  CopyButton,
  EmptyState,
  ErrorPanel,
  LoadingPage,
  Modal,
  PageHeader,
  StatusPill,
  notify,
} from "../ui";

function money(cents: number, currency = "MYR"): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "MYR",
    maximumFractionDigits: 2,
  }).format((cents || 0) / 100);
}

function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      reject(new Error("Use a PNG, JPEG or WebP image"));
      return;
    }
    if (file.size > 2_200_000) {
      reject(new Error("Keep the image under 2 MB"));
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

function orderLabel(status: string): string {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "cancelled") return "Cancelled";
  return "Awaiting owner review";
}

function planIcon(plan: Plan): string {
  const slug = plan.slug || "";
  if (slug.includes("premium")) return "crown";
  if (slug.includes("pro")) return "gauge-high";
  if (slug.includes("standard")) return "layer-group";
  return "seedling";
}

function slotsLabel(value: number): string {
  return `${value} deployment slot${value === 1 ? "" : "s"}`;
}

export default function Billing() {
  const { user } = useOutletContext<{ user: User }>();
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [orders, setOrders] = useState<BillingOrder[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [workloads, setWorkloads] = useState<WorkloadOption[]>([]);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Plan | null>(null);
  const [proofOrder, setProofOrder] = useState<BillingOrder | null>(null);
  const [tab, setTab] = useState<"plans" | "orders" | "redeem">("plans");

  const load = useCallback(async () => {
    try {
      const [catalogResponse, ordersResponse, serversResponse, workloadsResponse] = await Promise.all([
        api.billingCatalog(),
        api.billingOrders(),
        api.servers(),
        api.billingWorkloads(),
      ]);
      setCatalog(catalogResponse);
      setOrders(ordersResponse.data);
      setServers(serversResponse.data.filter((server) => Number(server.owner_id) === Number(user.id)));
      setWorkloads(workloadsResponse.data);
      setError("");
    } catch (err: any) {
      setError(err.message || "Unable to load the plan catalogue");
    }
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  const pending = orders.filter((order) => order.status === "pending");
  const selectedPlan = selected;
  const methods = catalog?.payment_methods || [];

  if (!catalog && !error) return <LoadingPage label="Loading plans and payment options" />;
  if (!catalog && error) return <ErrorPanel message={error} retry={load} />;

  const currentPlans = catalog?.summary.current_plans || [];
  const ownedServers = catalog?.summary.servers_owned ?? servers.length;
  const activePlans = currentPlans.filter((item) => item.plan_state !== "expired").length;
  const renewalsDue = currentPlans.length - activePlans;
  const planCoverage = !currentPlans.length
    ? "No plan applied yet"
    : activePlans
      ? `${activePlans} active${renewalsDue ? ` · ${renewalsDue} renewal due` : ""}`
      : `${renewalsDue} renewal due`;

  return (
    <div className="page billing-page">
      <PageHeader
        eyebrow="Plans and billing"
        title="Capacity that matches the world you run"
        description="Pick a plan, pay by DANA or Touch 'n Go, and the owner verifies the receipt before capacity is provisioned automatically."
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setTab("redeem")}>
              <Icon name="gift" /> Redeem a code
            </button>
            <button type="button" className="btn" onClick={load}>
              <Icon name="rotate-right" /> Refresh
            </button>
          </>
        }
      />

      <section className="billing-hero">
        <div className="billing-hero-copy">
          <span className="eyebrow">How it works</span>
          <h2>One flow from payment to a running deployment.</h2>
          <p>
            Manual verification keeps every transaction reviewable. The order appears in your queue,
            the owner checks the receipt and approves it, and the panel creates the server or applies
            the plan without another ticket.
          </p>
          <div className="billing-steps">
            <span><b>01</b> Choose a plan</span>
            <span><b>02</b> Pay and attach receipt</span>
            <span><b>03</b> Owner approves</span>
            <span><b>04</b> Server provisions</span>
          </div>
        </div>
        <div className="billing-hero-side">
          <div className="billing-stat">
            <span>Pending review</span>
            <strong>{catalog?.summary.pending_orders || 0}</strong>
            <small>{catalog?.summary.pending_orders ? "The owner has your receipt" : "No orders waiting"}</small>
          </div>
          <div className="billing-stat">
            <span>Your deployments</span>
            <strong>{catalog?.summary.servers_owned || 0}</strong>
            <small>{planCoverage}</small>
          </div>
          <div className="billing-stat">
            <span>Payment channels</span>
            <strong>{catalog?.summary.payment_ready || 0}</strong>
            <small>{methods.length ? "Ready for checkout" : "Owner setup needed"}</small>
          </div>
        </div>
      </section>

      <nav className="segmented billing-tabs" aria-label="Billing sections">
        <button type="button" className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")}>
          <Icon name="layer-group" /> Plans
        </button>
        <button type="button" className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}>
          <Icon name="receipt" /> Orders {pending.length > 0 && <span className="seg-count">{pending.length}</span>}
        </button>
        <button type="button" className={tab === "redeem" ? "active" : ""} onClick={() => setTab("redeem")}>
          <Icon name="gift" /> Redeem
        </button>
      </nav>

      {tab === "plans" && (
        <>
          {(catalog?.plans || []).length === 0 ? (
            <div className="card">
              <EmptyState
                icon="layer-group"
                title="No plans are published"
                description="The owner has not enabled a plan yet. Check back after the catalogue is configured."
              />
            </div>
          ) : (
            <section className="plan-grid">
              {(catalog?.plans || []).map((plan) => (
                <article
                  key={plan.id}
                  className={`plan-card plan-${plan.slug} ${plan.featured ? "is-featured" : ""}`}
                  style={{ "--plan-accent": plan.accent || "#43b8f5" } as CSSProperties}
                >
                  <div className="plan-visual">
                    <span className="plan-serial">{plan.artifact?.serial || plan.slug.toUpperCase()}</span>
                    <span className="plan-badge">{plan.badge || plan.artifact?.caption || "Plan"}</span>
                    <div className={`plan-art motif-${plan.artifact?.motif || "foundation"}`}>
                      <span className="plan-art-ring" />
                      <span className="plan-art-ring second" />
                      <span className="plan-art-core">
                        <Icon name={planIcon(plan)} />
                      </span>
                    </div>
                    <span className="plan-caption">{plan.artifact?.caption || "Deployment"}</span>
                  </div>
                  <div className="plan-content">
                    <div className="plan-title">
                      <div>
                        <h3>{plan.name}</h3>
                        <span>{plan.tagline}</span>
                      </div>
                      <div className="plan-price">
                        <strong>{money(plan.price_cents, plan.currency)}</strong>
                        <span>per {plan.billing_period || "month"}</span>
                      </div>
                    </div>
                    <p className="plan-description">{plan.description}</p>
                    <div className="plan-specs">
                      <div><span>Memory</span><strong>{plan.memory >= 1024 ? `${plan.memory / 1024} GB` : `${plan.memory} MB`}</strong></div>
                      <div><span>CPU</span><strong>{plan.cpu}%</strong></div>
                      <div><span>Disk</span><strong>{plan.disk >= 1024 ? `${Math.round(plan.disk / 1024)} GB` : `${plan.disk} MB`}</strong></div>
                      <div><span>Slots</span><strong>{plan.server_slots}</strong></div>
                    </div>
                    <div className={`plan-availability ${ownedServers >= plan.server_slots ? "is-full" : ""}`}>
                      <Icon name={ownedServers >= plan.server_slots ? "circle-info" : "circle-check"} />
                      <span>
                        {ownedServers >= plan.server_slots
                          ? "All slots in use · apply to an existing server"
                          : `${plan.server_slots - ownedServers} of ${slotsLabel(plan.server_slots)} available`}
                      </span>
                    </div>
                    <ul className="plan-features">
                      {plan.features.slice(0, 6).map((feature) => (
                        <li key={feature}><Icon name="check" /> {feature}</li>
                      ))}
                    </ul>
                    <div className="plan-foot">
                      <div className="plan-includes">
                        <span><Icon name="box-archive" /> {plan.backup_limit} backups</span>
                        <span><Icon name="database" /> {plan.database_limit} databases</span>
                      </div>
                      <button type="button" className="btn btn-primary btn-block" onClick={() => setSelected(plan)}>
                        <Icon name="arrow-right" /> Choose {plan.name}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </section>
          )}

          {currentPlans.length > 0 && (
            <section className="current-plan-strip">
              <div>
                <span className="eyebrow">Active coverage</span>
                <h2>Plans on your servers</h2>
              </div>
              <div className="current-plan-list">
                {currentPlans.map((item) => (
                  <Link key={item.id} to={`/server/${item.id}`} className={`current-plan-item ${item.plan_state === "expired" ? "is-expired" : ""}`}>
                    <span className="plan-dot" style={{ background: item.plan_accent || "#43b8f5" }} />
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.plan_name}{item.plan_state === "expired" ? " · renewal due" : item.plan_expires_at ? ` · expires ${fmtDate(item.plan_expires_at)}` : ""}</span>
                    </div>
                    <Icon name="chevron-right" />
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {tab === "orders" && (
        <section className="card billing-orders">
          <div className="card-head">
            <div>
              <span className="eyebrow">Order ledger</span>
              <h2>Payments and provisioning</h2>
            </div>
            <span className="section-meta">{orders.length} total</span>
          </div>
          {orders.length === 0 ? (
            <EmptyState
              icon="receipt"
              title="No orders yet"
              description="Choose a plan above to create your first order. You can attach a DANA or Touch 'n Go receipt from the checkout form."
              action={<button type="button" className="btn btn-primary" onClick={() => setTab("plans")}>Browse plans</button>}
            />
          ) : (
            <div className="order-list">
              {orders.map((order) => (
                <article className="order-card" key={order.id}>
                  <div className="order-head">
                    <div className="order-ident">
                      <span className="order-icon" style={{ "--plan-accent": order.plan?.accent || "#43b8f5" } as CSSProperties}>
                        <Icon name="receipt" />
                      </span>
                      <div>
                        <strong>{order.plan?.name || "Plan order"}</strong>
                        <span>{order.code} · {fmtDate(order.created_at)}</span>
                      </div>
                    </div>
                    <span className={`pill ${orderTone(order.status)}`}>{orderLabel(order.status)}</span>
                  </div>
                  <div className="order-body">
                    <div className="order-meta">
                      <span><b>Server</b>{order.target_server_name || order.server_name || "New deployment"}</span>
                      <span><b>Payment</b>{order.payment_method?.name || "Redeem code"}</span>
                      <span><b>Total</b>{money(order.amount_cents, order.currency)}</span>
                      {order.reference && <span><b>Reference</b>{order.reference}</span>}
                    </div>
                    {order.admin_note && <div className="order-note"><Icon name="circle-info" /> {order.admin_note}</div>}
                    {order.proof_data && (
                      <div className="order-proof">
                        <a href={order.proof_data} target="_blank" rel="noreferrer">
                          <Icon name="image" /> View attached receipt
                        </a>
                      </div>
                    )}
                  </div>
                  <div className="order-actions">
                    {order.status === "pending" && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setProofOrder(order)}>
                          <Icon name="paperclip" /> Update receipt
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger-ghost btn-sm"
                          onClick={async () => {
                            try {
                              await api.cancelOrder(order.id);
                              notify("Order cancelled");
                              load();
                            } catch (err: any) {
                              notify(err.message, "error");
                            }
                          }}
                        >
                          Cancel
                        </button>
                      </>
                    )}
                    {order.status === "approved" && order.server_id && (
                      <Link className="btn btn-ghost btn-sm" to={`/server/${order.server_id}`}>
                        <Icon name="arrow-up-right-from-square" /> Open server
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "redeem" && <RedeemPanel servers={servers} workloads={workloads} onDone={load} />}

      {selectedPlan && (
        <CheckoutModal
          plan={selectedPlan}
          methods={methods}
          servers={servers}
          ownedServers={ownedServers}
          workloads={workloads}
          onClose={() => setSelected(null)}
          onCreated={() => {
            setSelected(null);
            setTab("orders");
            load();
          }}
        />
      )}

      {proofOrder && (
        <ProofModal
          order={proofOrder}
          onClose={() => setProofOrder(null)}
          onSaved={() => {
            setProofOrder(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function CheckoutModal({
  plan,
  methods,
  servers,
  ownedServers,
  workloads,
  onClose,
  onCreated,
}: {
  plan: Plan;
  methods: PaymentMethod[];
  servers: Server[];
  ownedServers: number;
  workloads: WorkloadOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const slotsFull = ownedServers >= plan.server_slots;
  const [methodId, setMethodId] = useState(methods[0]?.id || 0);
  const [mode, setMode] = useState<"new" | "existing">(() =>
    slotsFull && servers.length > 0 ? "existing" : "new"
  );
  const [target, setTarget] = useState(servers[0]?.id || "");
  const [eggId, setEggId] = useState(workloads[0]?.id || 0);
  const [serverName, setServerName] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState("");
  const [proofName, setProofName] = useState("");
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const method = methods.find((item) => item.id === methodId);

  async function attach(file?: File) {
    if (!file) return;
    try {
      const data = await readImage(file);
      setProof(data);
      setProofName(file.name);
    } catch (err: any) {
      notify(err.message, "error");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!method) {
      notify("Choose a payment method", "error");
      return;
    }
    if (mode === "existing" && !target) {
      notify("Choose a server to upgrade", "error");
      return;
    }
    if (mode === "new" && !eggId) {
      notify("Choose a workload template", "error");
      return;
    }
    if (mode === "new" && slotsFull) {
      notify(
        `This plan includes ${slotsLabel(plan.server_slots)} and your account already uses them. Apply it to an existing server or choose a larger plan.`,
        "error"
      );
      return;
    }
    setBusy(true);
    try {
      await api.createOrder({
        plan_id: plan.id,
        payment_method_id: method.id,
        target_server_id: mode === "existing" ? target : null,
        server_name: mode === "new" ? serverName : "",
        egg_id: mode === "new" ? eggId : null,
        reference,
        notes,
        proof_data: proof,
        terms_accepted: terms,
      });
      notify("Order created. The owner will review your receipt.");
      onCreated();
    } catch (err: any) {
      notify(err.message || "The order could not be created", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${plan.name} checkout`}
      description="Your order stays pending until the owner verifies payment."
      size="wide"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="checkout-form" className="btn btn-primary" disabled={busy || (mode === "new" && slotsFull)}>
            <Icon name={busy ? "circle-notch" : "paper-plane"} className={busy ? "spin" : ""} />
            {busy ? "Creating order" : "Place order"}
          </button>
        </>
      }
    >
      <form id="checkout-form" className="checkout-layout" onSubmit={submit}>
        <div className="checkout-main">
          <section className="checkout-section">
            <div className="checkout-heading">
              <span className="eyebrow">Destination</span>
              <h3>Where should the plan be applied?</h3>
            </div>
            <div className="choice-grid">
              <button
                type="button"
                className={`choice-card ${mode === "new" ? "active" : ""}`}
                onClick={() => setMode("new")}
                disabled={slotsFull}
              >
                <Icon name="server" />
                <div><strong>New deployment</strong><span>{slotsFull ? "No deployment slots remain on this plan" : "A new server using this plan"}</span></div>
              </button>
              <button
                type="button"
                className={`choice-card ${mode === "existing" ? "active" : ""}`}
                onClick={() => setMode("existing")}
                disabled={servers.length === 0}
              >
                <Icon name="arrows-rotate" />
                <div><strong>Existing server</strong><span>{slotsFull ? "Keep your servers and apply the plan limits" : "Apply the plan limits in place"}</span></div>
              </button>
            </div>
            <div className={`checkout-slots ${slotsFull ? "is-full" : ""}`}>
              <div className="checkout-slots-head">
                <span><Icon name="layer-group" /> Deployment slots</span>
                <strong>
                  {ownedServers === 1 ? "1 deployment" : `${ownedServers} deployments`}
                  {" · "}
                  {plan.server_slots === 1 ? "1 slot" : `${plan.server_slots} slots`}
                </strong>
              </div>
              <div className="meter-track">
                <span
                  className={`meter-fill ${slotsFull ? "warning" : ""}`}
                  style={{ width: `${Math.min(100, (ownedServers / plan.server_slots) * 100)}%` }}
                />
              </div>
              <p>
                {slotsFull
                  ? `This plan's ${slotsLabel(plan.server_slots)} ${plan.server_slots === 1 ? "is" : "are"} already in use. Apply this plan to an existing server or choose a plan with more capacity.`
                  : `${plan.server_slots - ownedServers} of ${slotsLabel(plan.server_slots)} remain available for a new deployment.`}
              </p>
            </div>
            {mode === "existing" ? (
              <label className="field">
                <span>Server</span>
                <select value={target} onChange={(event) => setTarget(event.target.value)}>
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>{server.name} · {server.plan?.name || "No plan"}</option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="field-row">
                <label className="field">
                  <span>Server name</span>
                  <input value={serverName} onChange={(event) => setServerName(event.target.value)} placeholder={`${plan.name} deployment`} maxLength={80} />
                </label>
                <label className="field">
                  <span>Workload template</span>
                  <select value={eggId} onChange={(event) => setEggId(Number(event.target.value))}>
                    {workloads.map((workload) => (
                      <option key={workload.id} value={workload.id}>{workload.nest_name} / {workload.name}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          </section>

          <section className="checkout-section">
            <div className="checkout-heading">
              <span className="eyebrow">Payment</span>
              <h3>Send the exact total</h3>
            </div>
            {methods.length === 0 ? (
              <div className="notice notice-warn">
                <Icon name="triangle-exclamation" />
                The owner has not configured a payment channel yet. Ask them to add a DANA or Touch 'n Go QR or account ID under Commerce.
              </div>
            ) : (
              <div className="method-grid">
                {methods.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`method-card ${methodId === item.id ? "active" : ""}`}
                    onClick={() => setMethodId(item.id)}
                  >
                    <span className={`method-icon kind-${item.kind}`}><Icon name={item.kind.includes("tng") ? "wallet" : item.kind.includes("dana") ? "qrcode" : "building-columns"} /></span>
                    <span><strong>{item.name}</strong><small>{item.qr_image ? "QR payment" : item.account_id ? "Account transfer" : "Manual transfer"}</small></span>
                    {methodId === item.id && <Icon name="circle-check" />}
                  </button>
                ))}
              </div>
            )}
            {method && (
              <div className="payment-detail">
                <div className="payment-detail-head">
                  <div>
                    <span className="eyebrow">Send to</span>
                    <h4>{method.account_name || plan.name}</h4>
                  </div>
                  <span className="payment-total">{money(plan.price_cents, plan.currency)}</span>
                </div>
                <div className="payment-detail-grid">
                  {method.qr_image && (
                    <a className="payment-qr" href={method.qr_image} target="_blank" rel="noreferrer">
                      <img src={method.qr_image} alt={`${method.name} payment QR`} />
                      <span>Open QR</span>
                    </a>
                  )}
                  <div className="payment-instructions">
                    {method.account_id && (
                      <div className="payment-account">
                        <span>Account / wallet</span>
                        <code>{method.account_id}</code>
                        <CopyButton value={method.account_id} label="Copy account" className="btn btn-ghost btn-xs" />
                      </div>
                    )}
                    <p>{method.instructions || "Transfer the exact order total and attach a clear receipt."}</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="checkout-section">
            <div className="checkout-heading">
              <span className="eyebrow">Proof</span>
              <h3>Receipt and reference</h3>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Transfer reference</span>
                <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="DANA transaction ID" maxLength={120} />
              </label>
              <label className="field">
                <span>Note to the owner</span>
                <input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional" maxLength={600} />
              </label>
            </div>
            <label className={`upload-zone ${proof ? "has-file" : ""}`}>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => attach(event.target.files?.[0])} />
              <Icon name={proof ? "circle-check" : "cloud-arrow-up"} />
              <div>
                <strong>{proofName || "Attach payment receipt"}</strong>
                <span>{proof ? "Replace receipt" : "PNG, JPEG or WebP under 2 MB"}</span>
              </div>
            </label>
            {proof && <img className="receipt-preview" src={proof} alt="Payment receipt preview" />}
            <label className="check-row">
              <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />
              <span>I accept the acceptable-use policy and understand the owner verifies this payment manually.</span>
            </label>
          </section>
        </div>

        <aside className="checkout-summary">
          <span className="eyebrow">Order summary</span>
          <div className={`summary-plan plan-${plan.slug}`} style={{ "--plan-accent": plan.accent } as CSSProperties}>
            <div className="summary-plan-art"><Icon name={planIcon(plan)} /></div>
            <h3>{plan.name}</h3>
            <span>{plan.tagline}</span>
          </div>
          <div className="summary-lines">
            <span><b>Memory</b>{plan.memory >= 1024 ? `${plan.memory / 1024} GB` : `${plan.memory} MB`}</span>
            <span><b>CPU</b>{plan.cpu}%</span>
            <span><b>Disk</b>{plan.disk >= 1024 ? `${Math.round(plan.disk / 1024)} GB` : `${plan.disk} MB`}</span>
            <span><b>Duration</b>30 days</span>
          </div>
          <div className="summary-total">
            <span>Total due</span>
            <strong>{money(plan.price_cents, plan.currency)}</strong>
          </div>
          <p className="summary-note">
            <Icon name="clock" /> Your order remains pending until the owner verifies the receipt and approves it.
          </p>
        </aside>
      </form>
    </Modal>
  );
}

function ProofModal({
  order,
  onClose,
  onSaved,
}: {
  order: BillingOrder;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reference, setReference] = useState(order.reference || "");
  const [notes, setNotes] = useState(order.notes || "");
  const [proof, setProof] = useState(order.proof_data || "");
  const [proofName, setProofName] = useState(order.proof_data ? "Current receipt attached" : "");
  const [busy, setBusy] = useState(false);

  async function attach(file?: File) {
    if (!file) return;
    try {
      const data = await readImage(file);
      setProof(data);
      setProofName(file.name);
    } catch (err: any) {
      notify(err.message, "error");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api.updateOrderProof(order.id, { reference, notes, proof_data: proof });
      notify("Receipt updated");
      onSaved();
    } catch (err: any) {
      notify(err.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Update ${order.code}`}
      description="The owner sees this receipt before approving the order."
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          <button type="submit" form="proof-form" className="btn btn-primary" disabled={busy}>
            <Icon name={busy ? "circle-notch" : "floppy-disk"} className={busy ? "spin" : ""} /> Save receipt
          </button>
        </>
      }
    >
      <form id="proof-form" className="form" onSubmit={submit}>
        <label className="field">
          <span>Transfer reference</span>
          <input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} />
        </label>
        <label className="field">
          <span>Note to the owner</span>
          <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={600} />
        </label>
        <label className={`upload-zone ${proof ? "has-file" : ""}`}>
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => attach(event.target.files?.[0])} />
          <Icon name="cloud-arrow-up" />
          <div><strong>{proofName || "Attach a receipt"}</strong><span>PNG, JPEG or WebP under 2 MB</span></div>
        </label>
        {proof && <img className="receipt-preview" src={proof} alt="Payment receipt preview" />}
      </form>
    </Modal>
  );
}

function RedeemPanel({
  servers,
  workloads,
  onDone,
}: {
  servers: Server[];
  workloads: WorkloadOption[];
  onDone: () => void;
}) {
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [target, setTarget] = useState(servers[0]?.id || "");
  const [eggId, setEggId] = useState(workloads[0]?.id || 0);
  const [serverName, setServerName] = useState("");
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult("");
    try {
      const response = await api.redeemCode({
        code,
        target_server_id: mode === "existing" ? target : null,
        server_name: mode === "new" ? serverName : "",
        egg_id: mode === "new" ? eggId : null,
        terms_accepted: terms,
      });
      setResult(response.server ? `Plan applied to ${response.server.name}.` : "Code redeemed.");
      setCode("");
      notify("Redeem code accepted");
      onDone();
    } catch (err: any) {
      notify(err.message || "The code could not be redeemed", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="redeem-layout">
      <div className="redeem-card">
        <span className="redeem-emblem"><Icon name="gift" /></span>
        <span className="eyebrow">Redeem</span>
        <h2>Have a plan code?</h2>
        <p>Redeem codes provision the plan immediately. They do not require a payment receipt or owner review.</p>
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Redeem code</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              placeholder="MDN-GIFT-XXXX-XXXX"
              autoComplete="off"
              required
            />
          </label>
          <div className="choice-grid">
            <button type="button" className={`choice-card ${mode === "new" ? "active" : ""}`} onClick={() => setMode("new")}>
              <Icon name="server" /><div><strong>New deployment</strong><span>Provision a new server</span></div>
            </button>
            <button
              type="button"
              className={`choice-card ${mode === "existing" ? "active" : ""}`}
              onClick={() => setMode("existing")}
              disabled={servers.length === 0}
            >
              <Icon name="arrows-rotate" /><div><strong>Existing server</strong><span>Apply the plan in place</span></div>
            </button>
          </div>
          {mode === "existing" ? (
            <label className="field">
              <span>Server</span>
              <select value={target} onChange={(event) => setTarget(event.target.value)}>
                {servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
              </select>
            </label>
          ) : (
            <div className="field-row">
              <label className="field">
                <span>Server name</span>
                <input value={serverName} onChange={(event) => setServerName(event.target.value)} placeholder="Gift deployment" maxLength={80} />
              </label>
              <label className="field">
                <span>Workload template</span>
                <select value={eggId} onChange={(event) => setEggId(Number(event.target.value))}>
                  {workloads.map((workload) => (
                    <option key={workload.id} value={workload.id}>{workload.nest_name} / {workload.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <label className="check-row">
            <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} />
            <span>I accept the acceptable-use policy.</span>
          </label>
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !code.trim()}>
            <Icon name={busy ? "circle-notch" : "gift"} className={busy ? "spin" : ""} />
            {busy ? "Redeeming" : "Redeem code"}
          </button>
          {result && <div className="notice notice-ok"><Icon name="circle-check" /> {result}</div>}
        </form>
      </div>
      <div className="redeem-aside">
        <h3>Redemption notes</h3>
        <div className="redeem-note"><Icon name="lock" /><span>Codes are unique to your account and cannot be reused.</span></div>
        <div className="redeem-note"><Icon name="clock" /><span>An expired or exhausted code is rejected before capacity is changed.</span></div>
        <div className="redeem-note"><Icon name="shield-halved" /><span>The same acceptable-use policy and security detection apply to gifted plans.</span></div>
        <Link to="/billing" className="btn btn-ghost" onClick={() => undefined}>
          <Icon name="layer-group" /> Compare paid plans
        </Link>
      </div>
    </section>
  );
}
