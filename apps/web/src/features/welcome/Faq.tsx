import type { JSX } from 'react';
import { FAQ, FAQ_ITEMS } from './copy.ts';
import { useReveal } from './useReveal.ts';

/*
 * Landing FAQ — native <details> so each answer is keyboard-operable and
 * screen-reader-legible with zero JS, and the +→× affordance is pure CSS. Answers
 * are real facts about what the product is and how access is gated, not froth.
 */
export function Faq(): JSX.Element {
  const { ref, revealed } = useReveal<HTMLElement>();
  return (
    <section
      ref={ref}
      id="welcome-faq"
      className="sb-welcome__faq sb-welcome__rise"
      data-reveal={revealed ? 'in' : 'out'}
      aria-label="Frequently asked questions"
    >
      <header className="sb-welcome__section-head sb-welcome__section-head--center">
        <p className="sb-welcome__eyebrow">{FAQ.eyebrow}</p>
        <h2 className="sb-welcome__section-title">{FAQ.title}</h2>
      </header>
      <div className="sb-welcome__faq-list">
        {FAQ_ITEMS.map((item) => (
          <details key={item.q} className="sb-welcome__faq-item">
            <summary className="sb-welcome__faq-q">
              <span>{item.q}</span>
              <span className="sb-welcome__faq-plus" aria-hidden="true">
                +
              </span>
            </summary>
            <p className="sb-welcome__faq-a">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
