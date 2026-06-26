import type { ReactNode } from "react";
import { describeReason } from "./reasons";
import type { AuditChain, MandateNode } from "./types";
import type { PollStatus } from "./use-polling";
import { Card, EmptyState, ErrorState, LoadingBlock, Money, Pill, SectionLabel } from "./ui";

const SIGNER_LABEL: Record<string, string> = {
  intent: "Signed by the principal",
  cart: "Signed by the vendor",
  payment: "Signed by the agent",
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function MandateCard({ node }: { node: MandateNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <div className="font-medium capitalize">{node.type}</div>
        <Pill tone="brand">{SIGNER_LABEL[node.type] ?? node.type}</Pill>
      </div>
      <div className="mt-4 space-y-3">
        <Field label="Content hash">
          <code className="block break-all font-mono text-xs text-ink">{node.contentHash}</code>
        </Field>
        <Field label="Signature">
          <code className="block break-all font-mono text-xs text-muted">{node.signature}</code>
        </Field>
        <Field label="Scope">
          <pre className="overflow-x-auto rounded-lg bg-raised p-3 font-mono text-xs leading-relaxed text-muted">
            {JSON.stringify(node.scope, null, 2)}
          </pre>
        </Field>
      </div>
    </Card>
  );
}

// Walk one approved purchase's tamper-evident receipt: intent, then cart, then payment, each with
// its content hash and signature, so a viewer can see the chain that authorized the charge.
export function AuditView({
  status,
  data,
  error,
  onRetry,
}: {
  status: PollStatus;
  data: AuditChain | null;
  error: string | null;
  onRetry?: () => void;
}) {
  if (status === "loading" && !data) {
    return <LoadingBlock label="Loading audit" rows={3} />;
  }
  if (status === "error" && !data) {
    return <ErrorState message={error ?? "Could not load the audit chain."} onRetry={onRetry} />;
  }
  if (!data) {
    return <EmptyState title="Not found" hint="No audit record exists for this transaction." />;
  }

  const { transaction, intent, cart, payment } = data;
  const chain = [intent, cart, payment].filter((node): node is MandateNode => node !== null);
  const decision = describeReason(transaction.status, transaction.reason);

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <SectionLabel>Transaction</SectionLabel>
            <div className="mt-1 flex items-baseline gap-2">
              <Money cents={transaction.amountCents} className="text-lg font-semibold" />
              {transaction.category ? (
                <span className="text-sm text-muted">{transaction.category}</span>
              ) : null}
            </div>
            <div className="mt-1 truncate text-sm text-muted">
              {transaction.vendor ?? "unknown vendor"}
            </div>
          </div>
          <Pill tone={decision.group}>{decision.label}</Pill>
        </div>
      </Card>

      {chain.length === 0 ? (
        <EmptyState title="No mandate chain" hint="A blocked purchase carries no signed chain." />
      ) : (
        <div className="space-y-3">
          {chain.map((node, index) => (
            <div key={node.id}>
              <MandateCard node={node} />
              {index < chain.length - 1 ? (
                <div className="flex justify-center py-1 text-lg text-faint" aria-hidden>
                  ↓
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
