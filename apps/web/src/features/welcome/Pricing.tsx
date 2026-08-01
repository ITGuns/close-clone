import { useState } from 'react';
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { PRICING, PRICING_TIERS } from './copy.ts';

/*
 * Per-seat pricing for a single-tenant, internal tool — a Team/Scale ladder plus
 * a self-host Enterprise tier, never a consumer freemium. The monthly/annual
 * toggle swaps the displayed amount to the annual-equivalent (2 months free);
 * it is pure client state and needs no motion. Every plan CTA routes to the
 * same SSO gate as the rest of the page.
 */
export function Pricing(): JSX.Element {
  const [annual, setAnnual] = useState(false);

  return (
    <section id="welcome-pricing" className="sb-welcome__pricing" aria-label="Pricing">
      <header className="sb-welcome__section-head">
        <p className="sb-welcome__eyebrow">{PRICING.eyebrow}</p>
        <h2 className="sb-welcome__section-title">{PRICING.title}</h2>
        <p className="sb-welcome__section-sub">{PRICING.sub}</p>
      </header>

      <div className="sb-welcome__bill" role="group" aria-label="Billing period">
        <button
          type="button"
          className="sb-welcome__bill-btn"
          data-on={!annual || undefined}
          aria-pressed={!annual}
          onClick={() => setAnnual(false)}
        >
          {PRICING.monthly}
        </button>
        <button
          type="button"
          className="sb-welcome__bill-btn"
          data-on={annual || undefined}
          aria-pressed={annual}
          onClick={() => setAnnual(true)}
        >
          {PRICING.annual}
          <span className="sb-welcome__bill-save"> — {PRICING.annualNote}</span>
        </button>
      </div>

      <ul className="sb-welcome__prices">
        {PRICING_TIERS.map((tier) => {
          const amount = annual ? tier.annual : tier.monthly;
          return (
            <li key={tier.id} className="sb-welcome__price" data-featured={tier.featured || undefined}>
              {tier.featured ? <span className="sb-welcome__price-badge">Most teams</span> : null}
              <p className="sb-welcome__price-name">{tier.name}</p>
              <p className="sb-welcome__price-value">
                {amount ? (
                  <>
                    <span className="sb-welcome__price-cur">$</span>
                    <span className="sb-welcome__price-amt sb-welcome__mono">{amount}</span>
                    <span className="sb-welcome__price-unit sb-welcome__mono">{tier.unit}</span>
                  </>
                ) : (
                  <span className="sb-welcome__price-txt">Let’s talk</span>
                )}
              </p>
              <p className="sb-welcome__price-note">{tier.note}</p>
              {tier.ctaHref.startsWith('#') ? (
                <a
                  href={tier.ctaHref}
                  className={`sb-welcome__price-cta sb-welcome__price-cta--${tier.featured ? 'primary' : 'ghost'}`}
                >
                  {tier.cta}
                </a>
              ) : (
                <Link
                  to={tier.ctaHref}
                  className={`sb-welcome__price-cta sb-welcome__price-cta--${tier.featured ? 'primary' : 'ghost'}`}
                >
                  {tier.cta}
                </Link>
              )}
              <ul className="sb-welcome__price-list">
                {tier.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
