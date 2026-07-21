# Technical Design: Project Lifecycle Acceptance

## 1. Desktop Surface Model

`App` owns three top-level modes: project home, project setup, and an opened
workspace. An opened workspace retains the existing workbench sub-surfaces.
Returning home uses the workbench's existing pending-edit flush boundary before
clearing the active session. Project home loads only generated Engine contracts.

```text
ProjectHome
  -> project.list / document.list / project.get
  -> template.*, search.global, recycle.*, archive.restore
  -> open(projectId, documentId, optional segmentId)
  -> App.loadWorkspace -> Workbench

Workspace lifecycle page
  -> document.list / project.batchImport
  -> document.reimport.preview/apply
  -> project.archive.export / recycle.delete
  -> analysis.run/get / project.analytics.get / history.list
```

Use one `ProjectHub` component with tabs for Projects, Search, Templates, and
Recycle. Use a workspace-scoped `ProjectInsightsPage` for files, re-import,
archive, history, analysis, and analytics. Both remain orchestration/rendering
layers; derived counts and transitions come from Rust.

## 2. Trusted File Boundaries

Electron main owns open/save dialogs. Extend `DesktopApi` with a dedicated
project-archive save dialog so `.tlcat` publication is not confused with
document export filters. Dropped paths still pass through `webUtils.getPathForFile`.
Renderer code receives paths only and never recursively walks or reads files.

## 3. State And Navigation

Home data is refetched after every create/restore/recycle/purge/template write.
Workspace data is refetched after add/re-import. Search hits carry authoritative
IDs; navigation loads the result document, then passes the optional segment ID
to the existing focus mechanism. Local storage retains only the active IDs.

Project setup becomes cancelable back to home. The workbench's existing
`onStartAnotherProject` callback is redefined as `onReturnHome`; its caller
continues to flush edits before invoking it.

## 4. Lifecycle Dialogs

Use application dialogs with focusable labels and explicit Cancel/Confirm
commands for purge, recycle, template delete, and re-import apply. Actor defaults
to `desktop-user`; every destructive/revisioned request includes a bounded
reason and expected revision where the protocol requires it.

Archive restore validates entirely in Engine before storage mutation. Archive
export uses a save path returned by main and relies on Engine no-clobber. UI
never pre-validates ZIP contents or hashes.

## 5. Test And Compatibility Strategy

Keep every existing protocol method and session key compatible. Add targeted
component/unit tests only for presentation helpers; authoritative behavior is
proved by Rust tests, stdio smoke, and real-Engine Electron E2E.

The E2E fixture creates multiple TXT sources plus an archive output directory,
then drives home/setup/insights/search flows. It captures all three required
viewports and asserts document/body overflow plus console/page error arrays.

## 6. Rollback

Changes are additive to renderer surfaces and trusted IPC. If a UI action fails,
retain the current page data and render the typed error. No optimistic domain
mutation is committed locally. A failed archive restore, re-import apply, or
batch import remains governed by existing Engine/storage transactions.
