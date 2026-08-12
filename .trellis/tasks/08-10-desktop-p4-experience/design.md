# Desktop AI, plugins, collaboration, and settings experience - design

## Architecture boundary

```text
P4 surface and section presentation
  -> dedicated P4 controller command
  -> generated Engine method or narrow DesktopApi capability
  -> authoritative returned projection
```

The task may extract shared visual primitives for P4 section navigation,
toolbars, structured technical detail, forms, statuses, and paging. It must not
merge the four controllers, move their form state into `use-app-controller`, or
create a second data/credential store.

## Shared surface composition

Each P4 surface follows a stable composition:

1. compact surface masthead and primary action;
2. route-like section navigation with current state;
3. mounted operational status/error region;
4. bounded toolbar/filter/form;
5. dense list/table/detail region with an explicit scroll owner;
6. local confirmation or technical-detail disclosure when needed.

Forms use visible labels and keep data-entry state through typed errors. Tables
wrap identity/detail columns while keeping action columns reachable. Technical
payloads use structured key/value or collapsible bounded detail rather than a
full-width raw `<pre>` as the primary view.

## Domain contracts

### AI

Schema projection and unknown-key merge helpers remain authoritative. Secret
writes stay on the dedicated DesktopApi path. Interactive and batch runs retain
independent tokens, terminal-state rules, exact revisions, and explicit apply.

### Plugins/connectors

Lifecycle commands refresh authoritative inventories. Panel sessions remain
exact-owner, issued, sandboxed, and revocable. Connector form projection and
request building remain the only accepted path; the UI never accepts arbitrary
operation JSON or patches project state from results.

### Collaboration

Local presentation formats Engine-owned identities/timestamps without changing
meaning. Presence lifecycle and cursors stay in the collaboration controller.

### Settings

Locale, appearance, data/backup/restore, update, and tutorial state retain their
separate owners. Appearance bootstrap and storage key do not change.

## Compatibility and testing

- Preserve existing P4 surface kinds, return targets, nav testids, generated
  method signatures, storage keys, and fixture environment keys.
- Prefer semantic markup/CSS changes. Controller edits are limited to missing
  duplicate guards, confirmation success contracts, or state preservation
  proven by the task.
- Extend P4 unit/controller/E2E tests and keep P0-P3 green. Deep fixture lanes
  remain separate from always-on evidence.

## Rollout and rollback

Implement serially by domain: shared P4 primitives, AI, Plugins/connectors,
Collaboration, Settings, then integrated P4 evidence. Each domain's surface,
CSS block, tests, and any focused controller wiring form one rollback unit.
