"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, FileText, LoaderCircle, Mail, MapPin, Phone, Plus, Users, X } from "lucide-react";
import { api, json } from "@/lib/api";

type ClientRecord = { id: string; name: string };
type Contact = { id: string; full_name: string; title?: string | null; email?: string | null; phone?: string | null; office_id?: string | null; is_primary: boolean; notes?: string | null; archived_at?: string | null };
type Office = { id: string; name: string; address?: string | null; city?: string | null; state?: string | null; country: string; postal_code?: string | null; archived_at?: string | null };
type Contract = { id: string; title: string; contract_number?: string | null; status: string; fee_model: string; fee_value: number; currency: string; valid_from?: string | null; valid_until?: string | null; guarantee_months: number; payment_terms?: string | null; notes?: string | null };
type ActivityRow = { id: string; activity_type: string; subject: string; details?: string | null; happened_at: string };
type CRM = { contacts: Contact[]; offices: Office[]; contracts: Contract[]; contracts_visible: boolean; activities: ActivityRow[] };
type Tab = "contacts" | "offices" | "contracts" | "activity";
type Editor = { kind: Exclude<Tab, "activity">; record?: Contact | Office | Contract };

function dateLabel(value?: string | null) { return value ? new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"; }
function asText(form: FormData, key: string) { return String(form.get(key) || "").trim(); }

export function ClientCrmModal({ client, token, canManageContracts, onClose, onError, onToast }: {
  client: ClientRecord; token: string; canManageContracts: boolean; onClose: () => void; onError: (message: string) => void; onToast: (message: string) => void;
}) {
  const [crm, setCrm] = useState<CRM | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("contacts");
  const [editor, setEditor] = useState<Editor | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCrm(await api<CRM>(`/clients/${client.id}/crm`, token)); }
    catch (error) { onError(error instanceof Error ? error.message : "Could not load client records."); }
    finally { setLoading(false); }
  }, [client.id, token, onError]);

  useEffect(() => { void load(); }, [load]);

  async function saveRecord(event: React.FormEvent<HTMLFormElement>, kind: Exclude<Tab, "activity">) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const editing = editor?.kind === kind ? editor.record : undefined;
    const basePath = `/clients/${client.id}/${kind}`;
    let payload: Record<string, unknown>;
    if (kind === "contacts") {
      payload = { full_name: asText(form, "full_name"), title: asText(form, "title") || null, email: asText(form, "email") || null, phone: asText(form, "phone") || null, office_id: asText(form, "office_id") || null, is_primary: form.get("is_primary") === "on", notes: asText(form, "notes") || null };
    } else if (kind === "offices") {
      payload = { name: asText(form, "name"), address: asText(form, "address") || null, city: asText(form, "city") || null, state: asText(form, "state") || null, country: asText(form, "country") || "India", postal_code: asText(form, "postal_code") || null, notes: asText(form, "notes") || null };
    } else {
      const feeValue = Number(asText(form, "fee_value"));
      const guaranteeMonths = Number(asText(form, "guarantee_months") || "0");
      payload = { title: asText(form, "title"), contract_number: asText(form, "contract_number") || null, status: asText(form, "status"), fee_model: asText(form, "fee_model"), fee_value: feeValue, currency: asText(form, "currency").toUpperCase() || "INR", valid_from: asText(form, "valid_from") || null, valid_until: asText(form, "valid_until") || null, guarantee_months: guaranteeMonths, payment_terms: asText(form, "payment_terms") || null, notes: asText(form, "notes") || null };
    }
    setSaving(true);
    try {
      await api(`${basePath}${editing ? `/${editing.id}` : ""}`, token, { method: editing ? "PATCH" : "POST", body: json(payload) });
      setEditor(null); await load(); onToast(editing ? "Client record updated" : "Client record added");
    } catch (error) { onError(error instanceof Error ? error.message : "Could not save client record."); }
    finally { setSaving(false); }
  }

  async function archive(kind: "contacts" | "offices", record: Contact | Office) {
    try {
      await api(`/clients/${client.id}/${kind}/${record.id}`, token, { method: "PATCH", body: json({ archived_at: new Date().toISOString() }) });
      await load(); onToast("Client record archived");
    } catch (error) { onError(error instanceof Error ? error.message : "Could not archive client record."); }
  }

  async function addActivity(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const target = event.currentTarget; const form = new FormData(target);
    setSaving(true);
    try {
      await api(`/clients/${client.id}/activities`, token, { method: "POST", body: json({ activity_type: asText(form, "activity_type"), subject: asText(form, "subject"), details: asText(form, "details") || null }) });
      target.reset(); await load(); onToast("Client activity recorded");
    } catch (error) { onError(error instanceof Error ? error.message : "Could not record client activity."); }
    finally { setSaving(false); }
  }

  const visibleContacts = (crm?.contacts || []).filter(item => !item.archived_at);
  const visibleOffices = (crm?.offices || []).filter(item => !item.archived_at);
  const officesById = new Map((crm?.offices || []).map(office => [office.id, office.name]));
  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "contacts", label: "Contacts", icon: Users }, { id: "offices", label: "Offices", icon: MapPin },
    ...(canManageContracts ? [{ id: "contracts" as const, label: "Contracts", icon: FileText }] : []),
    { id: "activity", label: "Activity", icon: Activity },
  ];
  const activeEditor = editor?.kind === tab ? editor.record : undefined;
  const edit = (kind: Editor["kind"], record?: Contact | Office | Contract) => { setTab(kind); setEditor({ kind, record }); };

  return <div className="modal-backdrop client-crm-backdrop" onClick={onClose}>
    <section className="modal modal-wide client-crm-modal" onClick={event => event.stopPropagation()} aria-labelledby="client-crm-title">
      <div className="modal-header"><div><div className="eyebrow">CLIENT RELATIONSHIP</div><h2 id="client-crm-title">{client.name}</h2><p>Keep account contacts, locations, agreements, and relationship history together.</p></div><button className="icon-button" aria-label="Close client records" onClick={onClose}><X size={18} /></button></div>
      <div className="client-crm-tabs" role="tablist" aria-label="Client records">{tabs.map(item => { const Icon = item.icon; return <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => { setTab(item.id); setEditor(null); }}><Icon size={14} />{item.label}</button>; })}</div>
      {loading ? <div className="loading-inline"><LoaderCircle size={16} className="spin" /> Loading client records…</div> : !crm ? <div className="client-crm-empty">Client records could not be loaded. Close this panel and retry.</div> : <div className="client-crm-body">
        {tab === "contacts" && <>
          <div className="client-crm-section-head"><div><h3>People</h3><p>Maintain more than one hiring contact for this account.</p></div><button className="button button-primary button-small" onClick={() => edit("contacts")}><Plus size={14} /> Add contact</button></div>
          {editor?.kind === "contacts" && <form key={`contact-${(activeEditor as Contact | undefined)?.id || "new"}`} className="client-crm-form" onSubmit={event => saveRecord(event, "contacts")}>
            <div className="client-crm-form-grid"><label>Name<input name="full_name" required minLength={2} maxLength={180} defaultValue={(activeEditor as Contact | undefined)?.full_name || ""} /></label><label>Role or title<input name="title" maxLength={180} defaultValue={(activeEditor as Contact | undefined)?.title || ""} /></label><label>Email<input name="email" type="email" maxLength={254} defaultValue={(activeEditor as Contact | undefined)?.email || ""} /></label><label>Phone<input name="phone" type="tel" maxLength={40} defaultValue={(activeEditor as Contact | undefined)?.phone || ""} /></label><label>Office<select name="office_id" defaultValue={(activeEditor as Contact | undefined)?.office_id || ""}><option value="">No office selected</option>{visibleOffices.map(office => <option key={office.id} value={office.id}>{office.name}</option>)}</select></label><label className="client-crm-check"><input type="checkbox" name="is_primary" defaultChecked={(activeEditor as Contact | undefined)?.is_primary || false} /> Primary contact</label><label className="crm-form-wide">Notes<textarea name="notes" rows={2} maxLength={5000} defaultValue={(activeEditor as Contact | undefined)?.notes || ""} /></label></div>
            <div className="client-crm-form-actions"><button type="button" className="button button-secondary button-small" onClick={() => setEditor(null)}>Cancel</button><button className="button button-primary button-small" disabled={saving}>{saving ? "Saving…" : activeEditor ? "Save contact" : "Add contact"}</button></div>
          </form>}
          <div className="client-crm-records">{visibleContacts.map(contact => <article className="crm-record-card" key={contact.id}><div className="crm-record-main"><span className="crm-record-icon"><Users size={16} /></span><div><strong>{contact.full_name}{contact.is_primary && <span className="crm-primary-pill">Primary</span>}</strong><span>{contact.title || "Hiring contact"}{contact.office_id && officesById.get(contact.office_id) ? ` · ${officesById.get(contact.office_id)}` : ""}</span><div className="crm-record-meta">{contact.email && <a href={`mailto:${contact.email}`}><Mail size={12} />{contact.email}</a>}{contact.phone && <a href={`tel:${contact.phone}`}><Phone size={12} />{contact.phone}</a>}</div></div></div><div className="crm-record-actions"><button type="button" className="text-button" onClick={() => edit("contacts", contact)}>Edit</button><button type="button" className="text-button crm-archive" onClick={() => archive("contacts", contact)}>Archive</button></div></article>)}{!visibleContacts.length && !editor && <div className="client-crm-empty">No contacts yet. Add the people involved in hiring decisions.</div>}</div>
        </>}

        {tab === "offices" && <>
          <div className="client-crm-section-head"><div><h3>Offices</h3><p>Store the client’s hiring locations and office addresses.</p></div><button className="button button-primary button-small" onClick={() => edit("offices")}><Plus size={14} /> Add office</button></div>
          {editor?.kind === "offices" && <form key={`office-${(activeEditor as Office | undefined)?.id || "new"}`} className="client-crm-form" onSubmit={event => saveRecord(event, "offices")}>
            <div className="client-crm-form-grid"><label>Office name<input name="name" required maxLength={120} placeholder="Head office, Plant 2…" defaultValue={(activeEditor as Office | undefined)?.name || ""} /></label><label>Address<input name="address" maxLength={500} defaultValue={(activeEditor as Office | undefined)?.address || ""} /></label><label>City<input name="city" maxLength={120} defaultValue={(activeEditor as Office | undefined)?.city || ""} /></label><label>State or region<input name="state" maxLength={120} defaultValue={(activeEditor as Office | undefined)?.state || ""} /></label><label>Country<input name="country" required maxLength={120} defaultValue={(activeEditor as Office | undefined)?.country || "India"} /></label><label>Postal code<input name="postal_code" maxLength={30} defaultValue={(activeEditor as Office | undefined)?.postal_code || ""} /></label></div>
            <div className="client-crm-form-actions"><button type="button" className="button button-secondary button-small" onClick={() => setEditor(null)}>Cancel</button><button className="button button-primary button-small" disabled={saving}>{saving ? "Saving…" : activeEditor ? "Save office" : "Add office"}</button></div>
          </form>}
          <div className="client-crm-records">{visibleOffices.map(office => <article className="crm-record-card" key={office.id}><div className="crm-record-main"><span className="crm-record-icon"><MapPin size={16} /></span><div><strong>{office.name}</strong><span>{[office.city, office.state, office.country, office.postal_code].filter(Boolean).join(", ") || "Location not provided"}</span>{office.address && <small>{office.address}</small>}</div></div><div className="crm-record-actions"><button type="button" className="text-button" onClick={() => edit("offices", office)}>Edit</button><button type="button" className="text-button crm-archive" onClick={() => archive("offices", office)}>Archive</button></div></article>)}{!visibleOffices.length && !editor && <div className="client-crm-empty">No offices yet. Add a location to connect hiring contacts.</div>}</div>
        </>}

        {tab === "contracts" && <>
          <div className="client-crm-section-head"><div><h3>Recruitment agreements</h3><p>Record fee model, dates, guarantee, and payment terms. Fee terms are limited to management.</p></div><button className="button button-primary button-small" onClick={() => edit("contracts")}><Plus size={14} /> Add contract</button></div>
          {editor?.kind === "contracts" && <form key={`contract-${(activeEditor as Contract | undefined)?.id || "new"}`} className="client-crm-form" onSubmit={event => saveRecord(event, "contracts")}>
            <div className="client-crm-form-grid"><label>Agreement title<input name="title" required minLength={2} maxLength={180} defaultValue={(activeEditor as Contract | undefined)?.title || ""} /></label><label>Reference number<input name="contract_number" maxLength={100} defaultValue={(activeEditor as Contract | undefined)?.contract_number || ""} /></label><label>Status<select name="status" defaultValue={(activeEditor as Contract | undefined)?.status || "draft"}><option value="draft">Draft</option><option value="active">Active</option><option value="expired">Expired</option><option value="terminated">Terminated</option></select></label><label>Fee model<select name="fee_model" defaultValue={(activeEditor as Contract | undefined)?.fee_model || "percentage"}><option value="percentage">Percentage</option><option value="fixed">Fixed</option><option value="milestone">Milestone</option><option value="custom">Custom</option></select></label><label>Fee value<input name="fee_value" required type="number" min="0" max="100000000000" step="0.01" defaultValue={(activeEditor as Contract | undefined)?.fee_value ?? ""} /></label><label>Currency<input name="currency" required minLength={3} maxLength={3} defaultValue={(activeEditor as Contract | undefined)?.currency || "INR"} /></label><label>Valid from<input name="valid_from" type="date" defaultValue={(activeEditor as Contract | undefined)?.valid_from || ""} /></label><label>Valid until<input name="valid_until" type="date" defaultValue={(activeEditor as Contract | undefined)?.valid_until || ""} /></label><label>Guarantee (months)<input name="guarantee_months" type="number" min="0" max="36" defaultValue={(activeEditor as Contract | undefined)?.guarantee_months ?? 0} /></label><label className="crm-form-wide">Payment terms<input name="payment_terms" maxLength={2000} defaultValue={(activeEditor as Contract | undefined)?.payment_terms || ""} placeholder="For example: payable within 30 days of joining" /></label><label className="crm-form-wide">Notes<textarea name="notes" rows={2} maxLength={5000} defaultValue={(activeEditor as Contract | undefined)?.notes || ""} /></label></div>
            <div className="client-crm-form-actions"><button type="button" className="button button-secondary button-small" onClick={() => setEditor(null)}>Cancel</button><button className="button button-primary button-small" disabled={saving}>{saving ? "Saving…" : activeEditor ? "Save contract" : "Add contract"}</button></div>
          </form>}
          <div className="client-crm-records">{(crm.contracts || []).map(contract => <article className="crm-record-card" key={contract.id}><div className="crm-record-main"><span className="crm-record-icon"><FileText size={16} /></span><div><strong>{contract.title}<span className={`crm-contract-status crm-status-${contract.status}`}>{contract.status.replaceAll("_", " ")}</span></strong><span>{contract.fee_model} · {contract.currency} {Number(contract.fee_value).toLocaleString()}</span><small>{contract.valid_from ? dateLabel(contract.valid_from) : "No start date"} – {contract.valid_until ? dateLabel(contract.valid_until) : "No end date"} · {contract.guarantee_months} month guarantee</small>{contract.payment_terms && <small>{contract.payment_terms}</small>}</div></div><div className="crm-record-actions"><button type="button" className="text-button" onClick={() => edit("contracts", contract)}>Edit</button></div></article>)}{!crm.contracts.length && !editor && <div className="client-crm-empty">No agreement terms recorded yet.</div>}</div>
        </>}

        {tab === "activity" && <>
          <div className="client-crm-section-head"><div><h3>Relationship history</h3><p>Record calls, emails, meetings, and account notes. Changes to CRM records are logged here automatically.</p></div></div>
          <form className="client-crm-form crm-activity-form" onSubmit={addActivity}><div className="client-crm-form-grid"><label>Activity type<select name="activity_type"><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option></select></label><label>Subject<input name="subject" required maxLength={180} placeholder="Quarterly hiring review" /></label><label className="crm-form-wide">Details<textarea name="details" rows={2} maxLength={10000} placeholder="Add a short summary…" /></label></div><div className="client-crm-form-actions"><button className="button button-primary button-small" disabled={saving}>{saving ? "Saving…" : "Record activity"}</button></div></form>
          <div className="crm-activity-list">{crm.activities.map(item => <article className="crm-activity-row" key={item.id}><span className={`crm-activity-mark crm-activity-${item.activity_type}`}><Activity size={14} /></span><div><strong>{item.subject}</strong><span>{item.activity_type} · {dateLabel(item.happened_at)}</span>{item.details && <p>{item.details}</p>}</div></article>)}{!crm.activities.length && <div className="client-crm-empty">No activity recorded yet.</div>}</div>
        </>}
      </div>}
    </section>
  </div>;
}
