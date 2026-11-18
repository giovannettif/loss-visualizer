/**
 * sentences — RUNTIME sentence segmentation for the reader (tour model v2).
 *
 * Every paragraph (<p>) inside every .step__body is split into sentence
 * spans (`span.sent[data-sent]`) at boot, so a tour step can address one
 * SENTENCE — page + paragraph + sentence index — instead of a whole
 * paragraph element. The splitter walks TEXT NODES only:
 *
 *   - a sentence boundary is recognized in plain text only: a `.`, `!` or
 *     `?` run (optionally followed by closers like `"` or `)`) at a node
 *     position followed by whitespace (or end of text), and not followed by
 *     a lowercase word (decimals like `1.3064` and `η = 0.5` never split;
 *     nor do rare mid-sentence periods before lowercase);
 *   - element children (.look / .math / <em> / <code> / <strong> …) are
 *     moved INTO the open sentence span WHOLE — never walked into — so a
 *     sentence containing inline elements stays one unit;
 *   - inter-sentence whitespace stays in plain text nodes between spans.
 *
 * Segmentation is purely structural: no text changes, no CSS-visible
 * wrappers by default (the spans carry no styling until the tour or a
 * sentence hover marks them). `resolveSentence` is the single lookup the
 * tour engine, the hover-to-look graduation and the gates share.
 */

const SENT_CLASS = "sent";
const TERMINATORS = ".!?";
/** Quotes/brackets that may trail a terminator inside the same sentence. */
const CLOSERS = "'\"“”’’)]";

/** Indices (exclusive end) of every sentence end in a plain-text run. */
function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (!TERMINATORS.includes(text[i])) continue;
    // A run of terminators/closers ends together ("!", "?!", '."', "…)." ).
    let j = i;
    while (
      j + 1 < text.length &&
      (TERMINATORS.includes(text[j + 1]) || CLOSERS.includes(text[j + 1]))
    ) {
      j++;
    }
    const after = j + 1;
    // A terminator glued to more text is not a boundary (decimals, "a.b").
    if (after < text.length && !/\s/.test(text[after])) continue;
    // Skip the inter-sentence whitespace; a boundary needs a next word that
    // is not lowercase (sentence case), or the end of the text.
    let k = after;
    while (k < text.length && /\s/.test(text[k])) k++;
    if (k < text.length && /[a-z]/.test(text[k])) continue;
    ends.push(after);
    i = j;
  }
  return ends;
}

function segmentParagraph(p: HTMLElement): void {
  if (p.dataset.sentSegmented === "true") return;
  p.dataset.sentSegmented = "true";
  let cur: HTMLElement | null = null;
  let count = 0;
  const open = (): HTMLElement => {
    if (cur === null) {
      cur = document.createElement("span");
      cur.className = SENT_CLASS;
      cur.dataset.sent = String(count++);
      p.appendChild(cur);
    }
    return cur;
  };
  const close = (): void => {
    cur = null;
  };

  // Snapshot first: every original child is moved (appendChild) or replaced
  // while iterating, and the new spans are appended in processing order —
  // the final child order equals the reading order.
  for (const node of Array.from(p.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const ends = sentenceEnds(text);
      if (ends.length === 0) {
        if (cur === null && text.trim() === "") {
          // Whitespace between sentences stays outside the spans (the
          // original node just moves after the last span).
          p.appendChild(node);
        } else {
          open().appendChild(node);
        }
        continue;
      }
      let start = 0;
      for (const end of ends) {
        const seg = text.slice(start, end);
        if (seg !== "") open().appendChild(document.createTextNode(seg));
        close();
        start = end;
      }
      const rest = text.slice(start);
      if (rest !== "") {
        if (cur === null && rest.trim() === "") {
          p.appendChild(document.createTextNode(rest));
        } else {
          open().appendChild(document.createTextNode(rest));
        }
      }
      node.remove();
    } else {
      // Element / comment: moved whole into the open sentence — a sentence
      // containing inline elements stays one unit, and no boundary inside
      // an inline element is ever considered.
      open().appendChild(node);
    }
  }
  p.dataset.sentCount = String(count);
}

/** Segments every paragraph of every reader step. Idempotent. */
export function segmentReader(steps: readonly HTMLElement[]): void {
  for (const step of steps) {
    for (const p of paragraphsOf(step)) segmentParagraph(p);
    // Late-filling paragraphs (§8's benchmark verdicts, §6's fog verdict —
    // empty at boot, written when the benchmark/scorecard first runs): the
    // observer segments them the moment they gain text. Re-runs are gated
    // on "segmented but produced zero spans", so the mutation that the
    // segmentation itself causes cannot loop.
    const body = step.querySelector(".step__body");
    if (body instanceof HTMLElement && typeof MutationObserver !== "undefined") {
      if (body.dataset.sentObserved !== "true") {
        body.dataset.sentObserved = "true";
        const mo = new MutationObserver(() => {
          for (const p of paragraphsOf(step)) {
            if (
              p.dataset.sentSegmented === "true" &&
              p.dataset.sentCount === "0" &&
              (p.textContent ?? "").trim() !== ""
            ) {
              delete p.dataset.sentSegmented;
              segmentParagraph(p);
            }
          }
        });
        mo.observe(body, { childList: true, characterData: true, subtree: true });
      }
    }
  }
}

/** A step's paragraphs: the <p> children of its .step__body, in order. */
export function paragraphsOf(stepEl: HTMLElement | null): HTMLElement[] {
  const body = stepEl?.querySelector(".step__body");
  if (!body) return [];
  return Array.from(body.children).filter(
    (el): el is HTMLElement => el.tagName === "P",
  );
}

/** One addressed sentence span (no visibility check — engine/gates filter). */
export function sentenceAt(
  stepEl: HTMLElement | null,
  para: number,
  sent: number,
): HTMLElement | null {
  const p = paragraphsOf(stepEl)[para];
  if (!p) return null;
  return p.querySelector(`span.${SENT_CLASS}[data-sent="${sent}"]`);
}

/**
 * The tour's sentence lookup: resolves (para, sent), falls back to
 * `altPara` (wholesale paragraph swaps, e.g. the fog reveal's played-run /
 * empty-run flavors), and yields null when nothing VISIBLE resolves — the
 * tour then degrades to no highlight instead of dimming around a ghost.
 */
export function resolveSentence(
  stepEl: HTMLElement | null,
  para: number,
  sent: number,
  altPara?: number,
  altPara2?: number,
): HTMLElement | null {
  const visible = (el: Element | null): el is HTMLElement =>
    el instanceof HTMLElement && el.getClientRects().length > 0;
  const el = sentenceAt(stepEl, para, sent);
  if (visible(el)) return el;
  if (altPara !== undefined) {
    const alt = sentenceAt(stepEl, altPara, sent);
    if (visible(alt)) return alt;
  }
  // Second alternate (S2-TOUR-S7-GHOST-STEP-EMPTY-FLAVOR-NO-SENTENCE): the
  // reachable empty-run flavor hides BOTH lead paragraphs and reveals a
  // third — try it through the same visible() guard.
  if (altPara2 !== undefined) {
    const alt2 = sentenceAt(stepEl, altPara2, sent);
    if (visible(alt2)) return alt2;
  }
  return null;
}
