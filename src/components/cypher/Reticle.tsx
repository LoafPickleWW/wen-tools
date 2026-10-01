/**
 * Four corner brackets that tighten onto their parent card on hover
 * (the parent needs `group` and `relative`). Each corner is its own element
 * with two borders and a concentric radius, so it renders identically in
 * every browser and curves with rounded cards. Configure per card with
 * --wt-r (card radius) and --wt-in (hover inset).
 */
export function Reticle() {
  return (
    <span className="wt-reticle" aria-hidden="true">
      <span className="wt-reticle-c wt-reticle-tl" />
      <span className="wt-reticle-c wt-reticle-tr" />
      <span className="wt-reticle-c wt-reticle-bl" />
      <span className="wt-reticle-c wt-reticle-br" />
    </span>
  );
}
