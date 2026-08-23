"use client";

import { X } from "lucide-react";
import { useState } from "react";

export type AdminActionImpact = {
  label: string;
  value: string;
  tone?: "default" | "warning" | "danger";
};

export type AdminActionDialogOptions = {
  title: string;
  label: string;
  description?: string;
  impact?: AdminActionImpact[];
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  inputType?: "text" | "password" | "number";
  multiline?: boolean;
  required?: boolean;
  confirmationOnly?: boolean;
  expectedValue?: string;
  tone?: "default" | "danger";
};

function AdminActionDialog({
  options,
  onCancel,
  onConfirm,
}: {
  options: AdminActionDialogOptions;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(options.initialValue ?? "");
  const normalizedValue = value.trim();
  const invalid = !options.confirmationOnly && (
    (options.required !== false && !normalizedValue)
    || (options.expectedValue !== undefined && normalizedValue !== options.expectedValue)
  );

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className={`modal-sheet admin-prompt-dialog admin-action-dialog ${options.tone === "danger" ? "is-danger" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-action-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div><span className="eyebrow">ACTION REVIEW</span><h2 id="admin-action-dialog-title">{options.title}</h2></div>
          <button className="icon-button" aria-label="取消操作" onClick={onCancel}><X size={20} /></button>
        </div>
        {options.description && <p className="admin-confirm-description">{options.description}</p>}
        {options.impact?.length ? (
          <dl className="admin-action-impact" aria-label="操作影响预览">
            {options.impact.map((item) => (
              <div className={item.tone ? `is-${item.tone}` : ""} key={`${item.label}-${item.value}`}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {!options.confirmationOnly && <div className="field">
          <label htmlFor="admin-action-dialog-value">{options.label}</label>
          {options.multiline
            ? <textarea id="admin-action-dialog-value" autoFocus rows={4} value={value} placeholder={options.placeholder} onChange={(event) => setValue(event.target.value)} />
            : <input id="admin-action-dialog-value" autoFocus type={options.inputType ?? "text"} value={value} placeholder={options.placeholder} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !invalid) onConfirm(value); }} />}
          {options.expectedValue !== undefined && <small className="field-hint">请输入“{options.expectedValue}”以继续。</small>}
        </div>}
        <div className="admin-panel-actions">
          <button className="secondary-button" onClick={onCancel}>返回修改</button>
          <button className={options.tone === "danger" ? "danger-button" : "primary-button"} disabled={invalid} onClick={() => onConfirm(value)}>{options.confirmLabel ?? "确认"}</button>
        </div>
      </section>
    </div>
  );
}

export function useAdminActionDialog() {
  const [request, setRequest] = useState<{
    options: AdminActionDialogOptions;
    resolve: (value: string | null) => void;
  } | null>(null);

  function ask(options: AdminActionDialogOptions) {
    return new Promise<string | null>((resolve) => setRequest({ options, resolve }));
  }

  function finish(value: string | null) {
    const current = request;
    setRequest(null);
    current?.resolve(value);
  }

  return {
    ask,
    dialog: request
      ? <AdminActionDialog options={request.options} onCancel={() => finish(null)} onConfirm={(value) => finish(value)} />
      : null,
  };
}
