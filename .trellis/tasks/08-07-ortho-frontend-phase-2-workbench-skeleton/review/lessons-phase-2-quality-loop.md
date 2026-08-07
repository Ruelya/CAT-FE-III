# Lessons — Phase 2 quality loop thrash

Short institutional notes from review/fix rounds 1–5. Not a product feature
checklist; see closeout-summary and `.trellis/spec/frontend/electron-workbench.md`
for the durable contracts.

## 1. ARIA composites: assert real a11y, not attribute churn

**Thrash:** Matrix keyboard cursor landed on `role="navigation"` +
`aria-activedescendant` with every dot `tabIndex={-1}`. Unit tests asserted
that the attribute string changed, which locked in markup axe later rejects
(`aria-allowed-attr`).

**Fix that stuck:** Native roving tabindex — one `tabIndex={0}`, real
`document.activeElement` movement, `data-focus` for visuals, Enter uses the
focused cell's document ordinal.

**Prevention:** When introducing composite keyboard UX, either (a) use roving
tabindex, or (b) place `aria-activedescendant` only on roles that allow it.
Prefer tests that assert `document.activeElement` or an axe rule over
“attribute equals X”.

## 2. Removed chrome must rewrite every E2E selector

**Thrash:** Rail Confirm was correctly removed, but five Workbench E2E flows
still used `getByRole("button", { name: "Confirm", exact: true })`. Identity
and visual-polish paths were fixed first; the remaining five kept failing
statically until a final sweep.

**Fix that stuck:** Segment confirm → active-textarea `Control+Enter`. Leave
unrelated live Confirm controls (e.g. alignment row) alone.

**Prevention:** After deleting a visible control, `rg` the E2E suite for its
accessible name / class before declaring the phase green.

## 3. Matrix geometry is document ordinal space

**Thrash risk (caught early):** Building Matrix state from filtered/list
indices or virtual-window offsets paints wrong colors and seeks wrong segments
under Issues / status filters.

**Contract:** `segmentStates.length === counts.total`, slots keyed by
`segment.ordinal`, null for unknown; bracket drag through
`documentOrdinalFromRatio` → `onNavigate(ordinal)`.

## 4. Environment residual ≠ product failure

Missing `target/debug/translunar-engine.exe` blocked live Electron geometry.
Verify correctly labeled this environment residual so fix cycles stayed on
static/unit-reproducible issues (ARIA, E2E selectors) rather than spinning on
unrunnable viewport missions.
