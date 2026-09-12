import type { CredentialCheck } from "./credentialImport";

export function CredentialCheckList({ checks }: { checks: CredentialCheck[] }) {
  if (!checks.length) return null;
  return (
    <div className="credential-check-list" role="status" aria-live="polite">
      {checks.map(check => (
        <div key={check.field} className={`credential-check ${check.status}`}>
          <span aria-hidden="true">{check.status === "valid" ? "✓" : check.status === "invalid" ? "×" : "…"}</span>
          <div>
            <b>{check.label}</b>
            <small>{check.detail}</small>
          </div>
          <em>{check.status === "valid" ? "Работает" : check.status === "invalid" ? "Не работает" : "Не подтверждён"}</em>
        </div>
      ))}
    </div>
  );
}
