/**
 * Official BlindspotLab studio product badge.
 *
 * The visual spec is fixed by the studio (24px round logo, 10px gap, 14px
 * #5E635F label, 24px bottom margin, 44px min touch height). It is applied with
 * inline styles rather than utility classes so the rendered appearance cannot
 * drift when Tailwind tokens or theme variables change — this is studio-owned
 * brand furniture, not themed product UI.
 *
 * The only addition to the supplied markup is a keyboard focus indicator,
 * which the source HTML lacks. No dependencies and no tracking are introduced:
 * the logo is a plain <img> to the studio's own CDN path, matching the supplied
 * source exactly (next/image would require a remote-pattern config change and
 * would rewrite the URL).
 */
export function BlindspotLabBadge() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        width: "100%",
        margin: "0 0 24px",
      }}
    >
      <a
        href="https://blindspotlab.xyz"
        target="_blank"
        rel="noopener noreferrer"
        className="blindspotlab-badge__link"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "10px",
          minHeight: "44px",
          color: "#5E635F",
          fontFamily:
            "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: "14px",
          fontWeight: 400,
          lineHeight: 1.5,
          textDecoration: "none",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- studio-owned external brand asset; next/image would rewrite the canonical URL and need a remotePatterns change */}
        <img
          src="https://blindspotlab.xyz/brand/avatar-forest.svg"
          alt=""
          width={24}
          height={24}
          style={{
            display: "block",
            width: "24px",
            height: "24px",
            flexShrink: 0,
            borderRadius: "50%",
          }}
        />
        <span>A BlindspotLab Product</span>
      </a>
    </div>
  );
}
