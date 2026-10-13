/**
 * Claim admissibility rules.
 *
 * Revel extracts text only. A claim that asserts an *observed* visual property
 * (spacing, contrast, colour, mobile layout, visual hierarchy, fold position)
 * has no supporting evidence and must not ship as a finding.
 *
 * The rules deliberately target assertions about how the page *looks*, not
 * mentions of the words themselves. "No pricing link in the nav" is a textual
 * fact and stays. "Primary CTA competes visually with secondary buttons" is a
 * rendered-layout claim and is withheld.
 */

export type ClaimBasis = "measured" | "observed" | "inferred";

/** Phrasings that assert a rendered/visual property we never rendered. */
const VISUAL_CLAIM_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "contrast", pattern: /\b(colou?r|text)\s+contrast\b|\bcontrast\s+ratio\b|\blow[-\s]contrast\b/i },
  { id: "spacing", pattern: /\b(white\s*space|whitespace|padding|margin|line[-\s]height|letter[-\s]spacing|cramped|cluttered|crowded)\b/i },
  { id: "visual-hierarchy", pattern: /\bvisual(ly)?\s+(hierarchy|weight|dominant|competes?|prominent)\b|\bhierarchy\s+is\s+(unclear|weak|flat)\b/i },
  { id: "fold", pattern: /\babove\s+the\s+fold\b|\bbelow\s+the\s+fold\b/i },
  { id: "mobile-layout", pattern: /\bmobile\s+(layout|nav(igation)?|menu|view(port)?|experience|ux|screen)\s+(is|are|was|were|feels?|looks?|appears?)\b|\bon\s+mobile\s+(it|the|this)\b|\bresponsive\s+(layout|design)\s+(is|breaks?|fails?)\b/i },
  { id: "touch-target", pattern: /\btouch\s+targets?\b|\btap\s+targets?\b|\b44\s*px\b/i },
  { id: "typography-size", pattern: /\bfont\s+size\b|\btext\s+is\s+too\s+(small|large)\b|\btypography\s+(is|feels|looks)\b/i },
  { id: "button-appearance", pattern: /\b(buttons?|cta)s?\s+(of\s+)?(equal\s+)?visual\s+weight\b|\bbutton\s+(colou?r|size|styling)\b|\bghost\s+buttons?\b/i },
  { id: "image-appearance", pattern: /\b(hero\s+image|screenshots?|imagery)\s+(is|are|looks?|appears?|feels?)\b/i },
  { id: "render-verb", pattern: /\b(looks?|appears?|feels?)\s+(cluttered|cramped|dated|busy|unpolished|cheap|crowded)\b/i },
];

export interface VisualClaimHit {
  rule: string;
  field: string;
  excerpt: string;
}

/**
 * Find visual-property assertions in a finding's text fields.
 * Returns every rule hit so the rejection message can be specific.
 */
export function findVisualClaims(
  fields: Record<string, string | undefined>
): VisualClaimHit[] {
  const hits: VisualClaimHit[] = [];

  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;

    for (const { id, pattern } of VISUAL_CLAIM_PATTERNS) {
      const match = value.match(pattern);
      if (!match) continue;

      const at = match.index ?? 0;
      hits.push({
        rule: id,
        field,
        excerpt: value.slice(Math.max(0, at - 30), at + 70).trim(),
      });
    }
  }

  return hits;
}

/** Quoted spans the model claims come from the page: "…" or “…”. */
export function extractClaimedQuotes(text: string): string[] {
  const quotes: string[] = [];
  const patterns = [/"([^"]{4,240})"/g, /“([^”]{4,240})”/g];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[1]?.trim();
      if (value) quotes.push(value);
    }
  }

  return quotes;
}
