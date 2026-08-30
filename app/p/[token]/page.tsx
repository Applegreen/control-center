import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProposalByToken } from "@/lib/server/proposals-db";
import { STUDIO, studioAddressLines, studioIdentityLines } from "@/lib/server/proposal-render";
import {
  formatMoney,
  formatProposalDate,
  kindLabel,
  lineTotal,
  proposalTotals,
} from "@/lib/proposals";

// The public, shareable view. Reached by an unguessable token, so it sits outside the
// dashboard's Basic Auth (see the nginx location block in the deployment notes).
// Nothing here is editable and no other proposal is reachable from it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const proposal = getProposalByToken(token);
  if (!proposal) return { title: "Not found" };
  return {
    title: `${proposal.projectTitle || kindLabel(proposal.kind)} · ${STUDIO.name}`,
    description: proposal.summary || undefined,
    robots: { index: false, follow: false },
  };
}

export default async function PublicProposalPage({ params }: Props) {
  const { token } = await params;
  const proposal = getProposalByToken(token);
  if (!proposal) notFound();

  const totals = proposalTotals(proposal);

  return (
    <main className="pp">
      <header className="pp-letterhead">
        <div className="pp-lh-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/dc-letterhead-logo.png" alt={STUDIO.name} width={118} height={91} />
          {studioIdentityLines().map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        <div className="pp-lh-studio">
          {studioAddressLines().map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p className="pp-lh-doc">
            <strong>
              {kindLabel(proposal.kind)}: {proposal.number}
            </strong>
            <br />
            ISSUE DATE: {formatProposalDate(proposal.createdAt)}
            {proposal.validUntil ? (
              <>
                <br />
                VALID UNTIL: {formatProposalDate(proposal.validUntil)}
              </>
            ) : null}
          </p>
        </div>

        <div className="pp-lh-client">
          <p className="pp-lh-to">To:</p>
          {proposal.clientName ? <p className="pp-lh-name">{proposal.clientName}</p> : null}
          {proposal.clientContact ? <p>{proposal.clientContact}</p> : null}
          {(proposal.clientAddress || "")
            .split("\n")
            .filter((line) => line.trim())
            .map((line, index) => (
              <p key={index}>{line.trim()}</p>
            ))}
        </div>
      </header>

      <section className="pp-title">
        <h1>{proposal.projectTitle || kindLabel(proposal.kind)}</h1>
        {proposal.summary ? <p className="pp-summary">{proposal.summary}</p> : null}
      </section>

      {proposal.sections
        .filter((section) => section.heading || section.body)
        .map((section) => (
          <section className="pp-section" key={section.id}>
            {section.heading ? <h2>{section.heading}</h2> : null}
            {(section.body || "")
              .split("\n")
              .filter((line) => line.trim())
              .map((line, index) => (
                <p key={index}>{line}</p>
              ))}
          </section>
        ))}

      {proposal.items.length ? (
        <section className="pp-section">
          <h2>Investment</h2>
          <table className="pp-table">
            <thead>
              <tr>
                <th>Description</th>
                <th className="pp-num">Qty</th>
                <th>Unit</th>
                <th className="pp-num">Rate</th>
                <th className="pp-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {proposal.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.description || "—"}</strong>
                    {item.detail ? <span className="pp-detail">{item.detail}</span> : null}
                  </td>
                  <td className="pp-num">{item.quantity}</td>
                  <td>{item.unit}</td>
                  <td className="pp-num">{formatMoney(item.unitRate, proposal.currency)}</td>
                  <td className="pp-num pp-amount">
                    {formatMoney(lineTotal(item), proposal.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="pp-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatMoney(totals.subtotal, proposal.currency)}</dd>
            </div>
            {totals.discount > 0 ? (
              <div>
                <dt>Discount</dt>
                <dd>−{formatMoney(totals.discount, proposal.currency)}</dd>
              </div>
            ) : null}
            <div>
              <dt>VAT ({proposal.vatRate}%)</dt>
              <dd>{formatMoney(totals.vat, proposal.currency)}</dd>
            </div>
            <div className="pp-grand">
              <dt>Total</dt>
              <dd>{formatMoney(totals.total, proposal.currency)}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {proposal.terms ? (
        <section className="pp-section pp-terms">
          <h2>Terms</h2>
          {proposal.terms
            .split("\n")
            .filter((line) => line.trim())
            .map((line, index) => (
              <p key={index}>{line}</p>
            ))}
        </section>
      ) : null}

      <footer className="pp-foot">
        <p>{studioAddressLines().join(" · ")}</p>
        <p>
          {STUDIO.email} · {STUDIO.phone} · {STUDIO.site}
        </p>
        <p>{studioIdentityLines().join(" · ")}</p>
      </footer>
    </main>
  );
}
