export type AppLocale = "en-US" | "zh-CN";

export type MessageKey =
  | "app.name"
  | "app.tagline"
  | "action.openProject"
  | "action.createProject"
  | "action.importDocument"
  | "action.export"
  | "action.settings"
  | "action.backup"
  | "action.restore"
  | "action.checkUpdates"
  | "action.skip"
  | "action.next"
  | "action.focusControl"
  | "action.back"
  | "action.finish"
  | "action.restartTutorial"
  | "action.openExample"
  | "action.chooseDirectory"
  | "action.migrateDataDirectory"
  | "action.discardDraft"
  | "action.restoreDraft"
  | "action.copyDraft"
  | "action.deferUpdate"
  | "action.installUpdate"
  | "action.rollbackUpdate"
  | "action.openInstaller"
  | "action.confirmRestore"
  | "action.cancelRestore"
  | "action.retry"
  | "status.ready"
  | "status.loading"
  | "status.saving"
  | "status.engineReconnecting"
  | "status.engineReconnected"
  | "status.busy"
  | "status.freeSpace"
  | "status.healthy"
  | "status.unhealthy"
  | "error.generic"
  | "error.engineUnavailable"
  | "error.engineExited"
  | "error.dataDirectoryInvalid"
  | "error.dataDirectoryMigrateFailed"
  | "error.backupFailed"
  | "error.restoreFailed"
  | "error.updateFailed"
  | "error.allowlistDenied"
  | "error.draftStale"
  | "error.projectInRecycleBin"
  | "error.projectNoDocuments"
  | "shellError.canceled"
  | "shellError.notWritable"
  | "shellError.insufficientSpace"
  | "shellError.existingWorkspace"
  | "shellError.destinationExists"
  | "shellError.unsafePath"
  | "shellError.invalidBackup"
  | "shellError.incompatibleBackup"
  | "shellError.schemaTooNew"
  | "shellError.hashMismatch"
  | "shellError.invalidWorkspaceShape"
  | "shellError.restoreInProgress"
  | "shellError.confirmationExpired"
  | "shellError.confirmationInvalid"
  | "shellError.healthFailed"
  | "shellError.stagingIncomplete"
  | "shellError.unknown"
  | "settings.title"
  | "settings.locale"
  | "settings.localeHelp"
  | "settings.dataDirectory"
  | "settings.dataDirectoryHelp"
  | "settings.currentPath"
  | "settings.freeSpace"
  | "settings.updates"
  | "settings.updateMode"
  | "settings.updateMode.automatic"
  | "settings.updateMode.manual"
  | "settings.updateMode.disabled"
  | "settings.backupHistory"
  | "settings.allowlist"
  | "settings.allowlistHelp"
  | "settings.allowlistEmpty"
  | "settings.noBackups"
  | "settings.close"
  | "settings.localeName.enUS"
  | "settings.localeName.zhCN"
  | "settings.profileDisabled"
  | "backup.title"
  | "backup.destination"
  | "backup.progress"
  | "backup.success"
  | "backup.reminder"
  | "backup.historyCount"
  | "restore.title"
  | "restore.preview"
  | "restore.previewTitle"
  | "restore.confirm"
  | "restore.success"
  | "restore.noClobber"
  | "restore.schema"
  | "restore.files"
  | "restore.size"
  | "restore.hashStatus"
  | "restore.compatible"
  | "restore.freeSpace"
  | "restore.sourcePath"
  | "restore.cancel"
  | "restore.confirmAction"
  | "update.title"
  | "update.checking"
  | "update.available"
  | "update.upToDate"
  | "update.downloading"
  | "update.ready"
  | "update.deferred"
  | "update.disabled"
  | "update.failed"
  | "update.unsigned"
  | "update.preBackup"
  | "update.pendingRestart"
  | "update.notConfigured"
  | "update.recoveryRequired"
  | "update.rollbackSucceeded"
  | "update.rollbackFailed"
  | "update.manualInstallerOpened"
  | "home.continueTranslating"
  | "home.archivedProjects"
  | "home.newProject"
  | "home.projects"
  | "home.search"
  | "home.templates"
  | "home.recycle"
  | "home.refresh"
  | "home.noActiveProjects"
  | "home.noArchivedProjects"
  | "home.createToBegin"
  | "home.archivedHelp"
  | "home.projectLifecycle"
  | "home.projectPages"
  | "home.workspaceViews"
  | "home.localProjects"
  | "home.projectCount"
  | "home.active"
  | "home.archived"
  | "home.restoreArchive"
  | "home.projectWorkspace"
  | "home.archiveRestored"
  | "home.noActiveDocuments"
  | "home.loadingWorkspaceData"
  | "home.general"
  | "home.projectProgress"
  | "home.unavailable"
  | "home.completionAria"
  | "home.filesCount"
  | "home.segmentsCount"
  | "home.blockersCount"
  | "home.moreFiles"
  | "home.openProject"
  | "home.archiveProject"
  | "home.restoreProject"
  | "home.archiveNamed"
  | "home.restoreNamed"
  | "home.moveToRecycle"
  | "home.recycleNamed"
  | "home.archiveActionTitle"
  | "home.restoreActionTitle"
  | "home.archiveActionDescription"
  | "home.restoreActionDescription"
  | "home.archiveActionConfirm"
  | "home.restoreActionConfirm"
  | "home.recycleActionTitle"
  | "home.recycleActionDescription"
  | "home.recycleActionConfirm"
  | "home.templateRevisionCreated"
  | "home.templateCreated"
  | "home.deleteTemplateTitle"
  | "home.deleteTemplateDescription"
  | "home.deleteTemplateConfirm"
  | "home.restoreItemTitle"
  | "home.restoreItemDescription"
  | "home.purgeItemTitle"
  | "home.purgeItemDescription"
  | "home.purgeItemConfirm"
  | "home.workspaceIndex"
  | "home.globalSearch"
  | "home.globalSearchHelp"
  | "home.searchPlaceholder"
  | "home.globalSearchQuery"
  | "home.searchProject"
  | "home.allActiveProjects"
  | "home.searchField"
  | "home.allFields"
  | "home.fieldSource"
  | "home.fieldTarget"
  | "home.fieldProject"
  | "home.fieldDocument"
  | "home.fieldComment"
  | "home.fieldNote"
  | "home.searchWorkflowState"
  | "home.anyWorkflowState"
  | "home.workflowTranslation"
  | "home.workflowReview"
  | "home.workflowSigned"
  | "home.searchSubmit"
  | "home.noMatchingContent"
  | "home.searchEveryActive"
  | "home.tryAnother"
  | "home.resultsLink"
  | "home.resultCount"
  | "home.segmentNumber"
  | "home.reusableConfiguration"
  | "home.projectTemplates"
  | "home.templatesDescription"
  | "home.newTemplate"
  | "home.builtIn"
  | "home.custom"
  | "home.revision"
  | "home.noDescription"
  | "home.locales"
  | "home.analysis"
  | "home.review"
  | "home.required"
  | "home.optional"
  | "home.updated"
  | "home.deleteTemplate"
  | "home.deleteTemplateNamed"
  | "home.safeReusableConfiguration"
  | "home.editProjectTemplate"
  | "home.newProjectTemplate"
  | "home.name"
  | "home.description"
  | "home.sourceLocale"
  | "home.targetLocale"
  | "home.analysisProfile"
  | "home.requireReviewBeforeSignoff"
  | "home.engineResolvesPolicy"
  | "home.localesMustDiffer"
  | "home.saveTemplate"
  | "home.recoverableDeletion"
  | "home.recycleBin"
  | "home.recycleDescription"
  | "home.recycleEmpty"
  | "home.recycleEmptyHelp"
  | "home.deletedAt"
  | "home.retainedUntil"
  | "home.restoreItem"
  | "home.permanentlyPurge"
  | "home.purgeNamed"
  | "draft.recoveryTitle"
  | "draft.recoveryBody"
  | "draft.staleWarning"
  | "draft.count"
  | "tutorial.welcomeTitle"
  | "tutorial.welcomeBody"
  | "tutorial.createTitle"
  | "tutorial.createBody"
  | "tutorial.importTitle"
  | "tutorial.importBody"
  | "tutorial.editTitle"
  | "tutorial.editBody"
  | "tutorial.qaTitle"
  | "tutorial.qaBody"
  | "tutorial.exportTitle"
  | "tutorial.exportBody"
  | "tutorial.completeTitle"
  | "tutorial.completeBody"
  | "tutorial.progress"
  | "aria.settings"
  | "aria.closeDialog"
  | "aria.tutorialOverlay"
  | "aria.localeSelector"
  | "aria.backupHistory"
  | "aria.dataDirectoryPath"
  | "empty.noProjects"
  | "empty.noBackups"
  | "loading.workspace"
  | "dialog.selectDataDirectory"
  | "dialog.selectBackupDestination"
  | "dialog.selectRestoreSource"
  | "dialog.selectSource"
  | "dialog.selectSources"
  | "dialog.selectSourceFolder"
  | "dialog.selectProjectArchive"
  | "dialog.selectProjectArchiveDestination"
  | "dialog.selectExport"
  | "dialog.selectExportTaskPackage"
  | "dialog.selectInteropReview"
  | "dialog.selectInteropTable"
  | "dialog.selectTaskPackageInput"
  | "dialog.selectCorpusInput"
  | "dialog.selectPluginPackage"
  | "nav.home"
  | "plural.backup"
  | "plural.draft"
  | "format.bytes"
  | "format.checkedAt"
  | "common.refresh"
  | "common.cancel"
  | "common.close"
  | "common.save"
  | "common.actor"
  | "common.reason"
  | "common.workingOn"
  | "common.unknown"
  | "common.documentSegmentPath"
  | "common.previousPage"
  | "common.nextPage"
  | "common.status"
  | "common.source"
  | "common.target"
  | "common.active"
  | "common.domain"
  | "common.profile"
  | "common.scope"
  | "common.all"
  | "common.views"
  | "common.moreActions"
  | "common.discard"
  | "common.confirm"
  | "common.enable"
  | "common.disable"
  | "common.optional"
  | "common.none"
  | "common.loading"
  | "common.edit"
  | "common.delete"
  | "common.install"
  | "common.uninstall"
  | "common.open"
  | "common.apply"
  | "common.select"
  | "common.kind"
  | "common.locale"
  | "common.quality"
  | "common.provenance"
  | "common.score"
  | "common.disposition"
  | "common.evidence"
  | "common.diagnostics"
  | "common.translationMemory"
  | "common.termbase"
  | "common.referenceCorpus"
  | "common.confirmed"
  | "common.workflow"
  | "common.period"
  | "common.edits"
  | "common.terms"
  | "common.unit"
  | "common.collection"
  | "common.state"
  | "common.model"
  | "common.reasoning"
  | "common.low"
  | "common.medium"
  | "common.high"
  | "common.send"
  | "common.undo"
  | "common.redo"
  | "common.comments"
  | "common.issue"
  | "common.suggestions"
  | "common.document"
  | "common.segment"
  | "common.project"
  | "common.threads"
  | "common.snapshots"
  | "common.provider"
  | "common.requests"
  | "common.input"
  | "common.output"
  | "common.elapsed"
  | "common.failed"
  | "common.skipped"
  | "common.current"
  | "common.returned"
  | "common.severity"
  | "common.rule"
  | "common.recommendation"
  | "common.explanation"
  | "common.policy"
  | "plugins.title"
  | "plugins.lede"
  | "plugins.installPackage"
  | "plugins.loading"
  | "plugins.empty"
  | "plugins.permissions"
  | "plugins.permissionsNone"
  | "plugins.connectorProfiles"
  | "plugins.connectorVersion"
  | "plugins.connectorOperations"
  | "plugins.connectorAuthority"
  | "plugins.connectorOrigins"
  | "plugins.connectorOriginNone"
  | "plugins.connectorNotRequested"
  | "plugins.connectorPermissionUnknown"
  | "plugins.connectorFailure"
  | "plugins.compatibility"
  | "plugins.compatibilityReady"
  | "plugins.compatibilityBlocked"
  | "plugins.inventoryAria"
  | "plugins.inventoryTitle"
  | "plugins.contributionCount"
  | "plugins.permissionUnknown"
  | "plugins.contributionKind"
  | "plugins.qaRule"
  | "plugins.pipelineStep"
  | "plugins.pluginVersion"
  | "plugins.operationAuthority"
  | "plugins.contributionVersion"
  | "plugins.descriptorVersions"
  | "plugins.descriptorVersionShort"
  | "plugins.operationVersionShort"
  | "plugins.ruleContract"
  | "plugins.configSchemaVersion"
  | "plugins.artifactContract"
  | "plugins.schemaVersions"
  | "plugins.configVersionShort"
  | "plugins.checkpointVersionShort"
  | "plugins.executionControls"
  | "plugins.resumable"
  | "plugins.cancellable"
  | "plugins.yes"
  | "plugins.no"
  | "plugins.pipelineHistoryAria"
  | "plugins.pipelineHistoryKicker"
  | "plugins.pipelineHistoryTitle"
  | "plugins.pipelineRunCount"
  | "plugins.pipelineHistoryLoading"
  | "plugins.pipelineHistoryEmpty"
  | "plugins.pipelineNoPluginSteps"
  | "plugins.activationRevision"
  | "plugins.activationRevisionLabel"
  | "plugins.review"
  | "plugins.previewPanel"
  | "plugins.panel.loading"
  | "plugins.panel.connecting"
  | "plugins.panel.ready"
  | "plugins.panel.error"
  | "plugins.panel.revoked"
  | "plugins.panel.connectionFailed"
  | "plugins.panel.sessionEnded"
  | "plugins.actions.aria"
  | "plugins.actions.title"
  | "plugins.actions.accept"
  | "plugins.actions.cancel"
  | "plugins.actions.cancelled"
  | "plugins.actions.failure"
  | "plugins.workbenchPanels.aria"
  | "plugins.workbenchPanels.title"
  | "plugins.workbenchPanels.tab"
  | "plugins.workbenchPanels.refresh"
  | "plugins.workbenchPanels.loading"
  | "plugins.workbenchPanels.empty"
  | "plugins.workbenchPanels.closedHint"
  | "plugins.workbenchPanels.failure"
  | "plugins.permissionKicker"
  | "plugins.reviewTitle"
  | "plugins.versionChanges"
  | "plugins.versionChange"
  | "plugins.change.none"
  | "plugins.change.added"
  | "plugins.change.expanded"
  | "plugins.change.narrowed"
  | "plugins.change.unchanged"
  | "plugins.change.removed"
  | "plugins.reasonPlaceholder"
  | "plugins.required"
  | "plugins.optional"
  | "plugins.unsupported"
  | "plugins.contribution"
  | "plugins.allContributions"
  | "plugins.scope"
  | "plugins.scopeUnscoped"
  | "plugins.grant"
  | "plugins.deny"
  | "plugins.revoke"
  | "plugins.audit"
  | "plugins.auditEmpty"
  | "plugins.effect.fileRead"
  | "plugins.effect.fileWrite"
  | "plugins.effect.networkConnect"
  | "plugins.effect.assetRead"
  | "plugins.effect.assetWrite"
  | "plugins.effect.projectRead"
  | "plugins.effect.projectWrite"
  | "plugins.effect.engineConnector"
  | "plugins.effect.qaRegister"
  | "plugins.effect.pipelineRegister"
  | "plugins.effect.aiAction"
  | "plugins.effect.uiPanel"
  | "plugins.effect.externalConnector"
  | "plugins.effect.diagnosticsRead"
  | "plugins.effect.unsupported"
  | "export.kicker"
  | "export.title"
  | "export.checking"
  | "export.ready"
  | "export.blocked"
  | "export.heroBody"
  | "export.checkAgain"
  | "export.gateClear"
  | "export.blockingErrors"
  | "export.countsLine"
  | "export.awaiting"
  | "export.segmentsChecked"
  | "export.run"
  | "export.originalFormat"
  | "export.blockingFindings"
  | "export.noOpenErrors"
  | "export.resolveBefore"
  | "export.segmentLabel"
  | "export.nothingBlocks"
  | "export.warningsRemain"
  | "export.publication"
  | "export.publicationBody"
  | "export.overrideAria"
  | "export.overrideTitle"
  | "export.overrideHelp"
  | "export.actorPlaceholder"
  | "export.reasonPlaceholder"
  | "export.publishing"
  | "export.exportDocument"
  | "export.helpBlocked"
  | "export.success"
  | "tm.exactKicker"
  | "tm.title"
  | "tm.exactAria"
  | "tm.activeLookup"
  | "tm.searchAria"
  | "tm.lookupFailed"
  | "tm.lookingUp"
  | "tm.noExactMatch"
  | "tm.noExactBody"
  | "tm.concordance"
  | "tm.concordanceQuery"
  | "tm.concordanceDirection"
  | "tm.noConcordance"
  | "tm.closeConcordance"
  | "tm.sourceAndTarget"
  | "nav.backToWorkbench"
  | "nav.applicationViews"
  | "setup.brand"
  | "setup.tagline"
  | "setup.localWorkspace"
  | "setup.stepsAria"
  | "setup.step1"
  | "setup.nameWorkspace"
  | "setup.projectName"
  | "setup.sourceLanguage"
  | "setup.targetLanguage"
  | "setup.locale.enUS"
  | "setup.locale.enGB"
  | "setup.locale.zhCN"
  | "setup.locale.zhTW"
  | "setup.locale.ja"
  | "setup.step2"
  | "setup.chooseProfile"
  | "setup.projectTemplate"
  | "setup.noTemplate"
  | "setup.qaProfile"
  | "setup.templateDefault"
  | "setup.pipeline"
  | "setup.templateNone"
  | "setup.aiProfile"
  | "setup.templateOffline"
  | "setup.analysisProfile"
  | "setup.templateStandard"
  | "setup.reviewPolicy"
  | "setup.requireReview"
  | "setup.allowDirectSignOff"
  | "setup.step3"
  | "setup.addFiles"
  | "setup.commitMode"
  | "setup.dropFiles"
  | "setup.selectedPathsAria"
  | "setup.removeSource"
  | "setup.removeSourceNamed"
  | "setup.templateDeps"
  | "setup.importDiagnostics"
  | "setup.languagesMustDiffer"
  | "setup.enterName"
  | "setup.addFilesFirst"
  | "setup.importedNone"
  | "setup.rollbackEmpty"
  | "setup.emptyRemoved"
  | "setup.noFilesImported"
  | "setup.stepProject"
  | "setup.stepConfiguration"
  | "setup.stepFiles"
  | "setup.identityDescription"
  | "setup.configurationDescription"
  | "setup.filesDescription"
  | "setup.loadingProfiles"
  | "setup.stepCounter"
  | "setup.revisionOption"
  | "setup.sourceSelections"
  | "setup.diagnosticImported"
  | "setup.cleanupSkipped"
  | "setup.projectRetained"
  | "qa.kicker"
  | "qa.title"
  | "qa.controlsAria"
  | "qa.mandatoryReview"
  | "qa.latestRunAria"
  | "qa.filtersAria"
  | "qa.findings"
  | "qa.findingsAria"
  | "qa.noMatch"
  | "qa.changeFilters"
  | "qa.prevIssuePage"
  | "qa.nextIssuePage"
  | "qa.detailAria"
  | "qa.selectFinding"
  | "qa.evidenceHere"
  | "qa.reviewBandAria"
  | "qa.reviewState"
  | "qa.translation"
  | "qa.pendingProposals"
  | "qa.accepted"
  | "qa.rejected"
  | "qa.reviewedChars"
  | "qa.reviewerQueue"
  | "qa.noPendingProposals"
  | "qa.falsePositive"
  | "qa.waiveFinding"
  | "qa.loadingFindings"
  | "qa.noEvidence"
  | "qa.profileRules"
  | "qa.closeEditor"
  | "qa.customRegex"
  | "qa.noCompletedRun"
  | "qa.runToCreate"
  | "qa.loadingReview"
  | "qa.queueClear"
  | "qa.cloneProfile"
  | "qa.customProfile"
  | "qa.saveProfile"
  | "qa.customRule"
  | "qa.customPattern"
  | "qa.mandatoryEnabled"
  | "qa.directSignOff"
  | "qa.settingsTitle"
  | "qa.reportSaved"
  | "qa.checkedSegments"
  | "qa.removeRule"
  | "qa.errors"
  | "qa.warnings"
  | "qa.info"
  | "qa.waived"
  | "qa.checked"
  | "qa.builtIn"
  | "qa.pluginHistoryAria"
  | "qa.pluginHistoryKicker"
  | "qa.pluginHistoryTitle"
  | "qa.runHistoryCount"
  | "qa.pluginHistoryEmpty"
  | "qa.executionCounts"
  | "qa.pluginOwner"
  | "assistant.archive"
  | "assistant.archiveNamed"
  | "assistant.requestedModel"
  | "assistant.localPreview"
  | "assistant.localPreviewOffline"
  | "assistant.reasoningLevel"
  | "assistant.offlinePreview"
  | "assistant.actionsAria"
  | "assistant.useInTarget"
  | "assistant.noMessages"
  | "assistant.askAria"
  | "assistant.askPlaceholder"
  | "assistant.sendAria"
  | "assistant.metricsAria"
  | "assistant.aiMetricsAria"
  | "assistant.discardSuggestion"
  | "assistant.wordDiff"
  | "assistant.proposedTarget"
  | "assistant.discardProposal"
  | "assistant.diffAria"
  | "assistant.engineConnected"
  | "assistant.credentialRequired"
  | "assistant.offlineReady"
  | "assistant.startGrounded"
  | "assistant.preparing"
  | "assistant.runStatus"
  | "assistant.noActiveSegment"
  | "assistant.chooseProvider"
  | "assistant.groundingUnavailable"
  | "assistant.aiRunFailed"
  | "assistant.newConversation"
  | "assistant.prompt.translate"
  | "assistant.prompt.improve"
  | "assistant.prompt.formal"
  | "assistant.prompt.shorten"
  | "assistant.reasoningLine"
  | "assistant.requestModel"
  | "assistant.inputTokens"
  | "assistant.cacheReadTokens"
  | "assistant.thinkingTokens"
  | "assistant.outputTokens"
  | "assistant.cacheWriteTokens"
  | "assistant.elapsedTime"
  | "assistant.groundingContext"
  | "assistant.characters"
  | "assistant.sections"
  | "ai.kicker"
  | "ai.title"
  | "ai.description"
  | "ai.enabled"
  | "ai.interactiveRuns"
  | "ai.batchRuns"
  | "ai.budgetPlaceholder"
  | "ai.originsPlaceholder"
  | "ai.viewsAria"
  | "ai.connectorCatalog"
  | "ai.chooseConnector"
  | "ai.connectorAvailable"
  | "ai.connectorUnavailable"
  | "ai.connectorDegraded"
  | "ai.connectorBuiltin"
  | "ai.connectorPlugin"
  | "ai.connectorSchemaVersion"
  | "ai.addProvider"
  | "ai.configured"
  | "ai.providerProfiles"
  | "ai.credentialPlaceholder"
  | "ai.testConnection"
  | "ai.editProfile"
  | "ai.deleteCredential"
  | "ai.deleteProfile"
  | "ai.profileEnabled"
  | "ai.cancelEdit"
  | "ai.cancelEditAria"
  | "ai.noProfiles"
  | "ai.tmFirst"
  | "ai.pretranslate"
  | "ai.chooseProfile"
  | "ai.replaceDrafts"
  | "ai.durableQueue"
  | "ai.selectedBatchAria"
  | "ai.batchItemsAria"
  | "ai.noBatchRuns"
  | "ai.currentMonth"
  | "ai.authoritativeUsage"
  | "ai.refreshUsage"
  | "ai.cacheRead"
  | "ai.thinking"
  | "ai.noUsage"
  | "ai.enterCredential"
  | "ai.credentialSaved"
  | "ai.providerTestFailed"
  | "ai.credentialRemoved"
  | "ai.budgetInvalid"
  | "ai.policySaved"
  | "ai.chooseProviderProfile"
  | "ai.batchStarted"
  | "ai.providerCredential"
  | "ai.credentialFor"
  | "ai.testNamed"
  | "ai.editNamed"
  | "ai.deleteCredentialFor"
  | "ai.deleteNamed"
  | "ai.pending"
  | "ai.testTimeout"
  | "interop.modeAria"
  | "interop.tableFormat"
  | "interop.package"
  | "interop.signedReview"
  | "interop.writableTm"
  | "interop.noWritableLibrary"
  | "interop.documentRevision"
  | "interop.applyReason"
  | "interop.reviewPreviewAria"
  | "interop.returnedTarget"
  | "interop.tablePreviewAria"
  | "interop.sourceTarget"
  | "interop.structuralPath"
  | "interop.diagnosticsMeta"
  | "interop.prevPage"
  | "interop.nextPage"
  | "task.modeAria"
  | "task.auditAria"
  | "task.createAssignment"
  | "task.assignmentDocs"
  | "task.optionalSegmentIds"
  | "task.segmentIdsPlaceholder"
  | "task.noActiveDocuments"
  | "task.instructions"
  | "task.instructionsPlaceholder"
  | "task.notImported"
  | "task.importFirst"
  | "task.exportReturn"
  | "task.taskProject"
  | "task.originPackage"
  | "task.originProject"
  | "task.returnInstructions"
  | "task.returnNotePlaceholder"
  | "task.previewTitle"
  | "task.detachedName"
  | "task.detachedPlaceholder"
  | "task.engineClassifications"
  | "task.discardStaged"
  | "task.countsAria"
  | "task.rowsAria"
  | "task.noRows"
  | "task.detachedReady"
  | "task.importDocumentCount"
  | "task.importBoundRowCount"
  | "task.optionalSlices"
  | "task.tmTermRows"
  | "task.noMountedLibrary"
  | "task.explicitRowIds"
  | "task.removeSlice"
  | "task.transactionalMerge"
  | "task.applySelected"
  | "task.workflowTitle"
  | "task.assignmentExported"
  | "task.returnExported"
  | "task.detachedCreated"
  | "task.applied"
  | "task.discarded"
  | "task.boundedHandoff"
  | "task.noDestination"
  | "task.detachedWork"
  | "task.trustedReview"
  | "task.noPackage"
  | "task.sourceUnavailable"
  | "task.selectRow"
  | "task.sliceKind"
  | "task.sliceLibrary"
  | "task.sliceRowIds"
  | "task.removeSliceN"
  | "task.remoteChanged"
  | "task.localChanged"
  | "task.bothChanged"
  | "task.tagInvalid"
  | "task.missingDependency"
  | "task.applyCount"
  | "task.applyMerge"
  | "task.applyDialogBody"
  | "task.rowNumber"
  | "insights.kicker"
  | "insights.title"
  | "insights.refresh"
  | "insights.panelAria"
  | "insights.progressAria"
  | "insights.progressTitle"
  | "insights.completionAria"
  | "insights.productivity"
  | "insights.aiContribution"
  | "insights.assetHealth"
  | "insights.trends"
  | "insights.qaRuns"
  | "insights.tmUnits"
  | "insights.dropFiles"
  | "insights.recycleDocument"
  | "insights.reconciliation"
  | "insights.reimportCounts"
  | "insights.portable"
  | "insights.exportArchive"
  | "insights.recoverable"
  | "insights.recycleProject"
  | "insights.history"
  | "insights.analysis"
  | "insights.matchBands"
  | "insights.explicitAction"
  | "insights.discussionsTab"
  | "insights.alignmentTab"
  | "insights.taskTab"
  | "insights.batchFinished"
  | "insights.removedFromFiles"
  | "insights.removedFromInsights"
  | "insights.applyReimport"
  | "insights.applyPreview"
  | "insights.archiveExported"
  | "insights.analysisStale"
  | "insights.analysisDone"
  | "insights.analyticsUnavailable"
  | "insights.qaBlockers"
  | "insights.activeEditing"
  | "insights.confirmedPerHour"
  | "insights.activityEvents"
  | "insights.idleThreshold"
  | "insights.appliedSegments"
  | "insights.retainedSegments"
  | "insights.replacedSegments"
  | "insights.retainedChars"
  | "insights.aiHistoryUnavailable"
  | "insights.termEntries"
  | "insights.openBlockers"
  | "insights.mountedHits"
  | "insights.curationOutcomes"
  | "insights.recentBuckets"
  | "insights.noTrendBuckets"
  | "insights.activeSourceSet"
  | "insights.recycleNamed"
  | "insights.lastBatch"
  | "insights.revisionReconciliation"
  | "insights.currentRevision"
  | "insights.currentVersion"
  | "insights.sourceHash"
  | "insights.noReplacement"
  | "insights.previewId"
  | "insights.oldOrdinal"
  | "insights.newOrdinal"
  | "insights.noOperations"
  | "insights.engineSnapshot"
  | "insights.staleAnalysis"
  | "insights.analysisSnapshot"
  | "insights.sourceWords"
  | "insights.sourceChars"
  | "insights.sourceCjk"
  | "insights.targetWords"
  | "insights.targetChars"
  | "insights.targetCjk"
  | "insights.weightedEffort"
  | "insights.editDistance"
  | "insights.noAnalysis"
  | "curation.reviewAssets"
  | "curation.applied"
  | "curation.rollbackRestored"
  | "curation.exported"
  | "curation.refreshed"
  | "curation.catalog"
  | "curation.unifiedCatalog"
  | "curation.refreshState"
  | "curation.catalogScope"
  | "curation.allAssets"
  | "curation.anyDomain"
  | "curation.queryPlaceholder"
  | "curation.query"
  | "curation.noCatalogRows"
  | "curation.analyzeLibrary"
  | "curation.selectTm"
  | "curation.offlineChecks"
  | "curation.thresholds"
  | "curation.thresholdsHelp"
  | "curation.reviewChanges"
  | "curation.noFindingsPage"
  | "curation.analyzedUnits"
  | "curation.applyRollbackExport"
  | "curation.selectedFindings"
  | "curation.allActive"
  | "curation.noRun"
  | "curation.catalogRowsAria"
  | "curation.findingsAria"
  | "curation.unitsAria"
  | "curation.termsDrift"
  | "curation.termCandidates"
  | "curation.noCandidates"
  | "curation.driftGroups"
  | "curation.revisionSafe"
  | "curation.assetKind"
  | "curation.sourceLocale"
  | "curation.targetLocale"
  | "curation.originProject"
  | "curation.originDocument"
  | "curation.createdAfter"
  | "curation.createdBefore"
  | "curation.loadingCatalog"
  | "alignment.modeAria"
  | "alignment.revisionBound"
  | "alignment.documentAlignment"
  | "alignment.refresh"
  | "alignment.sourceDocument"
  | "alignment.twoDocsRequired"
  | "alignment.targetDocument"
  | "alignment.auditReason"
  | "alignment.session"
  | "alignment.noSessions"
  | "alignment.noSession"
  | "alignment.selectTwoDocs"
  | "alignment.linkTitle"
  | "alignment.mergeTitle"
  | "alignment.unlinkTitle"
  | "alignment.splitTitle"
  | "alignment.aiProfile"
  | "alignment.noCredentialProfile"
  | "alignment.writableTm"
  | "alignment.noLocaleTm"
  | "alignment.bilingualName"
  | "alignment.corpusPlaceholder"
  | "alignment.candidatesAria"
  | "alignment.manualLink"
  | "corpus.projectOwned"
  | "corpus.importTitle"
  | "corpus.refresh"
  | "corpus.kind"
  | "corpus.monoSource"
  | "corpus.monoTarget"
  | "corpus.bilingual"
  | "corpus.name"
  | "corpus.namePlaceholder"
  | "corpus.sourceLocale"
  | "corpus.targetLocale"
  | "corpus.mounted"
  | "corpus.removed"
  | "corpus.authoritative"
  | "corpus.searchTitle"
  | "corpus.query"
  | "corpus.queryPlaceholder"
  | "corpus.side"
  | "corpus.sourceAndTarget"
  | "corpus.allActive"
  | "corpus.noSearchYet"
  | "corpus.reference"
  | "corpus.closeRemove"
  | "discussion.modeAria"
  | "discussion.start"
  | "discussion.scopeAria"
  | "discussion.titleOptional"
  | "discussion.titlePlaceholder"
  | "discussion.firstMessage"
  | "discussion.messagePlaceholder"
  | "discussion.threadsAria"
  | "discussion.refresh"
  | "discussion.includeResolved"
  | "discussion.noMatching"
  | "discussion.startOne"
  | "discussion.selectedAria"
  | "discussion.editMessage"
  | "discussion.mentionsAria"
  | "discussion.noMessagesPage"
  | "discussion.reply"
  | "discussion.selectOne"
  | "discussion.messagesHere"
  | "discussion.tombstone"
  | "snapshot.createNamed"
  | "snapshot.name"
  | "snapshot.namePlaceholder"
  | "snapshot.listAria"
  | "snapshot.refresh"
  | "snapshot.none"
  | "snapshot.createCheckpoint"
  | "snapshot.selectedAria"
  | "snapshot.previewAria"
  | "snapshot.workspaceChanges"
  | "snapshot.missingDeps"
  | "snapshot.runPreviewFirst"
  | "snapshot.selectOne"
  | "snapshot.metaHere"
  | "snapshot.atomicRestore"
  | "workbench.activeDocument"
  | "workbench.searchPlaceholder"
  | "workbench.searchAria"
  | "workbench.segmentFilters"
  | "workbench.additionalFilters"
  | "workbench.tagged"
  | "workbench.commented"
  | "workbench.exactTmMatching"
  | "workbench.exactTm"
  | "workbench.editorCommands"
  | "workbench.commandPalette"
  | "workbench.openCommandPalette"
  | "workbench.findReplace"
  | "workbench.openFindReplace"
  | "workbench.undoAria"
  | "workbench.redoAria"
  | "workbench.openComments"
  | "workbench.issueNav"
  | "workbench.prevIssue"
  | "workbench.nextIssue"
  | "workbench.segmentsAria"
  | "workbench.segmentTools"
  | "workbench.copyTags"
  | "workbench.insertTag"
  | "workbench.insertTagPair"
  | "workbench.splitSegment"
  | "workbench.mergeNext"
  | "workbench.correctSource"
  | "workbench.openChinese"
  | "workbench.openCommentsShort"
  | "workbench.openReview"
  | "workbench.targetTags"
  | "workbench.moveTagHint"
  | "workbench.untranslated"
  | "workbench.tab"
  | "workbench.addDictionary"
  | "workbench.noSegmentsMatch"
  | "workbench.loadingMatches"
  | "workbench.loadingTerms"
  | "workbench.loadingAssistant"
  | "workbench.loadingPdfPage"
  | "workbench.noTmMatchState"
  | "workbench.noTermHitState"
  | "workbench.noOpenQaState"
  | "workbench.noAssistantConversation"
  | "workbench.noGridMatches"
  | "workbench.clearGridFilters"
  | "workbench.noPdfPage"
  | "workbench.noPdfBlocks"
  | "workbench.commandPaletteAria"
  | "workbench.typeCommand"
  | "workbench.filterCommands"
  | "workbench.closeCommandPalette"
  | "workbench.preferencesAria"
  | "workbench.workspacePreferences"
  | "workbench.editorShortcuts"
  | "workbench.closePreferences"
  | "workbench.themeSystem"
  | "workbench.themeLight"
  | "workbench.themeDark"
  | "workbench.shortcutPresets"
  | "workbench.auditedSource"
  | "workbench.chineseDicts"
  | "workbench.simplifiedTraditional"
  | "workbench.projectTransform"
  | "workbench.noComments"
  | "workbench.reviewBypass"
  | "workbench.signOffDirectly"
  | "workbench.localReview"
  | "workbench.reviewRevisions"
  | "workbench.sourceRevision"
  | "workbench.targetRevision"
  | "workbench.documentPreview"
  | "workbench.followActive"
  | "workbench.previewStructure"
  | "workbench.previewStructureRail"
  | "workbench.previewStructureAvailable"
  | "workbench.previewStructureLimited"
  | "workbench.previewStructureNote"
  | "workbench.noExtractedBlocks"
  | "workbench.projectTm"
  | "workbench.preferredTarget"
  | "workbench.closeSourceCorrection"
  | "workbench.correctedSource"
  | "workbench.sourceCorrectionReason"
  | "workbench.chineseConversion"
  | "workbench.closeChinese"
  | "workbench.chineseProfile"
  | "workbench.closeFindReplace"
  | "workbench.segmentComments"
  | "workbench.closeComments"
  | "workbench.editedComment"
  | "workbench.addDurableComment"
  | "workbench.newComment"
  | "workbench.addComment"
  | "workbench.closeReview"
  | "workbench.workflowState"
  | "workbench.proposedSource"
  | "workbench.proposedTarget"
  | "workbench.createReview"
  | "workbench.resizePreview"
  | "workbench.followActiveSegment"
  | "workbench.pdfPage"
  | "workbench.extractedBlocks"
  | "workbench.correctOcr"
  | "workbench.ocrReason"
  | "workbench.reasonForCorrection"
  | "workbench.collapseSuggestions"
  | "workbench.openSuggestions"
  | "workbench.targetSegment"
  | "workbench.exportedSegments"
  | "plugins.disable"
  | "plugins.uninstall"
  | "plugins.bundledTitle"
  | "plugins.bundledLede"
  | "plugins.bundledUnavailable"
  | "plugins.bundledEmpty"
  | "plugins.bundledInstall"
  | "plugins.bundledUpdate"
  | "plugins.bundledCurrent"
  | "plugins.bundledState.available"
  | "plugins.bundledState.installed"
  | "plugins.bundledState.updateAvailable"
  | "plugins.bundledState.current"
  | "plugins.installedTitle"
  | "plugins.upgrade"
  | "plugins.versionHistory"
  | "plugins.versionHistoryTitle"
  | "plugins.versionActive"
  | "plugins.rollback"
  | "plugins.inspectTitle"
  | "plugins.inspectId"
  | "plugins.inspectVersion"
  | "plugins.inspectTier"
  | "plugins.inspectSource"
  | "plugins.inspectHash"
  | "plugins.inspectLicense"
  | "plugins.inspectLicenseNone"
  | "plugins.inspectCompatibility"
  | "plugins.inspectContributions"
  | "plugins.inspectConfirmInstall"
  | "plugins.inspectConfirmUpgrade"
  | "plugins.inspectIdMismatch"
  | "plugins.source.localDirectory"
  | "plugins.source.localArchive"
  | "plugins.source.bundled"
  | "plugins.crashCount"
  | "export.checkAgainInline"
  | "export.warningsRemainInline"
  | "export.publicationBodyInline"
  | "export.overrideHelpInline"
  | "export.helpBlockedInline"
  | "ai.defaultProfile"
  | "ai.monthlyBudget"
  | "ai.allowedOrigins"
  | "ai.connector"
  | "ai.profileName"
  | "ai.baseUrl"
  | "ai.timeoutMs"
  | "ai.tmThreshold"
  | "ai.concurrency"
  | "ai.requestsPerMinute"
  | "alignment.noCandidatesPage"
  | "alignment.noCorporaMatch"
  | "alignment.noCorpusEntry"
  | "alignment.reloadState"
  | "alignment.createdCandidates"
  | "alignment.appliedTm"
  | "curation.staleRevisions"
  | "curation.reloadState"
  | "curation.selectAndAnalyze"
  | "curation.noCompeting"
  | "assistant.newConversationInline"
  | "assistant.openAiProfile"
  | "assistant.applied"
  | "discussion.discussions"
  | "discussion.projectSnapshots"
  | "discussion.tombstoneBody"
  | "snapshot.revisionBoundPreview"
  | "snapshot.created"
  | "interop.selectAndPreview"
  | "interop.appliedReview"
  | "insights.previewReconciliation"
  | "insights.restoreFromHome"
  | "qa.documentScope"
  | "qa.projectScope"
  | "qa.editProfile"
  | "qa.resetFilters"
  | "qa.openSegment"
  | "qa.revokeWaiver"
  | "qa.waiveFindingBtn"
  | "qa.recordWaiver"
  | "qa.maxTargetChars"
  | "qa.builtinImmutable"
  | "qa.addRule"
  | "qa.pattern"
  | "qa.message"
  | "qa.replacementHint"
  | "setup.templateRequired"
  | "setup.bestEffort"
  | "setup.allOrNothing"
  | "setup.pathsSanitized"
  | "setup.sqlitePrivate"
  | "task.exportImmutable"
  | "task.everySliceRequires"
  | "task.engineChangedOnly"
  | "task.noAssetRows"
  | "nav.workbench"
  | "nav.qaReview"
  | "nav.exportReview"
  | "nav.translationMemory"
  | "nav.aiControl"
  | "nav.projectInsights"
  | "nav.projects"
  | "workbench.confirm"
  | "workbench.default"
  | "workbench.saveShortcuts"
  | "workbench.insertTarget"
  | "workbench.applyCorrection"
  | "workbench.conversionProfile"
  | "workbench.applyConversion"
  | "workbench.replaceWith"
  | "workbench.regularExpression"
  | "workbench.caseSensitive"
  | "workbench.wholeWord"
  | "tm.lookingUpDots"
  | "assistant.askPlaceholderDots"
  | "workbench.preview"
  | "workbench.applyUnchanged"
  | "workbench.editComment"
  | "workbench.saveEdit"
  | "workbench.mandatoryDisabled"
  | "workbench.signOff"
  | "workbench.noReviewProposals"
  | "workbench.proposeTags"
  | "workbench.correctOcrBtn"
  | "discussion.tombstoneBody2"
  | "setup.cleanupFailed"
  | "insights.archiveExportedDiag"
  | "discussion.tombstoneBody3"
  | "ai.profileCreated"
  | "ai.connectionSucceeded"
  | "ai.profileRemoved"
  | "ai.profileUpdated"
  | "ai.savePolicy"
  | "ai.providersTab"
  | "ai.batchTab"
  | "ai.usageTab"
  | "ai.startBatch"
  | "ai.resume"
  | "ai.store"
  | "ai.credentialStored"
  | "ai.credentialMissing"
  | "discussion.createdWithMessage"
  | "discussion.replyAdded"
  | "discussion.messageUpdated"
  | "discussion.messageTombstoned"
  | "discussion.resolved"
  | "discussion.reopened"
  | "discussion.loadingThreads"
  | "discussion.loadingMessages"
  | "snapshot.loading"
  | "snapshot.previewReady"
  | "snapshot.previewNeedsDeps"
  | "snapshot.restored"
  | "snapshot.restoredWithOp"
  | "snapshot.createdBy"
  | "snapshot.checkpointCount"
  | "interop.reviewExported"
  | "interop.reviewPreviewReady"
  | "interop.tablePreviewReady"
  | "interop.tableImported"
  | "interop.reviewDocxTab"
  | "interop.tableToTmTab"
  | "interop.preview"
  | "interop.exportDestination"
  | "interop.inputRow"
  | "interop.applyCount"
  | "interop.reviewRowCount"
  | "interop.tableRowCount"
  | "interop.selectReviewInput"
  | "interop.selectTableInput"
  | "interop.noInputSelected"
  | "interop.applied"
  | "interop.selectReviewRow"
  | "interop.selectTableRow"
  | "interop.row"
  | "interop.noStatus"
  | "interop.currentTarget"
  | "interop.noTarget"
  | "interop.comment"
  | "interop.noComment"
  | "interop.emptySource"
  | "interop.unchangedTarget"
  | "interop.missingSource"
  | "interop.missingTarget"
  | "alignment.correctionSaved"
  | "alignment.candidateMarked"
  | "alignment.refinementCanceled"
  | "alignment.aiSuggestionsReady"
  | "alignment.corpusCreated"
  | "alignment.corpusImported"
  | "alignment.corpusReindexed"
  | "alignment.corpusRemoved"
  | "alignment.createSession"
  | "alignment.tabAlignment"
  | "alignment.tabCorpora"
  | "alignment.link"
  | "alignment.merge"
  | "alignment.unlink"
  | "alignment.split"
  | "alignment.createCorpus"
  | "alignment.reject"
  | "alignment.selectFile"
  | "alignment.importCorpus"
  | "alignment.reindex"
  | "curation.runCompleted"
  | "curation.modeProvider"
  | "curation.modeOffline"
  | "curation.baseLibraryRevision"
  | "curation.runRevisionLabel"
  | "curation.global"
  | "curation.applyFilters"
  | "curation.reset"
  | "curation.refreshRevisions"
  | "curation.selectVisible"
  | "curation.clear"
  | "curation.applySelected"
  | "curation.rollbackRun"
  | "curation.noCatalogMatch"
  | "curation.catalogPages"
  | "curation.runKicker"
  | "curation.libraryRevision"
  | "curation.noLibrarySelected"
  | "curation.tmLibrary"
  | "curation.analyzeAction"
  | "curation.rolledBack"
  | "curation.providerRefinement"
  | "curation.offlineAnalysis"
  | "curation.actor"
  | "curation.findingsKicker"
  | "curation.selectedCount"
  | "curation.loadingFindings"
  | "curation.noFindingsDetail"
  | "curation.actionsKicker"
  | "curation.quarantineSelected"
  | "curation.exportFormat"
  | "curation.minimumScore"
  | "curation.applySelection"
  | "insights.movedToRecycle"
  | "insights.reimportPreviewReady"
  | "insights.reimported"
  | "insights.tabOverview"
  | "insights.tabFiles"
  | "insights.tabReimport"
  | "insights.tabAssets"
  | "insights.tabPlugins"
  | "insights.tabInterop"
  | "insights.tabArchive"
  | "insights.tabAnalysis"
  | "insights.loading"
  | "insights.addFiles"
  | "insights.addFolder"
  | "insights.selectReplacement"
  | "insights.exportTlcat"
  | "insights.recycleDocumentDescription"
  | "insights.recycleProjectDescription"
  | "insights.applyReimportDescription"
  | "insights.projectFiles"
  | "insights.unavailable"
  | "insights.diagnosticsCount"
  | "insights.blockerCount"
  | "insights.unchanged"
  | "insights.changed"
  | "insights.newSegments"
  | "insights.removed"
  | "insights.ambiguous"
  | "insights.runAnalysis"
  | "insights.newLabel"
  | "insights.newItem"
  | "insights.removedLabel"
  | "insights.untranslated"
  | "insights.draft"
  | "insights.reviewed"
  | "insights.translation"
  | "insights.review"
  | "insights.signed"
  | "insights.activity"
  | "insights.automation"
  | "insights.tmReuse"
  | "insights.historyCount"
  | "insights.fileRevisionVersion"
  | "insights.fileSegments"
  | "insights.fileSegmentsDiagnostics"
  | "insights.profileRevision"
  | "insights.repetitions"
  | "insights.exact"
  | "insights.match9599"
  | "insights.match8594"
  | "insights.match7584"
  | "insights.match5074"
  | "insights.noMatch"
  | "insights.milliUnits"
  | "insights.percent"
  | "insights.durationSeconds"
  | "insights.durationMinutes"
  | "insights.durationHours"
  | "qa.run"
  | "qa.waivedBy"
  | "qa.relatedSegmentCount"
  | "qa.segmentOrdinal"
  | "qa.name"
  | "interop.reviewImportReason"
  | "interop.tableImportReason"
  | "interop.reviewPreviewEmpty"
  | "interop.tablePreviewEmpty"
  | "export.checkingTranslation"
  | "export.readyForDelivery"
  | "export.publicationBlocked"
  | "export.qaRunsAgainst"
  | "tm.searchExactPlaceholder"
  | "ai.providerCredentialDefault"
  | "qa.label"
  | "qa.field"
  | "qa.reviewStats"
  | "qa.pendingProposalCount"
  | "task.previewReady"
  | "task.kindAssignment"
  | "task.kindReturn"
  | "task.identicalEdit"
  | "task.openPackage"
  | "task.chooseDestination"
  | "task.exportAssignment"
  | "task.openTltask"
  | "task.previewPackage"
  | "task.importDetached"
  | "task.selectSafeOnPage"
  | "task.previous"
  | "task.openTaskProject"
  | "task.addSlice"
  | "setup.addFilesBtn"
  | "setup.addFolderBtn"
  | "setup.noSourcesSelected"
  | "setup.continue"
  | "setup.openWorkspace"
  | "setup.importing"
  | "assistant.action.improve"
  | "assistant.action.fixTerms"
  | "assistant.action.shorten"
  | "assistant.action.explain"
  | "assistant.action.translate"
  | "assistant.action.formal"
  | "assistant.prompt.fixTerms"
  | "assistant.prompt.explain"
  | "assistant.conversation"
  | "assistant.you"
  | "assistant.roleAssistant"
  | "assistant.metric.offlineModel"
  | "assistant.metric.inputTokens"
  | "assistant.metric.cacheRead"
  | "assistant.metric.thinking"
  | "assistant.metric.outputTokens"
  | "assistant.metric.cacheWrite"
  | "assistant.metric.elapsed"
  | "assistant.stop"
  | "assistant.newConversationTitle"
  | "assistant.elapsedLabel"
  | "workbench.runQa"
  | "workbench.more"
  | "workbench.tags"
  | "workbench.theme"
  | "workbench.zoom"
  | "workbench.trados"
  | "workbench.find"
  | "workbench.reject"
  | "workbench.accept"
  | "workbench.matches"
  | "workbench.assistant"
  | "workbench.insert"
  | "workbench.translationProject"
  | "workbench.segmentsCount"
  | "workbench.conversionDescription"
  | "workbench.openPreview"
  | "workbench.collapsePreview"
  | "workbench.restoreSuggestions"
  | "workbench.maximizeSuggestions"
  | "workbench.segmentLabel"
  | "workbench.noExactMatch"
  | "workbench.noTermHits"
  | "workbench.noTargetTranslation"
  | "workbench.chinese.s2t"
  | "workbench.chinese.s2tw"
  | "workbench.chinese.s2hk"
  | "workbench.chinese.t2s"
  | "workbench.chinese.tw2s"
  | "workbench.chinese.hk2s"
  | "workbench.filterAll"
  | "workbench.filterUntranslated"
  | "workbench.filterDraft"
  | "workbench.filterConfirmed"
  | "workbench.filterIssues"
  | "workbench.sourceColumn"
  | "workbench.targetColumn"
  | "workbench.spellFindingsFrom"
  | "workbench.selectProtectedTag"
  | "workbench.acceptAutocomplete"
  | "workbench.signedReadOnly"
  | "workbench.importNote"
  | "workbench.reopen"
  | "workbench.resolve"
  | "workbench.changedFrom"
  | "common.pageRange"
  | "common.positionOf"
  | "common.revision"
  | "common.messages"
  | "common.activeMessages"
  | "common.entries"
  | "common.diagnosticsCount"
  | "common.readOnly"
  | "common.units"
  | "common.matches"
  | "common.relatedUnits"
  | "common.agreement"
  | "common.segmentCount"
  | "common.selectedCount"
  | "common.sourceExpression"
  | "common.targetExpression"
  | "common.noSourceExpression"
  | "common.noTargetExpression"
  | "common.noStructuralPath"
  | "common.noSourceMember"
  | "common.noTargetMember"
  | "common.projectScope"
  | "common.documentScope"
  | "common.segmentScope"
  | "common.entireProject"
  | "common.localReview"
  | "common.immutableCheckpoint"
  | "common.createSnapshot"
  | "common.restoreSnapshot"
  | "common.previewRestore"
  | "common.refreshPreview"
  | "common.baseRevision"
  | "common.documents"
  | "common.segments"
  | "common.threadsCount"
  | "common.expectedRevision"
  | "common.stateDigest"
  | "common.selectNamed"
  | "common.deleteNamed"
  | "common.editNamed"
  | "alignment.loadingSessions"
  | "alignment.loadingCorpora"
  | "alignment.sessionsLabel"
  | "alignment.candidatesLabel"
  | "alignment.selectedCount"
  | "alignment.sessionStatus"
  | "alignment.terminalResult"
  | "alignment.terminalLocked"
  | "alignment.refine"
  | "alignment.applyTmCount"
  | "alignment.selectCandidate"
  | "alignment.sourceSegments"
  | "alignment.targetSegments"
  | "alignment.sourceUnaligned"
  | "alignment.targetUnaligned"
  | "alignment.noSourceMember"
  | "alignment.noTargetMember"
  | "alignment.evidenceCount"
  | "alignment.refinementFailed"
  | "alignment.refinementPollingCanceled"
  | "alignment.refinementTimeout"
  | "alignment.candidateCount"
  | "alignment.sessionMeta"
  | "corpus.chooseOrDrop"
  | "corpus.noFileSelected"
  | "corpus.referenceCount"
  | "corpus.entries"
  | "corpus.diagnostics"
  | "corpus.revision"
  | "corpus.matchCount"
  | "corpus.entry"
  | "corpus.noSourceExpression"
  | "corpus.noTargetExpression"
  | "corpus.noStructuralPath"
  | "corpus.noProvenance"
  | "corpus.provenanceUnavailable"
  | "corpus.removeNamed"
  | "corpus.removeBody"
  | "corpus.removing"
  | "corpus.searchResults"
  | "corpus.referenceCorpora"
  | "corpus.documents"
  | "corpus.alignment"
  | "corpus.removeAction"
  | "discussion.localReview"
  | "discussion.segmentLimit"
  | "discussion.createDiscussion"
  | "discussion.messageCount"
  | "discussion.scopeTitle"
  | "discussion.resolve"
  | "discussion.reopen"
  | "discussion.deletedMessage"
  | "discussion.editNamed"
  | "discussion.deleteNamed"
  | "discussion.replyPlaceholder"
  | "discussion.reopenBeforeReply"
  | "discussion.deleteAction"
  | "discussion.threadPages"
  | "discussion.messagePages"
  | "discussion.revision"
  | "discussion.activeMessages"
  | "snapshot.immutableCheckpoint"
  | "snapshot.create"
  | "snapshot.revision"
  | "snapshot.refreshPreview"
  | "snapshot.previewRestore"
  | "snapshot.baseRevision"
  | "snapshot.documents"
  | "snapshot.segments"
  | "snapshot.threads"
  | "snapshot.expectedRevision"
  | "snapshot.state"
  | "snapshot.restoreSnapshot"
  | "snapshot.restoreTitle"
  | "snapshot.restoreBody"
  | "snapshot.restoreAction"
  | "snapshot.snapshotPages"
  | "snapshot.restoredLabel"
  | "snapshot.documentsAdded"
  | "snapshot.documentsRemoved"
  | "snapshot.documentsChanged"
  | "snapshot.segmentsAdded"
  | "snapshot.segmentsRemoved"
  | "snapshot.segmentsChanged"
  | "snapshot.commentsChanged"
  | "snapshot.reviewsChanged"
  | "snapshot.discussionsChanged"
  | "snapshot.mountsAdded"
  | "snapshot.mountsRemoved"
  | "snapshot.mountsChanged"
  | "curation.semanticProvider"
  | "curation.readOnly"
  | "curation.minimumChars"
  | "curation.minimumRatio"
  | "curation.maximumRatio"
  | "curation.nearDuplicate"
  | "curation.semanticScore"
  | "curation.quarantineScore"
  | "curation.minimumTermFrequency"
  | "curation.scoreProjection"
  | "curation.loadingUnits"
  | "curation.cleanDataset"
  | "curation.lastExport"
  | "curation.projectOrigin"
  | "curation.globalOrigin"
  | "curation.documentOrigin"
  | "curation.unitOrigin"
  | "curation.selectFinding"
  | "curation.languageIntelligence"
  | "curation.agreement"
  | "curation.relatedUnits"
  | "curation.metricAnalyzed"
  | "curation.metricWithFindings"
  | "curation.metricFindings"
  | "curation.metricQuarantine"
  | "curation.metricTerms"
  | "curation.metricDrift"
  | "curation.applyDialogTitle"
  | "curation.rollbackDialogTitle"
  | "curation.applyDialogBody"
  | "curation.rollbackDialogBody"
  | "curation.applyAction"
  | "curation.rollbackAction"
  | "curation.exportStatus"
  | "curation.findingPages"
  | "curation.unitPages"
  | "curation.termUses"
  | "curation.relatedUnitCount"
  | "curation.scoreNotAvailable"
  | "curation.findingExactDuplicate"
  | "curation.findingNearDuplicate"
  | "curation.findingCompetingTranslation"
  | "curation.findingSourceEqualsTarget"
  | "curation.findingMinimumLength"
  | "curation.findingLengthRatio"
  | "curation.findingNumberMismatch"
  | "curation.findingDateMismatch"
  | "curation.findingPlaceholderMismatch"
  | "curation.findingCreatedOutsideRange"
  | "curation.findingLikelyWrongLanguage"
  | "curation.findingSemanticMismatch"
  | "curation.severityError"
  | "curation.severityWarning"
  | "curation.severityInfo"
  | "curation.dispositionKeep"
  | "curation.dispositionReview"
  | "curation.dispositionQuarantine"
  | "curation.evidenceSource"
  | "curation.evidenceTarget"
  | "curation.evidenceRelatedUnit"
  | "curation.noAdditionalEvidence";

type MessageCatalog = Record<MessageKey, string>;

const enUs: MessageCatalog = {
  "app.name": "Translunar CAT",
  "app.tagline": "Local-first translation and asset hub",
  "action.openProject": "Open project",
  "action.createProject": "Create project",
  "action.importDocument": "Import document",
  "action.export": "Export",
  "action.settings": "Settings",
  "action.backup": "Back up workspace",
  "action.restore": "Restore workspace",
  "action.checkUpdates": "Check for updates",
  "action.skip": "Skip",
  "action.next": "Next",
  "action.focusControl": "Go to highlighted control",
  "action.back": "Back",
  "action.finish": "Finish",
  "action.restartTutorial": "Restart tutorial",
  "action.openExample": "Open example project",
  "action.chooseDirectory": "Choose directory",
  "action.migrateDataDirectory": "Move data directory",
  "action.discardDraft": "Discard",
  "action.restoreDraft": "Restore",
  "action.copyDraft": "Copy text",
  "action.deferUpdate": "Remind me later",
  "action.installUpdate": "Install update",
  "action.rollbackUpdate": "Restore pre-update backup",
  "action.openInstaller": "Open downloaded installer",
  "action.confirmRestore": "Confirm restore",
  "action.cancelRestore": "Cancel restore",
  "action.retry": "Retry",
  "status.ready": "Ready",
  "status.loading": "Loading…",
  "status.saving": "Saving…",
  "status.engineReconnecting": "Reconnecting to the translation engine…",
  "status.engineReconnected": "Engine reconnected. Reloading workspace…",
  "status.busy": "Working…",
  "status.freeSpace": "{size} free",
  "status.healthy": "Healthy",
  "status.unhealthy": "Needs attention",
  "error.generic": "Something went wrong.",
  "error.engineUnavailable": "The translation engine is unavailable.",
  "error.engineExited": "The translation engine stopped unexpectedly.",
  "error.dataDirectoryInvalid": "That data directory cannot be used.",
  "error.dataDirectoryMigrateFailed":
    "Data directory migration failed. The original workspace was restored.",
  "error.backupFailed": "Backup failed.",
  "error.restoreFailed": "Restore failed. The live workspace was not changed.",
  "error.updateFailed": "Update failed.",
  "error.allowlistDenied":
    "This AI profile is not allowed for the project ({profileId}).",
  "error.draftStale":
    "This draft is older than the saved segment and will not be applied silently.",
  "error.projectInRecycleBin": "This project is in the recycle bin.",
  "error.projectNoDocuments": "This project has no active documents.",
  "shellError.canceled": "The operation was canceled.",
  "shellError.notWritable": "The chosen location is not writable.",
  "shellError.insufficientSpace":
    "There is not enough free space for this operation.",
  "shellError.existingWorkspace":
    "The target already contains an unrelated workspace.",
  "shellError.destinationExists":
    "A file or folder already exists at the destination.",
  "shellError.unsafePath": "The selected path is not allowed.",
  "shellError.invalidBackup": "The backup is missing or malformed.",
  "shellError.incompatibleBackup":
    "The backup is not compatible with this version.",
  "shellError.schemaTooNew":
    "The backup was created by a newer version and cannot be restored.",
  "shellError.hashMismatch":
    "The backup failed integrity verification and was not restored.",
  "shellError.invalidWorkspaceShape":
    "The backup does not have a valid workspace layout.",
  "shellError.restoreInProgress": "Another restore is already in progress.",
  "shellError.confirmationExpired":
    "The restore confirmation expired. Preview the backup again.",
  "shellError.confirmationInvalid":
    "The restore confirmation was invalid. Preview the backup again.",
  "shellError.healthFailed":
    "The restored workspace failed its health check. The live workspace was kept.",
  "shellError.stagingIncomplete":
    "The staged copy was incomplete. No changes were made.",
  "shellError.unknown": "The operation could not be completed.",
  "settings.title": "Product settings",
  "settings.locale": "Language",
  "settings.localeHelp":
    "Applies immediately and is remembered for next launch.",
  "settings.dataDirectory": "Data directory",
  "settings.dataDirectoryHelp":
    "Projects, TM, QA, and local files live here. Moving copies then swaps after a health check.",
  "settings.currentPath": "Current path",
  "settings.freeSpace": "Free space",
  "settings.updates": "Updates",
  "settings.updateMode": "Update checks",
  "settings.updateMode.automatic": "Automatic",
  "settings.updateMode.manual": "Manual only",
  "settings.updateMode.disabled": "Disabled",
  "settings.backupHistory": "Recent backups",
  "settings.allowlist": "Allowed AI profiles",
  "settings.allowlistHelp":
    "Empty allows every enabled workspace profile. Non-empty restricts interactive, batch, and pipeline AI.",
  "settings.allowlistEmpty": "All enabled profiles (no restriction)",
  "settings.noBackups": "No backups recorded yet.",
  "settings.close": "Close settings",
  "settings.profileDisabled": "(disabled)",
  "settings.localeName.enUS": "English (United States)",
  "settings.localeName.zhCN": "简体中文",
  "backup.title": "Workspace backup",
  "backup.destination": "Choose a destination folder",
  "backup.progress": "Creating backup…",
  "backup.success": "Backup created at {path}",
  "backup.reminder":
    "Back up your data directory before updates or major migrations.",
  "backup.historyCount":
    "{count, plural, one {# backup} other {# backups}} in history",
  "restore.title": "Restore workspace",
  "restore.preview": "Validate backup before swapping the live workspace",
  "restore.previewTitle": "Restore preview",
  "restore.confirm": "Restore this backup",
  "restore.success": "Workspace restored and engine restarted.",
  "restore.noClobber": "Restore will not overwrite an existing destination.",
  "restore.schema": "Schema version {version}",
  "restore.files": "{count, plural, one {# file} other {# files}}",
  "restore.size": "Total size {size}",
  "restore.hashStatus": "Hashes: {status}",
  "restore.compatible": "Compatibility: {status}",
  "restore.freeSpace": "Free space {size}",
  "restore.sourcePath": "Source {path}",
  "restore.cancel": "Cancel",
  "restore.confirmAction": "Confirm and restore",
  "update.title": "Application updates",
  "update.checking": "Checking for updates…",
  "update.available": "Version {version} is available.",
  "update.upToDate": "You are on the latest version ({version}).",
  "update.downloading": "Downloading update… {percent}%",
  "update.ready": "Update ready to install.",
  "update.deferred": "Update deferred until {when}.",
  "update.disabled": "Automatic updates are disabled.",
  "update.failed": "Update check failed: {detail}",
  "update.unsigned":
    "Development build is unsigned; signing hooks were skipped.",
  "update.preBackup": "Creating a workspace backup before installing…",
  "update.pendingRestart":
    "Update {version} install was accepted. The application will restart to finish installation.",
  "update.notConfigured": "No update feed is configured for this build.",
  "update.recoveryRequired": "Update recovery is required: {detail}",
  "update.rollbackSucceeded":
    "Pre-update workspace backup was restored successfully.",
  "update.rollbackFailed": "Workspace rollback failed: {detail}",
  "update.manualInstallerOpened":
    "Opened the downloaded package for manual recovery. This does not prove the update is installed.",
  "home.continueTranslating": "Continue translating",
  "home.archivedProjects": "Archived projects",
  "home.newProject": "New project",
  "home.projects": "Projects",
  "home.search": "Search",
  "home.templates": "Templates",
  "home.recycle": "Recycle",
  "home.refresh": "Refresh",
  "home.noActiveProjects": "No active projects",
  "home.noArchivedProjects": "No archived projects",
  "home.createToBegin": "Create a project and add source files to begin.",
  "home.archivedHelp":
    "Archived projects remain available here until restored or recycled.",
  "home.projectLifecycle": "Project lifecycle",
  "home.projectPages": "Project pages",
  "home.workspaceViews": "Project workspace views",
  "home.localProjects": "Local projects",
  "home.projectCount":
    "{count, plural, one {# project} other {# projects}} in this view",
  "home.active": "Active",
  "home.archived": "Archived",
  "home.restoreArchive": "Restore archive",
  "home.projectWorkspace": "Project workspace",
  "home.archiveRestored": "Project archive restored under a new identity.",
  "home.noActiveDocuments": "This project has no active documents to open.",
  "home.loadingWorkspaceData": "Loading workspace data",
  "home.general": "General",
  "home.projectProgress": "Project progress",
  "home.unavailable": "Unavailable",
  "home.completionAria": "{name} completion",
  "home.filesCount": "{count, plural, one {# file} other {# files}}",
  "home.segmentsCount": "{count, plural, one {# segment} other {# segments}}",
  "home.blockersCount": "{count, plural, one {# blocker} other {# blockers}}",
  "home.moreFiles": "+{count} more files",
  "home.openProject": "Open project",
  "home.archiveProject": "Archive project",
  "home.restoreProject": "Restore project",
  "home.archiveNamed": "Archive {name}",
  "home.restoreNamed": "Restore {name}",
  "home.moveToRecycle": "Move to recycle bin",
  "home.recycleNamed": "Recycle {name}",
  "home.archiveActionTitle": "Archive project",
  "home.restoreActionTitle": "Restore project",
  "home.archiveActionDescription":
    "{name} will leave the active project list but remain fully recoverable.",
  "home.restoreActionDescription":
    "{name} will return to the active project list.",
  "home.archiveActionConfirm": "Archive",
  "home.restoreActionConfirm": "Restore",
  "home.recycleActionTitle": "Move project to recycle bin",
  "home.recycleActionDescription":
    "{name} and its documents will be hidden from normal projects and search.",
  "home.recycleActionConfirm": "Move to recycle bin",
  "home.templateRevisionCreated": "Template revision created.",
  "home.templateCreated": "Template created.",
  "home.deleteTemplateTitle": "Delete project template",
  "home.deleteTemplateDescription":
    "{name} revision {revision} and its revision history will be deleted. Existing projects are unchanged.",
  "home.deleteTemplateConfirm": "Delete template",
  "home.restoreItemTitle": "Restore recycled item",
  "home.restoreItemDescription": "{name} will return to its previous state.",
  "home.purgeItemTitle": "Permanently purge item",
  "home.purgeItemDescription":
    "{name} will be permanently removed. This cannot be undone.",
  "home.purgeItemConfirm": "Permanently purge",
  "home.workspaceIndex": "Workspace index",
  "home.globalSearch": "Global search",
  "home.globalSearchHelp":
    "Source, target, names, comments and import notes across active projects.",
  "home.searchPlaceholder": "Search the workspace",
  "home.globalSearchQuery": "Global search query",
  "home.searchProject": "Search project",
  "home.allActiveProjects": "All active projects",
  "home.searchField": "Search field",
  "home.allFields": "All fields",
  "home.fieldSource": "Source",
  "home.fieldTarget": "Target",
  "home.fieldProject": "Project names",
  "home.fieldDocument": "Document names",
  "home.fieldComment": "Comments",
  "home.fieldNote": "Import notes",
  "home.searchWorkflowState": "Search workflow state",
  "home.anyWorkflowState": "Any workflow state",
  "home.workflowTranslation": "Translation",
  "home.workflowReview": "Review",
  "home.workflowSigned": "Signed",
  "home.searchSubmit": "Search",
  "home.noMatchingContent": "No matching workspace content",
  "home.searchEveryActive": "Search every active project",
  "home.tryAnother": "Try another field, project or phrase.",
  "home.resultsLink":
    "Results link directly to the authoritative document and segment.",
  "home.resultCount": "{count, plural, one {# result} other {# results}}",
  "home.segmentNumber": "segment {number}",
  "home.reusableConfiguration": "Reusable configuration",
  "home.projectTemplates": "Project templates",
  "home.templatesDescription":
    "Locales, profiles, review policy and safe editor defaults. Credentials are never stored.",
  "home.newTemplate": "New template",
  "home.builtIn": "Built in",
  "home.custom": "Custom",
  "home.revision": "revision {revision}",
  "home.noDescription": "No description",
  "home.locales": "Locales",
  "home.analysis": "Analysis",
  "home.review": "Review",
  "home.required": "Required",
  "home.optional": "Optional",
  "home.updated": "Updated {value}",
  "home.deleteTemplate": "Delete template",
  "home.deleteTemplateNamed": "Delete {name} template",
  "home.safeReusableConfiguration": "Safe reusable configuration",
  "home.editProjectTemplate": "Edit project template",
  "home.newProjectTemplate": "New project template",
  "home.name": "Name",
  "home.description": "Description",
  "home.sourceLocale": "Source locale",
  "home.targetLocale": "Target locale",
  "home.analysisProfile": "Analysis profile",
  "home.requireReviewBeforeSignoff": "Require review before sign-off",
  "home.engineResolvesPolicy":
    "The policy is resolved by the Engine when creating a project.",
  "home.localesMustDiffer": "Source and target locales must be different.",
  "home.saveTemplate": "Save template",
  "home.recoverableDeletion": "Recoverable deletion",
  "home.recycleBin": "Recycle bin",
  "home.recycleDescription":
    "Restore retained projects and documents or explicitly purge them.",
  "home.recycleEmpty": "Recycle bin is empty",
  "home.recycleEmptyHelp":
    "Deleted projects and documents remain recoverable here during retention.",
  "home.deletedAt": "{kind} · deleted {value}",
  "home.retainedUntil": "Retained until {value} · {actor}",
  "home.restoreItem": "Restore",
  "home.permanentlyPurge": "Permanently purge",
  "home.purgeNamed": "Purge {name}",
  "draft.recoveryTitle": "Unsaved drafts found",
  "draft.recoveryBody":
    "Recoverable editor drafts were found after a crash. Review each item before applying.",
  "draft.staleWarning": "Revision mismatch — restore only after review.",
  "draft.count": "{count, plural, one {# draft} other {# drafts}}",
  "tutorial.welcomeTitle": "Welcome to Translunar",
  "tutorial.welcomeBody":
    "Import a document, confirm translations, run QA, then export. Your TM and terminology stay on this machine.",
  "tutorial.createTitle": "Create or open a project",
  "tutorial.createBody":
    "Use Project Home to create a project with source and target locales, or open an existing one.",
  "tutorial.importTitle": "Import a source document",
  "tutorial.importBody":
    "Import DOCX, Office, text, XLIFF, or PDF through the same trusted file dialogs as everyday work.",
  "tutorial.editTitle": "Edit and confirm segments",
  "tutorial.editBody":
    "Draft targets in the workbench. Confirm with Ctrl/Cmd+Enter after the engine acknowledges the save.",
  "tutorial.qaTitle": "Run quality checks",
  "tutorial.qaBody":
    "Open QA review to inspect engine-produced findings before delivery.",
  "tutorial.exportTitle": "Export the translation",
  "tutorial.exportBody":
    "Export through the original format path. Delivery stays blocked until QA is clear or explicitly overridden.",
  "tutorial.completeTitle": "You are ready",
  "tutorial.completeBody":
    "Open the bundled example project anytime from Settings, or start with your own files.",
  "tutorial.progress": "Step {current} of {total}",
  "aria.settings": "Open product settings",
  "aria.closeDialog": "Close dialog",
  "aria.tutorialOverlay": "First-run tutorial",
  "aria.localeSelector": "Interface language",
  "aria.backupHistory": "Backup history",
  "aria.dataDirectoryPath": "Active data directory path",
  "empty.noProjects": "No projects yet. Create one to begin.",
  "empty.noBackups": "No backup history yet.",
  "loading.workspace": "Opening workspace",
  "dialog.selectDataDirectory": "Choose data directory",
  "dialog.selectBackupDestination": "Choose backup destination",
  "dialog.selectRestoreSource": "Choose backup to restore",
  "dialog.selectSource": "Import source document",
  "dialog.selectSources": "Add source documents",
  "dialog.selectSourceFolder": "Add a source folder",
  "dialog.selectProjectArchive": "Restore a Translunar project",
  "dialog.selectProjectArchiveDestination": "Export Translunar project archive",
  "dialog.selectExport": "Export Translunar file",
  "dialog.selectExportTaskPackage": "Export offline task package",
  "dialog.selectInteropReview": "Open bilingual review DOCX",
  "dialog.selectInteropTable": "Open bilingual table",
  "dialog.selectTaskPackageInput": "Open offline task package",
  "dialog.selectCorpusInput": "Import reference corpus",
  "dialog.selectPluginPackage": "Select plugin package directory or .tlplugin file",
  "nav.home": "Home",
  "plural.backup": "{count, plural, one {# backup} other {# backups}}",
  "plural.draft": "{count, plural, one {# draft} other {# drafts}}",
  "format.bytes": "Size: {value} {unit}",
  "format.checkedAt": "Checked {value}",
  "common.refresh": "Refresh",
  "common.cancel": "Cancel",
  "common.close": "Close",
  "common.save": "Save",
  "common.actor": "Actor",
  "common.reason": "Reason",
  "common.workingOn": "Working on {task}",
  "common.unknown": "Unknown",
  "common.documentSegmentPath": "{document} / segment {ordinal}",
  "common.previousPage": "Previous page",
  "common.nextPage": "Next page",
  "common.status": "Status",
  "common.source": "Source",
  "common.target": "Target",
  "common.active": "Active",
  "common.domain": "Domain",
  "common.profile": "Profile",
  "common.scope": "Scope",
  "common.all": "All",
  "common.views": "Views",
  "common.moreActions": "More actions",
  "common.discard": "Discard",
  "common.confirm": "Confirm",
  "common.enable": "Enable",
  "common.disable": "Disable",
  "common.optional": "Optional",
  "common.none": "None",
  "common.loading": "Loading…",
  "common.edit": "Edit",
  "common.delete": "Delete",
  "common.install": "Install",
  "common.uninstall": "Uninstall",
  "common.open": "Open",
  "common.apply": "Apply",
  "common.select": "Select",
  "common.kind": "Kind",
  "common.locale": "Locale",
  "common.quality": "Quality",
  "common.provenance": "Provenance",
  "common.score": "Score",
  "common.disposition": "Disposition",
  "common.evidence": "Evidence",
  "common.diagnostics": "Diagnostics",
  "common.translationMemory": "Translation memory",
  "common.termbase": "Termbase",
  "common.referenceCorpus": "Reference corpus",
  "common.confirmed": "Confirmed",
  "common.workflow": "Workflow",
  "common.period": "Period",
  "common.edits": "Edits",
  "common.terms": "Terms",
  "common.unit": "Unit",
  "common.collection": "Collection",
  "common.state": "State",
  "common.model": "Model",
  "common.reasoning": "Reasoning",
  "common.low": "Low",
  "common.medium": "Medium",
  "common.high": "High",
  "common.send": "Send",
  "common.undo": "Undo",
  "common.redo": "Redo",
  "common.comments": "Comments",
  "common.issue": "Issue",
  "common.suggestions": "Suggestions",
  "common.document": "Document",
  "common.segment": "Segment",
  "common.project": "Project",
  "common.threads": "Threads",
  "common.snapshots": "Snapshots",
  "common.provider": "Provider",
  "common.requests": "Requests",
  "common.input": "Input",
  "common.output": "Output",
  "common.elapsed": "Elapsed",
  "common.failed": "Failed",
  "common.skipped": "Skipped",
  "common.current": "Current",
  "common.returned": "Returned",
  "common.severity": "Severity",
  "common.rule": "Rule",
  "common.recommendation": "Recommendation",
  "common.explanation": "Explanation",
  "common.policy": "Policy",
  "plugins.title": "Plugins",
  "plugins.lede":
    "Install local plugins, review scoped authority, and control their contributions.",
  "plugins.installPackage": "Install package…",
  "plugins.loading": "Loading plugins…",
  "plugins.empty":
    "No plugins installed. Choose a package directory or .tlplugin archive.",
  "plugins.permissions": "permissions: {list}",
  "plugins.permissionsNone": "none",
  "plugins.connectorProfiles": "{count} provider profiles",
  "plugins.connectorVersion": "Active version",
  "plugins.connectorOperations": "Operations",
  "plugins.connectorAuthority": "Connector authority: {state}",
  "plugins.connectorOrigins": "Origins: {list}",
  "plugins.connectorOriginNone": "none granted",
  "plugins.connectorNotRequested": "not requested",
  "plugins.connectorPermissionUnknown": "Permission state unavailable",
  "plugins.connectorFailure": "Last safe failure: {message}",
  "plugins.compatibility": "Compatibility: {state}",
  "plugins.compatibilityReady": "supported",
  "plugins.compatibilityBlocked": "unsupported",
  "plugins.inventoryAria": "QA and pipeline contributions",
  "plugins.inventoryTitle": "QA and pipeline contributions",
  "plugins.contributionCount":
    "{count, plural, one {# contribution} other {# contributions}}",
  "plugins.permissionUnknown": "Permission state unavailable",
  "plugins.contributionKind": "Kind",
  "plugins.qaRule": "QA rule",
  "plugins.pipelineStep": "Pipeline step",
  "plugins.pluginVersion": "Plugin version, tier, and state",
  "plugins.operationAuthority": "Operation authority",
  "plugins.contributionVersion": "Contribution version",
  "plugins.descriptorVersions": "Contract versions",
  "plugins.descriptorVersionShort": "descriptor v{version}",
  "plugins.operationVersionShort": "operation v{version}",
  "plugins.ruleContract": "Rule type and severity",
  "plugins.configSchemaVersion": "Config schema version",
  "plugins.artifactContract": "Artifact contract",
  "plugins.schemaVersions": "Schema versions",
  "plugins.configVersionShort": "config v{version}",
  "plugins.checkpointVersionShort": "checkpoint v{version}",
  "plugins.executionControls": "Execution controls",
  "plugins.resumable": "Resumable: {state}",
  "plugins.cancellable": "Cancellable: {state}",
  "plugins.yes": "yes",
  "plugins.no": "no",
  "plugins.pipelineHistoryAria": "Pipeline run history",
  "plugins.pipelineHistoryKicker": "Durable execution history",
  "plugins.pipelineHistoryTitle": "Pipeline run history",
  "plugins.pipelineRunCount":
    "{count, plural, one {# recent run} other {# recent runs}}",
  "plugins.pipelineHistoryLoading": "Loading pipeline history…",
  "plugins.pipelineHistoryEmpty": "No pipeline runs recorded for this project.",
  "plugins.pipelineNoPluginSteps":
    "This run did not execute a plugin-owned step.",
  "plugins.activationRevision": "activation {revision}",
  "plugins.activationRevisionLabel": "Activation revision",
  "plugins.review": "Review permissions",
  "plugins.previewPanel": "Preview panel",
  "plugins.panel.loading": "Loading",
  "plugins.panel.connecting": "Connecting",
  "plugins.panel.ready": "Ready",
  "plugins.panel.error": "Error",
  "plugins.panel.revoked": "Revoked",
  "plugins.panel.connectionFailed":
    "The plugin panel could not establish a secure connection.",
  "plugins.panel.sessionEnded": "This plugin panel session has ended.",
  "plugins.actions.aria": "Plugin AI actions",
  "plugins.actions.title": "Plugin actions",
  "plugins.actions.accept": "Accept proposal",
  "plugins.actions.cancel": "Cancel action",
  "plugins.actions.cancelled": "The plugin action was cancelled.",
  "plugins.actions.failure": "The plugin action failed.",
  "plugins.workbenchPanels.aria": "Plugin panels",
  "plugins.workbenchPanels.title": "Plugin panels",
  "plugins.workbenchPanels.tab": "Plugins",
  "plugins.workbenchPanels.refresh": "Refresh plugin panels",
  "plugins.workbenchPanels.loading": "Loading plugin panels…",
  "plugins.workbenchPanels.empty": "No active plugin panels.",
  "plugins.workbenchPanels.closedHint": "Select a panel tab to open it.",
  "plugins.workbenchPanels.failure": "Panel inventory failed.",
  "plugins.permissionKicker": "Explicit authority",
  "plugins.reviewTitle": "Permission review",
  "plugins.versionChanges": "Version changes",
  "plugins.versionChange": "Version change",
  "plugins.change.none": "No version change",
  "plugins.change.added": "New request",
  "plugins.change.expanded": "Expanded scope",
  "plugins.change.narrowed": "Narrowed scope",
  "plugins.change.unchanged": "Unchanged",
  "plugins.change.removed": "Removed request",
  "plugins.reasonPlaceholder":
    "Record why this permission decision is appropriate",
  "plugins.required": "Required",
  "plugins.optional": "Optional",
  "plugins.unsupported": "Unsupported",
  "plugins.contribution": "Contribution",
  "plugins.allContributions": "All plugin contributions",
  "plugins.scope": "Granted scope",
  "plugins.scopeUnscoped": "No additional scope",
  "plugins.grant": "Grant",
  "plugins.deny": "Deny",
  "plugins.revoke": "Revoke",
  "plugins.audit": "Permission audit",
  "plugins.auditEmpty": "No permission events recorded.",
  "plugins.effect.fileRead": "Read files from Engine-managed source locations.",
  "plugins.effect.fileWrite": "Write files to Engine-managed output locations.",
  "plugins.effect.networkConnect":
    "Connect only to the listed network origins.",
  "plugins.effect.assetRead": "Read the selected translation assets.",
  "plugins.effect.assetWrite": "Modify the selected translation assets.",
  "plugins.effect.projectRead": "Read data from the selected projects.",
  "plugins.effect.projectWrite": "Modify data in the selected projects.",
  "plugins.effect.engineConnector":
    "Call the listed privileged Engine operations.",
  "plugins.effect.qaRegister":
    "Register the listed quality-assurance contributions.",
  "plugins.effect.pipelineRegister": "Register the listed pipeline steps.",
  "plugins.effect.aiAction": "Register and run the listed AI actions.",
  "plugins.effect.uiPanel": "Add the listed panels to the desktop interface.",
  "plugins.effect.externalConnector":
    "Use the listed external connector operations.",
  "plugins.effect.diagnosticsRead":
    "Read the listed bounded diagnostic categories.",
  "plugins.effect.unsupported":
    "This optional capability is not supported by this Engine and cannot be granted.",
  "export.kicker": "Delivery gate",
  "export.title": "Export review",
  "export.checking": "Checking current translation",
  "export.ready": "Ready for delivery",
  "export.blocked": "Publication blocked",
  "export.heroBody":
    "Every export runs fresh QA against {name} before publication.",
  "export.checkAgain": "Check again",
  "export.gateClear": "QA gate clear",
  "export.blockingErrors":
    "{count, plural, one {# blocking error} other {# blocking errors}}",
  "export.countsLine": "{warnings} warnings · {info} info · {waived} waived",
  "export.awaiting": "Awaiting authoritative result",
  "export.segmentsChecked": "Segments checked",
  "export.run": "Run",
  "export.originalFormat": "Original format",
  "export.blockingFindings": "Blocking findings",
  "export.noOpenErrors": "No open errors",
  "export.resolveBefore": "Resolve before delivery",
  "export.segmentLabel": "Segment {ordinal}",
  "export.nothingBlocks": "Nothing blocks publication",
  "export.warningsRemain":
    "Warnings and waived findings remain visible in the QA report.",
  "export.publication": "Publication",
  "export.publicationBody":
    "The output is validated and never replaces an existing destination.",
  "export.overrideAria": "Override the QA delivery gate",
  "export.overrideTitle": "Override blocking QA",
  "export.overrideHelp": "This decision is recorded with the export result.",
  "export.actorPlaceholder": "Responsible person",
  "export.reasonPlaceholder": "Why delivery must proceed",
  "export.publishing": "Publishing…",
  "export.exportDocument": "Export document",
  "export.helpBlocked":
    "Open each blocker in the editor, or explicitly enable a reasoned override.",
  "export.success": "Exported {count} translated segments to {name}.",
  "export.checkingTranslation": "Checking current translation",
  "export.readyForDelivery": "Ready for delivery",
  "export.publicationBlocked": "Publication blocked",
  "export.qaRunsAgainst": "QA runs against the current translation",
  "tm.exactKicker": "Exact memory",
  "tm.title": "Translation memory",
  "tm.exactAria": "Exact translation memory",
  "tm.activeLookup": "Active-source lookup",
  "tm.searchAria": "Search exact source",
  "tm.searchExactPlaceholder": "Search exact source text…",
  "tm.lookupFailed": "Exact lookup failed",
  "tm.lookingUp": "Looking up exact matches…",
  "tm.noExactMatch": "No exact match",
  "tm.noExactBody": "No confirmed entry has this exact source.",
  "tm.concordance": "Concordance",
  "tm.concordanceQuery": "Concordance query",
  "tm.concordanceDirection": "Concordance direction",
  "tm.noConcordance": "No concordance results.",
  "tm.closeConcordance": "Close concordance",
  "tm.sourceAndTarget": "Source and target",
  "nav.backToWorkbench": "Back to workbench",
  "nav.applicationViews": "Application views",
  "setup.brand": "Translunar",
  "setup.tagline": "Computer-assisted translation",
  "setup.localWorkspace": "Local workspace",
  "setup.stepsAria": "Project setup steps",
  "setup.step1": "Step 01 · identity",
  "setup.nameWorkspace": "Name the bilingual workspace",
  "setup.projectName": "Project name",
  "setup.sourceLanguage": "Source language",
  "setup.targetLanguage": "Target language",
  "setup.locale.enUS": "English (United States)",
  "setup.locale.enGB": "English (United Kingdom)",
  "setup.locale.zhCN": "Chinese (Simplified)",
  "setup.locale.zhTW": "Chinese (Traditional)",
  "setup.locale.ja": "Japanese",
  "setup.step2": "Step 02 · reusable configuration",
  "setup.chooseProfile": "Choose the operating profile",
  "setup.projectTemplate": "Project template",
  "setup.noTemplate": "No template · built-in defaults",
  "setup.qaProfile": "QA profile",
  "setup.templateDefault": "Template / default",
  "setup.pipeline": "Pipeline",
  "setup.templateNone": "Template / none",
  "setup.aiProfile": "AI profile",
  "setup.templateOffline": "Template / offline assistant",
  "setup.analysisProfile": "Analysis profile",
  "setup.templateStandard": "Template / standard",
  "setup.reviewPolicy": "Review policy",
  "setup.requireReview": "Require review",
  "setup.allowDirectSignOff": "Allow direct sign-off",
  "setup.step3": "Step 03 · source review",
  "setup.addFiles": "Add files and folders",
  "setup.commitMode": "Commit mode",
  "setup.dropFiles": "Drop files or folders here",
  "setup.selectedPathsAria": "Selected source paths",
  "setup.removeSource": "Remove source",
  "setup.removeSourceNamed": "Remove {name}",
  "setup.templateDeps": "Template dependencies",
  "setup.importDiagnostics": "Import diagnostics",
  "setup.languagesMustDiffer": "Source and target languages must be different.",
  "setup.enterName": "Enter a project name.",
  "setup.addFilesFirst":
    "Add at least one supported file or folder before importing.",
  "setup.importedNone": "Project setup imported no supported files",
  "setup.rollbackEmpty": "Rollback empty project setup",
  "setup.emptyRemoved": "The empty project was removed.",
  "setup.noFilesImported":
    "No files were imported. {cleanup} Review the diagnostics and try again.",
  "setup.stepProject": "Project",
  "setup.stepConfiguration": "Configuration",
  "setup.stepFiles": "Files",
  "setup.identityDescription":
    "Set the project identity and the single source/target locale pair used by filters, QA, TM and analytics.",
  "setup.configurationDescription":
    "References are resolved by the Engine. Missing template dependencies fall back safely and remain visible in diagnostics.",
  "setup.filesDescription":
    "Folders are discovered recursively by the Engine. Relative paths, collisions and unsupported files are reported per item.",
  "setup.loadingProfiles": "Loading reusable profiles",
  "setup.stepCounter": "STEP 0{step}",
  "setup.revisionOption": "{name} · revision {revision}",
  "setup.sourceSelections":
    "{count, plural, one {# source selection} other {# source selections}}",
  "setup.diagnosticImported": "Imported",
  "setup.cleanupSkipped":
    "Cleanup was skipped because the project is no longer active.",
  "setup.projectRetained":
    "The project was retained because it contains imported documents.",
  "qa.kicker": "Quality system",
  "qa.title": "QA and review",
  "qa.controlsAria": "QA controls",
  "qa.mandatoryReview": "Mandatory review",
  "qa.latestRunAria": "Latest QA run",
  "qa.filtersAria": "Issue filters",
  "qa.findings": "Findings",
  "qa.findingsAria": "QA findings",
  "qa.noMatch": "No findings match",
  "qa.changeFilters": "Change filters or run QA again.",
  "qa.prevIssuePage": "Previous issue page",
  "qa.nextIssuePage": "Next issue page",
  "qa.detailAria": "Finding detail",
  "qa.selectFinding": "Select a finding",
  "qa.evidenceHere": "Evidence and actions appear here.",
  "qa.reviewBandAria": "Review statistics and queue",
  "qa.reviewState": "Review state",
  "qa.translation": "Translation",
  "qa.pendingProposals": "Pending proposals",
  "qa.accepted": "Accepted",
  "qa.rejected": "Rejected",
  "qa.reviewedChars": "Reviewed chars",
  "qa.reviewerQueue": "Reviewer queue",
  "qa.noPendingProposals": "No pending revision proposals in this document.",
  "qa.falsePositive": "False positive decision",
  "qa.waiveFinding": "Waive this finding",
  "qa.loadingFindings": "Loading findings",
  "qa.noEvidence": "No text evidence is required for this rule.",
  "qa.profileRules": "Profile rules",
  "qa.closeEditor": "Close profile editor",
  "qa.customRegex": "Custom regex rules",
  "qa.noCompletedRun": "No completed run",
  "qa.runToCreate": "Run QA to create a snapshot",
  "qa.loadingReview": "Loading review state",
  "qa.queueClear": "Queue clear",
  "qa.cloneProfile": "Clone profile",
  "qa.customProfile": "Custom profile",
  "qa.saveProfile": "Save profile",
  "qa.customRule": "Custom rule",
  "qa.customPattern": "Custom pattern matched",
  "qa.mandatoryEnabled": "Mandatory review is enabled.",
  "qa.directSignOff":
    "Direct sign-off is enabled with actor and reason required.",
  "qa.settingsTitle": "QA review settings",
  "qa.reportSaved": "Saved {format} report as {name}.",
  "qa.checkedSegments": "QA checked {count} segments",
  "qa.removeRule": "Remove {label}",
  "qa.errors": "Errors",
  "qa.warnings": "Warnings",
  "qa.info": "Info",
  "qa.waived": "Waived",
  "qa.checked": "{count} checked",
  "qa.builtIn": "built-in",
  "qa.pluginHistoryAria": "Plugin QA run provenance",
  "qa.pluginHistoryKicker": "Durable rule provenance",
  "qa.pluginHistoryTitle": "Plugin QA history",
  "qa.runHistoryCount":
    "{count, plural, one {# recent run} other {# recent runs}}",
  "qa.pluginHistoryEmpty": "Recent QA runs did not execute plugin-owned rules.",
  "qa.executionCounts": "{executions} executions · {findings} findings",
  "qa.pluginOwner": "Plugin owner",
  "assistant.archive": "Archive conversation",
  "assistant.archiveNamed": "Archive {title}",
  "assistant.requestedModel": "Requested model",
  "assistant.localPreview": "Local preview",
  "assistant.localPreviewOffline": "Local preview (offline)",
  "assistant.reasoningLevel": "Reasoning level",
  "assistant.offlinePreview": "Offline preview",
  "assistant.actionsAria": "Assistant actions",
  "assistant.useInTarget": "Use in target",
  "assistant.noMessages": "No messages",
  "assistant.askAria": "Ask about the active segment",
  "assistant.askPlaceholder": "Ask about the active segment…",
  "assistant.sendAria": "Send assistant message",
  "assistant.metricsAria": "Synthetic response metrics",
  "assistant.aiMetricsAria": "AI response metrics",
  "assistant.discardSuggestion": "Discard suggestion",
  "assistant.wordDiff": "Word diff",
  "assistant.proposedTarget": "Proposed target",
  "assistant.discardProposal": "Discard proposal",
  "assistant.diffAria": "AI target diff",
  "assistant.engineConnected": "Engine connected",
  "assistant.credentialRequired": "Credential required",
  "assistant.offlineReady": "Offline preview ready",
  "assistant.startGrounded": "Start a grounded run",
  "assistant.preparing": "Preparing grounded context…",
  "assistant.runStatus": "Run {status}.",
  "assistant.noActiveSegment": "No active segment.",
  "assistant.chooseProvider":
    "Choose a connected provider and conversation first.",
  "assistant.groundingUnavailable": "Grounding preview is unavailable.",
  "assistant.aiRunFailed": "AI run failed.",
  "assistant.newConversation": "New conversation",
  "assistant.prompt.translate": "Translate this segment",
  "assistant.prompt.improve": "Improve this target",
  "assistant.prompt.formal": "Make the target more formal",
  "assistant.prompt.shorten": "Shorten the target",
  "assistant.reasoningLine": "Reasoning level: {level}.",
  "assistant.requestModel": "Request model: {model}",
  "assistant.inputTokens": "Input tokens: {value}",
  "assistant.cacheReadTokens": "Cache read tokens: {value}",
  "assistant.thinkingTokens": "Thinking tokens: {value}",
  "assistant.outputTokens": "Output tokens: {value}",
  "assistant.cacheWriteTokens": "Cache write tokens: {value}",
  "assistant.elapsedTime": "Elapsed time",
  "assistant.groundingContext": "Grounding context",
  "assistant.characters": "characters",
  "assistant.sections": "sections",
  "ai.kicker": "Workspace policy",
  "ai.title": "AI control",
  "ai.description":
    "Credentials stay in the operating-system keyring. Grounding, runs, usage, and target writes remain Engine-owned.",
  "ai.enabled": "AI enabled",
  "ai.interactiveRuns": "Interactive runs",
  "ai.batchRuns": "Batch runs",
  "ai.budgetPlaceholder": "Unlimited",
  "ai.originsPlaceholder": "Empty allows validated profile origins",
  "ai.viewsAria": "AI control views",
  "ai.connectorCatalog": "Connector catalog",
  "ai.chooseConnector": "Choose a connector",
  "ai.connectorAvailable": "Available",
  "ai.connectorUnavailable": "Unavailable",
  "ai.connectorDegraded": "Degraded",
  "ai.connectorBuiltin": "Built-in",
  "ai.connectorPlugin": "Plugin",
  "ai.connectorSchemaVersion": "Config schema v{version}",
  "ai.addProvider": "Add provider",
  "ai.configured": "Configured",
  "ai.providerProfiles": "Provider profiles",
  "ai.credentialPlaceholder": "Write-only credential",
  "ai.testConnection": "Test connection",
  "ai.editProfile": "Edit profile",
  "ai.deleteCredential": "Delete credential",
  "ai.deleteProfile": "Delete profile",
  "ai.profileEnabled": "Profile enabled",
  "ai.cancelEdit": "Cancel edit",
  "ai.cancelEditAria": "Cancel profile edit",
  "ai.noProfiles": "No provider profiles",
  "ai.tmFirst": "TM-first",
  "ai.pretranslate": "Pretranslate document",
  "ai.chooseProfile": "Choose profile",
  "ai.replaceDrafts": "Replace existing drafts",
  "ai.durableQueue": "Durable queue",
  "ai.selectedBatchAria": "Selected batch",
  "ai.batchItemsAria": "Batch items",
  "ai.noBatchRuns": "No batch runs",
  "ai.currentMonth": "Current month",
  "ai.authoritativeUsage": "Authoritative usage",
  "ai.refreshUsage": "Refresh usage",
  "ai.cacheRead": "Cache read",
  "ai.thinking": "Thinking",
  "ai.noUsage": "No AI usage this month",
  "ai.enterCredential": "Enter a credential first.",
  "ai.credentialSaved": "Credential saved to the operating-system keyring.",
  "ai.providerTestFailed": "Provider test failed.",
  "ai.credentialRemoved":
    "Credential removed from the operating-system keyring.",
  "ai.budgetInvalid": "Monthly token budget must be a positive whole number.",
  "ai.policySaved": "AI workspace policy saved.",
  "ai.chooseProviderProfile": "Choose a provider profile.",
  "ai.batchStarted": "Batch pretranslation started.",
  "ai.providerCredential": "Provider credential",
  "ai.providerCredentialDefault": "Provider credential (default)",
  "ai.credentialFor": "Credential for {name}",
  "ai.testNamed": "Test {name}",
  "ai.editNamed": "Edit {name}",
  "ai.deleteCredentialFor": "Delete credential for {name}",
  "ai.deleteNamed": "Delete {name}",
  "ai.pending": "pending",
  "ai.testTimeout": "Provider test did not finish within 30 seconds.",
  "interop.modeAria": "Interop mode",
  "interop.tableFormat": "Table format",
  "interop.package": "Package",
  "interop.signedReview": "Signed review DOCX",
  "interop.writableTm": "Writable TM library",
  "interop.noWritableLibrary": "No matching writable library",
  "interop.documentRevision": "Document revision",
  "interop.applyReason": "Apply reason",
  "interop.reviewPreviewAria": "Review preview",
  "interop.returnedTarget": "Returned target / comments",
  "interop.tablePreviewAria": "Table preview",
  "interop.sourceTarget": "Source / target",
  "interop.structuralPath": "Structural path",
  "interop.diagnosticsMeta": "Diagnostics / metadata",
  "interop.prevPage": "Previous preview page",
  "interop.nextPage": "Next preview page",
  "task.modeAria": "Task package mode",
  "task.auditAria": "Task package audit fields",
  "task.createAssignment": "Create an assignment package",
  "task.assignmentDocs": "Assignment documents",
  "task.optionalSegmentIds": "Optional segment IDs",
  "task.segmentIdsPlaceholder": "Leave empty for every segment",
  "task.noActiveDocuments": "No active documents are available.",
  "task.instructions": "Instructions for recipient",
  "task.instructionsPlaceholder": "Describe the requested handoff",
  "task.notImported": "This project is not an imported task project.",
  "task.importFirst":
    "Import an assignment package before exporting a return package.",
  "task.exportReturn": "Export a return package",
  "task.taskProject": "Task project",
  "task.originPackage": "Origin package",
  "task.originProject": "Origin project",
  "task.returnInstructions": "Return instructions",
  "task.returnNotePlaceholder": "Optional note for the project owner",
  "task.previewTitle": "Preview an assignment or return",
  "task.detachedName": "Detached project name",
  "task.detachedPlaceholder": "Package project name + (Task)",
  "task.engineClassifications": "Engine classifications",
  "task.discardStaged": "Discard staged package",
  "task.countsAria": "Task package counts",
  "task.rowsAria": "Task package rows",
  "task.noRows": "No rows were returned for this page.",
  "task.detachedReady": "Detached task project is ready",
  "task.importDocumentCount":
    "{count, plural, one {# document} other {# documents}}",
  "task.importBoundRowCount":
    "{count, plural, one {# bound row} other {# bound rows}}",
  "task.optionalSlices": "Optional slices",
  "task.tmTermRows": "TM / termbase rows",
  "task.noMountedLibrary": "No mounted library",
  "task.explicitRowIds": "Explicit row IDs",
  "task.removeSlice": "Remove asset slice",
  "task.transactionalMerge": "Transactional merge",
  "task.applySelected": "Apply selected rows?",
  "task.workflowTitle": "Offline task package workflow",
  "task.assignmentExported": "Assignment package {id} exported to {name}.",
  "task.returnExported": "Return package {id} exported to {name}.",
  "task.detachedCreated":
    "Detached task project created with {count} origin binding(s).",
  "task.applied":
    "Applied {count} selected row(s); project revision is now {revision}.",
  "task.discarded": "Staged task package files were discarded.",
  "task.boundedHandoff": "Bounded handoff",
  "task.noDestination": "No destination selected",
  "task.detachedWork": "Detached work",
  "task.trustedReview": "Trusted package review",
  "task.noPackage": "No package selected",
  "task.sourceUnavailable": "Source unavailable",
  "task.selectRow": "Select {disposition} row {ordinal}",
  "task.sliceKind": "Asset slice {index} kind",
  "task.sliceLibrary": "Asset slice {index} library",
  "task.sliceRowIds": "Asset slice {index} row IDs",
  "task.removeSliceN": "Remove asset slice {index}",
  "task.remoteChanged": "Remote changed",
  "task.localChanged": "Local changed",
  "task.bothChanged": "Both changed",
  "task.tagInvalid": "Tag invalid",
  "task.missingDependency": "Missing dependency",
  "task.applyCount": "Apply {count} selected",
  "task.applyMerge": "Apply merge",
  "task.applyDialogBody":
    "The Engine will validate the preview revisions and apply {count} safe row(s) in one transaction. Conflicts remain untouched.",
  "task.rowNumber": "Row {ordinal}",
  "insights.kicker": "Project operations",
  "insights.title": "Project insights",
  "insights.refresh": "Refresh project insights",
  "insights.panelAria": "Project insights panel",
  "insights.progressAria": "Project progress",
  "insights.progressTitle": "Project progress",
  "insights.completionAria": "Project completion",
  "insights.productivity": "Productivity",
  "insights.aiContribution": "AI contribution",
  "insights.assetHealth": "Asset health",
  "insights.trends": "Operational trends",
  "insights.qaRuns": "QA runs",
  "insights.tmUnits": "TM units",
  "insights.dropFiles": "Drop files or folders to add them",
  "insights.recycleDocument": "Recycle document",
  "insights.reconciliation": "Reconciliation plan",
  "insights.reimportCounts": "Re-import counts",
  "insights.portable": "Portable project",
  "insights.exportArchive": "Export archive",
  "insights.recoverable": "Recoverable deletion",
  "insights.recycleProject": "Recycle project",
  "insights.history": "Project history",
  "insights.analysis": "Project analysis",
  "insights.matchBands": "Match bands",
  "insights.explicitAction": "Explicit action",
  "insights.discussionsTab": "Discussions / snapshots",
  "insights.alignmentTab": "Alignment / corpora",
  "insights.taskTab": "Task packages",
  "insights.batchFinished":
    "Batch finished: {succeeded} succeeded, {failed} failed.",
  "insights.removedFromFiles": "Removed from project files",
  "insights.removedFromInsights": "Removed from project insights",
  "insights.applyReimport": "Apply re-import",
  "insights.applyPreview": "Apply preview",
  "insights.archiveExported": "Archive exported to {name}.",
  "insights.analysisStale":
    "Analysis completed but is stale against current project revisions.",
  "insights.analysisDone": "Analysis snapshot completed.",
  "insights.analyticsUnavailable": "Project analytics are unavailable.",
  "insights.qaBlockers": "QA blockers",
  "insights.activeEditing": "Active editing",
  "insights.confirmedPerHour": "Confirmed / hour",
  "insights.activityEvents": "Activity events",
  "insights.idleThreshold": "Idle threshold",
  "insights.appliedSegments": "Applied segments",
  "insights.retainedSegments": "Retained segments",
  "insights.replacedSegments": "Replaced segments",
  "insights.retainedChars": "Retained characters",
  "insights.aiHistoryUnavailable": "AI history is unavailable.",
  "insights.termEntries": "Term entries",
  "insights.openBlockers": "Open blockers",
  "insights.mountedHits": "Mounted hits",
  "insights.curationOutcomes": "Curation outcomes",
  "insights.recentBuckets": "Recent buckets",
  "insights.noTrendBuckets": "No trend buckets are available.",
  "insights.activeSourceSet": "Active source set",
  "insights.recycleNamed": "Recycle {name}",
  "insights.lastBatch": "Last batch",
  "insights.revisionReconciliation": "Revision reconciliation",
  "insights.currentRevision": "Current revision",
  "insights.currentVersion": "Current version",
  "insights.sourceHash": "Source hash",
  "insights.noReplacement": "No replacement selected",
  "insights.previewId": "Preview {id}",
  "insights.oldOrdinal": "Old {ordinal}",
  "insights.newOrdinal": "New {ordinal}",
  "insights.noOperations": "No project operations are available.",
  "insights.engineSnapshot": "Engine snapshot",
  "insights.staleAnalysis": "Stale analysis snapshot",
  "insights.analysisSnapshot": "Analysis snapshot",
  "insights.sourceWords": "Source words",
  "insights.sourceChars": "Source characters",
  "insights.sourceCjk": "Source CJK",
  "insights.targetWords": "Target words",
  "insights.targetChars": "Target characters",
  "insights.targetCjk": "Target CJK",
  "insights.weightedEffort": "Weighted effort",
  "insights.editDistance": "Edit distance",
  "insights.noAnalysis": "No analysis snapshot has been run in this view.",
  "curation.reviewAssets": "Review translation assets",
  "curation.applied": "Applied curation: {count} unit(s) quarantined.",
  "curation.rollbackRestored": "Rollback restored {count} unit(s).",
  "curation.exported": "Exported {count} active unit(s) as {format}.",
  "curation.refreshed": "Curation state refreshed from Engine.",
  "curation.catalog": "Asset catalog",
  "curation.unifiedCatalog": "Unified asset catalog",
  "curation.refreshState": "Refresh curation state",
  "curation.catalogScope": "Catalog scope",
  "curation.allAssets": "All assets",
  "curation.anyDomain": "Any domain",
  "curation.queryPlaceholder": "Source or target text",
  "curation.query": "Query",
  "curation.noCatalogRows": "No catalog rows",
  "curation.analyzeLibrary": "Analyze one TM library",
  "curation.selectTm": "Select a TM library",
  "curation.offlineChecks": "Offline deterministic checks",
  "curation.thresholds": "Deterministic thresholds",
  "curation.thresholdsHelp": "All values are sent to Engine with this run.",
  "curation.reviewChanges": "Review and select changes",
  "curation.noFindingsPage": "No findings on this page",
  "curation.analyzedUnits": "Analyzed units",
  "curation.applyRollbackExport": "Apply, rollback, and export",
  "curation.selectedFindings": "Selected findings",
  "curation.allActive": "All active",
  "curation.noRun": "No curation run yet",
  "curation.catalogRowsAria": "Asset catalog rows",
  "curation.findingsAria": "Curation findings",
  "curation.unitsAria": "Analyzed curation units",
  "curation.termsDrift": "Terms and drift",
  "curation.termCandidates": "Term candidates",
  "curation.noCandidates": "No bounded candidates.",
  "curation.driftGroups": "Drift groups",
  "curation.revisionSafe": "Revision-safe mutation",
  "curation.assetKind": "Asset kind",
  "curation.sourceLocale": "Source locale",
  "curation.targetLocale": "Target locale",
  "curation.originProject": "Origin project ID",
  "curation.originDocument": "Origin document ID",
  "curation.createdAfter": "Created after",
  "curation.createdBefore": "Created before",
  "curation.loadingCatalog": "Loading asset catalog",
  "alignment.modeAria": "Alignment and corpora mode",
  "alignment.revisionBound": "Revision-bound workspace",
  "alignment.documentAlignment": "Document alignment",
  "alignment.refresh": "Refresh alignment workspace",
  "alignment.sourceDocument": "Source document",
  "alignment.twoDocsRequired": "Two active documents required",
  "alignment.targetDocument": "Target document",
  "alignment.auditReason": "Audit reason",
  "alignment.session": "Alignment session",
  "alignment.noSessions": "No sessions yet",
  "alignment.noSession": "No alignment session",
  "alignment.selectTwoDocs":
    "Select two active documents to create the first session.",
  "alignment.linkTitle": "Link selected source-only and target-only groups",
  "alignment.mergeTitle": "Merge a contiguous candidate range",
  "alignment.unlinkTitle":
    "Separate one bilingual candidate into unaligned sides",
  "alignment.splitTitle": "Split one grouped candidate by segment order",
  "alignment.aiProfile": "AI refinement profile",
  "alignment.noCredentialProfile": "No enabled credentialed profile",
  "alignment.writableTm": "Writable TM",
  "alignment.noLocaleTm": "No locale-matching writable TM",
  "alignment.bilingualName": "Bilingual corpus name",
  "alignment.corpusPlaceholder": "Confirmed alignment corpus",
  "alignment.candidatesAria": "Alignment candidates",
  "alignment.manualLink": "Manual bilingual link",
  "corpus.projectOwned": "Project-owned retrieval",
  "corpus.importTitle": "Import reference corpus",
  "corpus.refresh": "Refresh reference corpora",
  "corpus.kind": "Corpus kind",
  "corpus.monoSource": "Monolingual source",
  "corpus.monoTarget": "Monolingual target",
  "corpus.bilingual": "Bilingual",
  "corpus.name": "Corpus name",
  "corpus.namePlaceholder": "Product documentation 2026",
  "corpus.sourceLocale": "Source locale",
  "corpus.targetLocale": "Target locale",
  "corpus.mounted": "Mounted assets",
  "corpus.removed": "Removed",
  "corpus.authoritative": "Authoritative ranking",
  "corpus.searchTitle": "Search corpora",
  "corpus.query": "Query",
  "corpus.queryPlaceholder": "Search source or target expressions",
  "corpus.side": "Side",
  "corpus.sourceAndTarget": "Source and target",
  "corpus.allActive": "All active corpora",
  "corpus.noSearchYet": "No corpus search has been run.",
  "corpus.reference": "Reference corpus",
  "corpus.closeRemove": "Close remove corpus confirmation",
  "discussion.modeAria": "Discussion and snapshot workflow",
  "discussion.start": "Start a discussion",
  "discussion.scopeAria": "Discussion scope",
  "discussion.titleOptional": "Title (optional)",
  "discussion.titlePlaceholder": "Review question",
  "discussion.firstMessage": "First message",
  "discussion.messagePlaceholder":
    "Write a local note and use literal @mentions where useful.",
  "discussion.threadsAria": "Discussion threads",
  "discussion.refresh": "Refresh discussions",
  "discussion.includeResolved": "Include resolved",
  "discussion.noMatching": "No matching discussions",
  "discussion.startOne": "Start one for the selected scope.",
  "discussion.selectedAria": "Selected discussion",
  "discussion.editMessage": "Edit message",
  "discussion.mentionsAria": "Literal mentions",
  "discussion.noMessagesPage": "No messages on this page",
  "discussion.reply": "Reply",
  "discussion.selectOne": "Select a discussion",
  "discussion.messagesHere": "Messages and revision-bound actions appear here.",
  "discussion.tombstone": "Durable tombstone",
  "snapshot.createNamed": "Create a named snapshot",
  "snapshot.name": "Snapshot name",
  "snapshot.namePlaceholder": "Before legal review",
  "snapshot.listAria": "Project snapshots",
  "snapshot.refresh": "Refresh project snapshots",
  "snapshot.none": "No project snapshots",
  "snapshot.createCheckpoint": "Create a named checkpoint for this project.",
  "snapshot.selectedAria": "Selected project snapshot",
  "snapshot.previewAria": "Restore preview",
  "snapshot.workspaceChanges": "Workspace changes",
  "snapshot.missingDeps": "Missing mounted dependencies",
  "snapshot.runPreviewFirst": "Run a preview before restoring this snapshot.",
  "snapshot.selectOne": "Select a snapshot",
  "snapshot.metaHere": "Metadata and restore preview appear here.",
  "snapshot.atomicRestore": "Atomic restore",
  "workbench.activeDocument": "Active document",
  "workbench.searchPlaceholder": "Search in document",
  "workbench.searchAria": "Search in document",
  "workbench.segmentFilters": "Segment filters",
  "workbench.additionalFilters": "Additional segment filters",
  "workbench.tagged": "Tagged",
  "workbench.commented": "Commented",
  "workbench.exactTmMatching": "Exact TM matching",
  "workbench.exactTm": "Exact TM",
  "workbench.editorCommands": "Editor commands",
  "workbench.commandPalette": "Command palette",
  "workbench.openCommandPalette": "Open command palette",
  "workbench.findReplace": "Find and replace",
  "workbench.openFindReplace": "Open find and replace",
  "workbench.undoAria": "Undo editor operation",
  "workbench.redoAria": "Redo editor operation",
  "workbench.openComments": "Open segment comments",
  "workbench.issueNav": "Issue navigation",
  "workbench.prevIssue": "Previous issue",
  "workbench.nextIssue": "Next issue",
  "workbench.segmentsAria": "Translation segments",
  "workbench.segmentTools": "Active segment tools",
  "workbench.copyTags": "Copy protected tags",
  "workbench.insertTag": "Insert protected tag",
  "workbench.insertTagPair": "Insert protected tag pair",
  "workbench.splitSegment": "Split segment",
  "workbench.mergeNext": "Merge with next segment",
  "workbench.correctSource": "Correct source",
  "workbench.openChinese": "Open Chinese conversion",
  "workbench.openCommentsShort": "Open comments",
  "workbench.openReview": "Open review panel",
  "workbench.targetTags": "Target protected tags",
  "workbench.moveTagHint": "Select, then use Move tag to caret",
  "workbench.untranslated": "Untranslated",
  "workbench.tab": "Tab",
  "workbench.addDictionary": "Add to user dictionary",
  "workbench.noSegmentsMatch": "No segments match this view.",
  "workbench.loadingMatches": "Checking exact TM matches…",
  "workbench.loadingTerms": "Checking terminology…",
  "workbench.loadingAssistant": "Waiting for the first Assistant response…",
  "workbench.loadingPdfPage": "Rendering the PDF page…",
  "workbench.noTmMatchState": "No exact TM match for this segment.",
  "workbench.noTermHitState": "No term hit in this segment.",
  "workbench.noOpenQaState": "No open QA issue.",
  "workbench.noAssistantConversation": "No Assistant conversation yet.",
  "workbench.noGridMatches": "No segment matches these filters.",
  "workbench.clearGridFilters": "Clear filters",
  "workbench.noPdfPage": "No PDF page is available.",
  "workbench.noPdfBlocks": "No extracted blocks on this page.",
  "workbench.commandPaletteAria": "Command palette dialog",
  "workbench.typeCommand": "Type a command",
  "workbench.filterCommands": "Filter commands",
  "workbench.closeCommandPalette": "Close command palette",
  "workbench.preferencesAria": "Editor preferences",
  "workbench.workspacePreferences": "Workspace preferences",
  "workbench.editorShortcuts": "Editor and shortcuts",
  "workbench.closePreferences": "Close editor preferences",
  "workbench.themeSystem": "System",
  "workbench.themeLight": "Light",
  "workbench.themeDark": "Dark",
  "workbench.shortcutPresets": "Shortcut presets",
  "workbench.auditedSource": "Audited source edit",
  "workbench.chineseDicts": "Embedded OpenCC dictionaries",
  "workbench.simplifiedTraditional": "Simplified / Traditional Chinese",
  "workbench.projectTransform": "Project transform",
  "workbench.noComments": "No comments on this segment.",
  "workbench.reviewBypass": "Review bypass",
  "workbench.signOffDirectly": "Sign off directly",
  "workbench.localReview": "Local review workflow",
  "workbench.reviewRevisions": "Review revisions",
  "workbench.sourceRevision": "Source revision",
  "workbench.targetRevision": "Target revision",
  "workbench.documentPreview": "Document preview",
  "workbench.followActive": "Follow active",
  "workbench.previewStructure": "Document flow",
  "workbench.previewStructureRail": "Document structure",
  "workbench.previewStructureAvailable": "Engine structure path",
  "workbench.previewStructureLimited": "Ordered segments",
  "workbench.previewStructureNote":
    "Engine order is shown; page layout is not available for this format.",
  "workbench.noExtractedBlocks": "No extracted blocks on this page.",
  "workbench.projectTm": "Project TM",
  "workbench.preferredTarget": "Preferred target",
  "workbench.closeSourceCorrection": "Close source correction",
  "workbench.correctedSource": "Corrected source",
  "workbench.sourceCorrectionReason": "Source correction reason",
  "workbench.chineseConversion": "Chinese conversion",
  "workbench.closeChinese": "Close Chinese conversion",
  "workbench.chineseProfile": "Chinese conversion profile",
  "workbench.closeFindReplace": "Close find and replace",
  "workbench.segmentComments": "Segment comments",
  "workbench.closeComments": "Close comments",
  "workbench.editedComment": "Edited comment text",
  "workbench.addDurableComment": "Add a durable comment",
  "workbench.newComment": "New comment",
  "workbench.addComment": "Add comment",
  "workbench.closeReview": "Close review panel",
  "workbench.workflowState": "Segment workflow state",
  "workbench.proposedSource": "Proposed source revision",
  "workbench.proposedTarget": "Proposed target revision",
  "workbench.createReview": "Create review proposal",
  "workbench.resizePreview": "Resize document preview",
  "workbench.followActiveSegment": "Follow active segment",
  "workbench.pdfPage": "PDF page",
  "workbench.extractedBlocks": "Extracted PDF blocks",
  "workbench.correctOcr": "Correct OCR source",
  "workbench.ocrReason": "OCR correction reason",
  "workbench.reasonForCorrection": "Reason for correction",
  "workbench.collapseSuggestions": "Collapse Suggestions",
  "workbench.openSuggestions": "Open Suggestions",
  "workbench.targetSegment": "Target segment {ordinal}",
  "workbench.exportedSegments":
    "Exported {count} translated segments to {name}.",
  "plugins.disable": "Disable",
  "plugins.uninstall": "Uninstall",
  "plugins.bundledTitle": "Bundled core plugins",
  "plugins.bundledLede":
    "Offline release-bundled packages managed by the Engine. Paths are never exposed to the renderer.",
  "plugins.bundledUnavailable":
    "Bundled catalog is unavailable. Local install and installed plugins still work.",
  "plugins.bundledEmpty": "No bundled packages are listed.",
  "plugins.bundledInstall": "Install",
  "plugins.bundledUpdate": "Update",
  "plugins.bundledCurrent": "Current",
  "plugins.bundledState.available": "available",
  "plugins.bundledState.installed": "installed",
  "plugins.bundledState.updateAvailable": "update available",
  "plugins.bundledState.current": "current",
  "plugins.installedTitle": "Installed plugins",
  "plugins.upgrade": "Upgrade…",
  "plugins.versionHistory": "Versions",
  "plugins.versionHistoryTitle": "Versions — {name}",
  "plugins.versionActive": "active",
  "plugins.rollback": "Roll back",
  "plugins.inspectTitle": "Inspect package",
  "plugins.inspectId": "Plugin ID",
  "plugins.inspectVersion": "Version",
  "plugins.inspectTier": "Tier",
  "plugins.inspectSource": "Source",
  "plugins.inspectHash": "Package hash",
  "plugins.inspectLicense": "Publisher / license",
  "plugins.inspectLicenseNone": "none declared",
  "plugins.inspectCompatibility": "Compatibility",
  "plugins.inspectContributions": "Contributions",
  "plugins.inspectConfirmInstall": "Install package",
  "plugins.inspectConfirmUpgrade": "Upgrade package",
  "plugins.inspectIdMismatch":
    "Upgrade package id {actual} does not match installed plugin {expected}.",
  "plugins.source.localDirectory": "local directory",
  "plugins.source.localArchive": "local archive",
  "plugins.source.bundled": "bundled",
  "plugins.crashCount": "crashes: {count}",
  "export.checkAgainInline": "Check again",
  "export.warningsRemainInline":
    "Warnings and waived findings remain visible in the QA report.",
  "export.publicationBodyInline":
    "The output is validated and never replaces an existing destination.",
  "export.overrideHelpInline":
    "This decision is recorded with the export result.",
  "export.helpBlockedInline":
    "Open each blocker in the editor, or explicitly enable a reasoned override.",
  "ai.defaultProfile": "Default profile",
  "ai.monthlyBudget": "Monthly token budget",
  "ai.allowedOrigins": "Allowed origins",
  "ai.connector": "Connector",
  "ai.profileName": "Profile name",
  "ai.baseUrl": "Base URL",
  "ai.timeoutMs": "Timeout (ms)",
  "ai.tmThreshold": "TM threshold",
  "ai.concurrency": "Concurrency",
  "ai.requestsPerMinute": "Requests / minute",
  "alignment.noCandidatesPage": "No candidates on this page.",
  "alignment.noCorporaMatch": "No corpora match this status filter.",
  "alignment.noCorpusEntry": "No corpus entry matches this query and scope.",
  "alignment.reloadState": "Reload authoritative state",
  "alignment.createdCandidates":
    "Created {links} candidates across {units} work units.",
  "alignment.appliedTm":
    "Applied {inserted} TM units; {duplicates} existing units were retained.",
  "curation.staleRevisions":
    "Engine revisions changed. Refresh before retrying a mutation.",
  "curation.reloadState": "Reload authoritative state",
  "curation.selectAndAnalyze":
    "Select a library and analyze it to inspect scores and findings.",
  "curation.noCompeting": "No competing translations.",
  "assistant.newConversationInline": "New conversation",
  "assistant.openAiProfile": "OpenAI-compatible profile",
  "assistant.applied": "Applied",
  "discussion.discussions": "Discussions",
  "discussion.projectSnapshots": "Project snapshots",
  "discussion.tombstoneBody":
    "The message body will be replaced by an auditable tombstone. Its ordinal remains in the thread.",
  "snapshot.revisionBoundPreview": "Revision-bound preview",
  "snapshot.created": "Snapshot {name} created.",
  "interop.selectAndPreview":
    "Select an input and preview it to inspect authoritative rows.",
  "interop.appliedReview": "Applied {count} review row(s).",
  "interop.reviewImportReason": "Interop review import",
  "interop.tableImportReason": "Bilingual table import",
  "interop.reviewPreviewEmpty": "Review package preview",
  "interop.tablePreviewEmpty": "Bilingual table preview",
  "insights.previewReconciliation": "Preview reconciliation",
  "insights.restoreFromHome":
    "Project restore and purge remain available from the project home.",
  "qa.documentScope": "Document",
  "qa.projectScope": "Project",
  "qa.editProfile": "Edit profile",
  "qa.resetFilters": "Reset filters",
  "qa.openSegment": "Open segment",
  "qa.revokeWaiver": "Revoke waiver",
  "qa.waiveFindingBtn": "Waive finding",
  "qa.recordWaiver": "Record waiver",
  "qa.maxTargetChars": "Maximum target characters",
  "qa.builtinImmutable":
    "Built-in profiles are immutable. Saving creates a project-owned clone that you can edit.",
  "qa.addRule": "Add rule",
  "qa.pattern": "Pattern",
  "qa.message": "Message",
  "qa.replacementHint": "Replacement hint",
  "setup.templateRequired": "Template / required default",
  "setup.bestEffort": "Best effort · keep valid files",
  "setup.allOrNothing": "All or nothing · atomic batch",
  "setup.pathsSanitized":
    "Paths are sanitized in the trusted preload; the renderer never reads file contents.",
  "setup.sqlitePrivate": "SQLite workspace · local files · private by default",
  "task.exportImmutable":
    "Export immutable sources and only the rows and assets you explicitly select.",
  "task.everySliceRequires":
    "Every added asset slice requires a mounted library and at least one explicit row ID.",
  "task.engineChangedOnly":
    "The Engine will include only changed rows bound to the origin assignment.",
  "task.noAssetRows":
    "No asset rows selected. Assignment export will include no shared-library data.",
  "nav.workbench": "Workbench",
  "nav.qaReview": "QA review",
  "nav.exportReview": "Export review",
  "nav.translationMemory": "Translation memory",
  "nav.aiControl": "AI control",
  "nav.projectInsights": "Project insights",
  "nav.projects": "Projects",
  "workbench.confirm": "Confirm",
  "workbench.default": "Default",
  "workbench.saveShortcuts": "Save shortcuts",
  "workbench.insertTarget": "Insert target",
  "workbench.applyCorrection": "Apply correction",
  "workbench.conversionProfile": "Conversion profile",
  "workbench.applyConversion": "Apply conversion",
  "workbench.replaceWith": "Replace with",
  "workbench.regularExpression": "Regular expression",
  "workbench.caseSensitive": "Case sensitive",
  "workbench.wholeWord": "Whole word",
  "tm.lookingUpDots": "Looking up exact matches...",
  "assistant.askPlaceholderDots": "Ask about the active segment...",
  "workbench.preview": "Preview",
  "workbench.applyUnchanged": "Apply unchanged preview",
  "workbench.editComment": "Edit comment",
  "workbench.saveEdit": "Save edit",
  "workbench.mandatoryDisabled":
    "Mandatory review is disabled for this project. This explicit decision is written to durable history.",
  "workbench.signOff": "Sign off",
  "workbench.noReviewProposals": "No review proposals for this segment.",
  "workbench.proposeTags": "Propose protected tags copied from source",
  "workbench.correctOcrBtn": "Correct OCR",
  "discussion.tombstoneBody2":
    "The message body will be replaced by an auditable tombstone. Its ordinal remains in the thread.",
  "setup.cleanupFailed": "Empty-project cleanup failed: {detail}",
  "insights.archiveExportedDiag": "Archive exported. {detail}",
  "discussion.tombstoneBody3":
    "The message body will be replaced by an auditable tombstone. Its ordinal remains in the thread history.",
  "ai.profileCreated": "{name} profile created.",
  "ai.connectionSucceeded": "{name} connection succeeded.",
  "ai.profileRemoved": "{name} removed.",
  "ai.profileUpdated": "{name} profile updated.",
  "ai.savePolicy": "Save policy",
  "ai.providersTab": "Providers",
  "ai.batchTab": "Batch",
  "ai.usageTab": "Usage",
  "ai.startBatch": "Start batch",
  "ai.resume": "Resume",
  "ai.store": "Store",
  "ai.credentialStored": "Stored",
  "ai.credentialMissing": "Missing",
  "discussion.createdWithMessage": "Discussion created with its first message.",
  "discussion.replyAdded": "Reply added.",
  "discussion.messageUpdated": "Message {ordinal} updated.",
  "discussion.messageTombstoned": "Message {ordinal} deleted as a tombstone.",
  "discussion.resolved": "Discussion resolved.",
  "discussion.reopened": "Discussion reopened.",
  "discussion.loadingThreads": "Loading threads",
  "discussion.loadingMessages": "Loading messages",
  "snapshot.loading": "Loading snapshots",
  "snapshot.previewReady": "Restore preview is ready.",
  "snapshot.previewNeedsDeps":
    "Preview is ready, but dependencies must be restored before apply.",
  "snapshot.restored": "Snapshot restored.",
  "snapshot.restoredWithOp": "Snapshot restored in operation {id}.",
  "snapshot.createdBy": "Created by {actor}",
  "snapshot.checkpointCount": "{count} immutable checkpoints",
  "interop.reviewExported": "Review DOCX exported with {count} rows.",
  "interop.reviewPreviewReady": "Review preview ready: {count} rows.",
  "interop.tablePreviewReady": "Table preview ready: {count} rows.",
  "interop.tableImported": "Imported {count} table row(s) into the TM.",
  "interop.reviewDocxTab": "Review DOCX",
  "interop.tableToTmTab": "Table to TM",
  "interop.preview": "Preview",
  "interop.exportDestination": "Review export destination",
  "interop.inputRow": "Input row {row}",
  "interop.applyCount": "Apply {count}",
  "interop.reviewRowCount": "{count} review rows",
  "interop.tableRowCount": "{count} table rows",
  "interop.selectReviewInput": "Select review DOCX",
  "interop.selectTableInput": "Select table",
  "interop.noInputSelected": "No input selected",
  "interop.applied": "Applied",
  "interop.selectReviewRow": "Select review row {row}",
  "interop.selectTableRow": "Select table row {row}",
  "interop.row": "Row {row}",
  "interop.noStatus": "No status",
  "interop.currentTarget": "Current: {value}",
  "interop.noTarget": "No target",
  "interop.comment": "Comment: {value}",
  "interop.noComment": "No comment",
  "interop.emptySource": "(empty source)",
  "interop.unchangedTarget": "(unchanged target)",
  "interop.missingSource": "(missing source)",
  "interop.missingTarget": "(missing target)",
  "alignment.correctionSaved":
    "{command} correction saved at session revision {revision}.",
  "alignment.candidateMarked": "Candidate {ordinal} marked {status}.",
  "alignment.refinementCanceled":
    "Alignment refinement was canceled without changing links.",
  "alignment.aiSuggestionsReady":
    "AI suggestions are ready as proposed alignment links.",
  "alignment.corpusCreated": "Created {name} with {count} bilingual entries.",
  "alignment.corpusImported":
    "Imported {name}: {entries} entries, {diagnostics} diagnostics.",
  "alignment.corpusReindexed": "Reindexed {name} at revision {revision}.",
  "alignment.corpusRemoved":
    "{name} was removed from retrieval; its managed source remains recoverable.",
  "alignment.createSession": "Create session",
  "alignment.tabAlignment": "Alignment",
  "alignment.tabCorpora": "Reference corpora",
  "alignment.link": "Link",
  "alignment.merge": "Merge",
  "alignment.unlink": "Unlink",
  "alignment.split": "Split",
  "alignment.createCorpus": "Create corpus",
  "alignment.reject": "Reject",
  "alignment.selectFile": "Select file",
  "alignment.importCorpus": "Import corpus",
  "alignment.reindex": "Reindex",
  "curation.runCompleted": "{mode} curation run completed for {count} unit(s).",
  "curation.modeProvider": "Provider",
  "curation.modeOffline": "Offline",
  "curation.baseLibraryRevision": "Base library revision {revision}",
  "curation.runRevisionLabel": "Run revision {revision}",
  "curation.global": "Global",
  "curation.applyFilters": "Apply filters",
  "curation.reset": "Reset",
  "curation.refreshRevisions": "Refresh revisions",
  "curation.selectVisible": "Select visible",
  "curation.clear": "Clear",
  "curation.applySelected": "Apply selected",
  "curation.rollbackRun": "Rollback run",
  "curation.noCatalogMatch": "No assets match the current scope and filters.",
  "curation.catalogPages": "Asset catalog pages",
  "curation.runKicker": "Curation run",
  "curation.libraryRevision": "Library revision {revision}",
  "curation.noLibrarySelected": "No library selected",
  "curation.tmLibrary": "TM library",
  "curation.analyzeAction": "Analyze library",
  "curation.rolledBack": "Rolled back",
  "curation.providerRefinement": "Provider refinement",
  "curation.offlineAnalysis": "Offline analysis",
  "curation.actor": "Actor {actor}",
  "curation.findingsKicker": "Explainable findings",
  "curation.selectedCount": "{count} selected",
  "curation.loadingFindings": "Loading curation findings",
  "curation.noFindingsDetail":
    "The run completed without findings on the current page.",
  "curation.actionsKicker": "Revision-safe actions",
  "curation.quarantineSelected":
    "{count} quarantine candidate(s) selected across pages.",
  "curation.exportFormat": "Export format",
  "curation.minimumScore": "Minimum score bp",
  "curation.applySelection": "Apply selection",
  "insights.movedToRecycle": "{name} moved to the recycle bin.",
  "insights.reimportPreviewReady": "Re-import preview is ready.",
  "insights.reimported": "{name} was re-imported.",
  "insights.tabOverview": "Overview",
  "insights.tabFiles": "Files",
  "insights.tabReimport": "Re-import",
  "insights.tabAssets": "Assets",
  "insights.tabPlugins": "Plugins",
  "insights.tabInterop": "Interop",
  "insights.tabArchive": "Archive",
  "insights.tabAnalysis": "Analysis",
  "insights.loading": "Loading project data",
  "insights.addFiles": "Add files",
  "insights.addFolder": "Add folder",
  "insights.selectReplacement": "Select replacement",
  "insights.exportTlcat": "Export .tlcat",
  "insights.recycleDocumentDescription":
    "{name} will leave the active project and remain recoverable from the project home.",
  "insights.recycleProjectDescription":
    "{name} and its active documents will leave normal project and search results.",
  "insights.applyReimportDescription":
    "Apply this revision-bound preview to {name}. Removed and ambiguous segments will follow the Engine reconciliation plan.",
  "insights.projectFiles": "{count} project files",
  "insights.unavailable": "Unavailable",
  "insights.diagnosticsCount": "{count} diagnostics",
  "insights.blockerCount": "{count} blockers",
  "insights.unchanged": "Unchanged",
  "insights.changed": "Changed",
  "insights.newSegments": "New",
  "insights.removed": "Removed",
  "insights.ambiguous": "Ambiguous",
  "insights.runAnalysis": "Run analysis",
  "insights.newLabel": "New {ordinal}",
  "insights.newItem": "New",
  "insights.removedLabel": "Removed",
  "insights.untranslated": "Untranslated",
  "insights.draft": "Draft",
  "insights.reviewed": "Reviewed",
  "insights.translation": "Translation",
  "insights.review": "Review",
  "insights.signed": "Signed",
  "insights.activity": "Activity",
  "insights.automation": "Automation",
  "insights.tmReuse": "TM reuse",
  "insights.historyCount": "{count} recorded operations",
  "insights.fileRevisionVersion": "revision {revision} · version {version}",
  "insights.fileSegments": "{count} segments",
  "insights.fileSegmentsDiagnostics":
    "{count} segments · {diagnostics} diagnostics",
  "insights.profileRevision": "{profile} · revision {revision}",
  "insights.repetitions": "Repetitions",
  "insights.exact": "Exact",
  "insights.match9599": "95–99",
  "insights.match8594": "85–94",
  "insights.match7584": "75–84",
  "insights.match5074": "50–74",
  "insights.noMatch": "No match",
  "insights.milliUnits": "{value} mU",
  "insights.percent": "{value}%",
  "insights.durationSeconds": "{value} sec",
  "insights.durationMinutes": "{value} min",
  "insights.durationHours": "{value} hr",
  "qa.run": "Run QA",
  "qa.waivedBy": "Waived by {actor}",
  "qa.relatedSegmentCount":
    "{count, plural, one {# related segment} other {# related segments}}",
  "qa.segmentOrdinal": "Segment {ordinal}",
  "qa.name": "Name",
  "qa.label": "Label",
  "qa.field": "Field",
  "qa.reviewStats": "{signed} signed · {review} in review",
  "qa.pendingProposalCount": "{count} pending proposals",
  "task.previewReady": "{kind} preview ready: {count} row(s).",
  "task.kindAssignment": "Assignment",
  "task.kindReturn": "Return",
  "task.identicalEdit": "identical edit",
  "task.openPackage": "Open package",
  "task.chooseDestination": "Choose .tltask destination",
  "task.exportAssignment": "Export assignment",
  "task.openTltask": "Open .tltask",
  "task.previewPackage": "Preview package",
  "task.importDetached": "Import detached task",
  "task.selectSafeOnPage": "Select safe on page",
  "task.previous": "Previous",
  "task.openTaskProject": "Open task project",
  "task.addSlice": "Add slice",
  "setup.addFilesBtn": "Add files",
  "setup.addFolderBtn": "Add folder",
  "setup.noSourcesSelected": "No sources selected",
  "setup.continue": "Continue",
  "setup.openWorkspace": "Open workspace",
  "setup.importing": "Importing",
  "assistant.action.improve": "Improve",
  "assistant.action.fixTerms": "Fix terms",
  "assistant.action.shorten": "Shorten",
  "assistant.action.explain": "Explain",
  "assistant.action.translate": "Translate",
  "assistant.action.formal": "Formal",
  "assistant.prompt.fixTerms": "Fix terminology",
  "assistant.prompt.explain": "Explain the source",
  "assistant.conversation": "Conversation",
  "assistant.you": "You",
  "assistant.roleAssistant": "Assistant",
  "assistant.metric.offlineModel": "Offline model profile: {model}",
  "assistant.metric.inputTokens": "Synthetic input tokens: {count}",
  "assistant.metric.cacheRead": "Synthetic cache read tokens: {count}",
  "assistant.metric.thinking": "Synthetic thinking tokens: {count}",
  "assistant.metric.outputTokens": "Synthetic output tokens: {count}",
  "assistant.metric.cacheWrite": "Synthetic cache write tokens: {count}",
  "assistant.metric.elapsed": "Synthetic elapsed time: {value}",
  "assistant.stop": "Stop",
  "assistant.newConversationTitle": "New conversation",
  "assistant.elapsedLabel": "Elapsed time",
  "workbench.runQa": "Run QA",
  "workbench.more": "More",
  "workbench.tags": "Tags",
  "workbench.theme": "Theme",
  "workbench.zoom": "Zoom",
  "workbench.trados": "Trados",
  "workbench.find": "Find",
  "workbench.reject": "Reject",
  "workbench.accept": "Accept",
  "workbench.matches": "Matches",
  "workbench.assistant": "Assistant",
  "workbench.insert": "Insert",
  "workbench.translationProject": "Translation project",
  "workbench.segmentsCount":
    "{count, plural, one {# segment} other {# segments}}",
  "workbench.conversionDescription":
    "The Engine converts the complete active target with OpenCC-grade phrase dictionaries. The change is revisioned and can be undone or redone.",
  "workbench.openPreview": "Open preview",
  "workbench.collapsePreview": "Collapse preview",
  "workbench.restoreSuggestions": "Restore suggestions",
  "workbench.maximizeSuggestions": "Maximize suggestions",
  "workbench.segmentLabel": "Segment {number}",
  "workbench.noExactMatch": "No exact TM match",
  "workbench.noTermHits": "No term hits",
  "workbench.noTargetTranslation": "No target translation",
  "workbench.chinese.s2t": "Simplified → Traditional",
  "workbench.chinese.s2tw": "Simplified → Taiwan (vocabulary)",
  "workbench.chinese.s2hk": "Simplified → Hong Kong",
  "workbench.chinese.t2s": "Traditional → Simplified",
  "workbench.chinese.tw2s": "Taiwan vocabulary → Simplified",
  "workbench.chinese.hk2s": "Hong Kong → Simplified",
  "workbench.filterAll": "All",
  "workbench.filterUntranslated": "Untranslated",
  "workbench.filterDraft": "Draft",
  "workbench.filterConfirmed": "Confirmed",
  "workbench.filterIssues": "Issues",
  "workbench.sourceColumn": "Source ({locale})",
  "workbench.targetColumn": "Target ({locale})",
  "workbench.spellFindingsFrom": "Spell findings from {provider}",
  "workbench.selectProtectedTag":
    "Select protected tag {tag} at position {position}",
  "workbench.acceptAutocomplete": "Accept {provider} autocomplete",
  "workbench.signedReadOnly":
    "Signed segments are read-only. Return the segment to review or translation first.",
  "workbench.importNote": "import note",
  "workbench.reopen": "Reopen",
  "workbench.resolve": "Resolve",
  "workbench.changedFrom": "Changed from {before} to {after}",
  "common.pageRange": "{start}–{end} of {total}",
  "common.positionOf": "{position} of {total}",
  "common.revision": "Revision {revision}",
  "common.messages": "messages",
  "common.activeMessages": "active messages",
  "common.entries": "entries",
  "common.diagnosticsCount": "diagnostics",
  "common.readOnly": "read only",
  "common.units": "units",
  "common.matches": "matches",
  "common.relatedUnits": "related units",
  "common.agreement": "agreement",
  "common.segmentCount": "{count, plural, one {# segment} other {# segments}}",
  "common.selectedCount": "{count} selected",
  "common.sourceExpression": "Source expression",
  "common.targetExpression": "Target expression",
  "common.noSourceExpression": "(no source expression)",
  "common.noTargetExpression": "(no target expression)",
  "common.noStructuralPath": "No structural path",
  "common.noSourceMember": "No source member",
  "common.noTargetMember": "No target member",
  "common.projectScope": "Project scope",
  "common.documentScope": "Document scope",
  "common.segmentScope": "Segment scope",
  "common.entireProject": "Entire project",
  "common.localReview": "Local review",
  "common.immutableCheckpoint": "Immutable checkpoint",
  "common.createSnapshot": "Create snapshot",
  "common.restoreSnapshot": "Restore snapshot",
  "common.previewRestore": "Preview restore",
  "common.refreshPreview": "Refresh preview",
  "common.baseRevision": "Base revision",
  "common.documents": "Documents",
  "common.segments": "Segments",
  "common.threadsCount": "Threads",
  "common.expectedRevision": "Expected revision {revision}",
  "common.stateDigest": "State {digest}",
  "common.selectNamed": "Select {name}",
  "common.deleteNamed": "Delete {name}",
  "common.editNamed": "Edit {name}",
  "alignment.loadingSessions": "Loading alignment sessions",
  "alignment.loadingCorpora": "Loading reference corpora",
  "alignment.sessionsLabel": "Alignment sessions",
  "alignment.candidatesLabel": "Alignment candidates",
  "alignment.selectedCount": "{count} selected",
  "alignment.sessionStatus": "Session {status}",
  "alignment.terminalResult":
    "{inserted} inserted, {duplicates} duplicates at TM revision {revision}.",
  "alignment.terminalLocked":
    "This session is terminal and correction controls are locked.",
  "alignment.refine":
    "Refine {count, plural, one {# proposal} other {# proposals}}",
  "alignment.applyTmCount": "Apply {count}",
  "alignment.selectCandidate": "Select alignment candidate {ordinal}",
  "alignment.sourceSegments": "Source · {count} segment(s)",
  "alignment.targetSegments": "Target · {count} segment(s)",
  "alignment.sourceUnaligned": "(source unaligned)",
  "alignment.targetUnaligned": "(target unaligned)",
  "alignment.noSourceMember": "No source member",
  "alignment.noTargetMember": "No target member",
  "alignment.evidenceCount": "Evidence · {count}",
  "alignment.refinementFailed": "Alignment refinement failed.",
  "alignment.refinementPollingCanceled":
    "Alignment refinement polling was canceled.",
  "alignment.refinementTimeout":
    "Alignment refinement did not finish within two minutes.",
  "alignment.candidateCount": "{count} alignment candidates",
  "alignment.sessionMeta": "Session {id} · revision {revision}",
  "corpus.chooseOrDrop": "Choose or drop one corpus file",
  "corpus.noFileSelected": "No file selected",
  "corpus.referenceCount": "{count} reference corpora",
  "corpus.entries": "entries",
  "corpus.diagnostics": "diagnostics",
  "corpus.revision": "revision",
  "corpus.matchCount": "{count} matches",
  "corpus.entry": "Entry {ordinal} · {id}",
  "corpus.noSourceExpression": "(no source expression)",
  "corpus.noTargetExpression": "(no target expression)",
  "corpus.noStructuralPath": "No structural path",
  "corpus.noProvenance": "No additional provenance",
  "corpus.provenanceUnavailable": "Provenance is unavailable",
  "corpus.removeNamed": "Remove {name}",
  "corpus.removeBody":
    "Search and AI grounding will exclude this corpus immediately. Original documents, TM units, and the managed source are not changed.",
  "corpus.removing": "Removing",
  "corpus.searchResults": "Corpus search results",
  "corpus.referenceCorpora": "Reference corpora",
  "corpus.documents": "Documents {source} / {target}",
  "corpus.alignment": "Alignment {id}",
  "corpus.removeAction": "Remove corpus",
  "discussion.localReview": "Local review",
  "discussion.segmentLimit": "Showing the first {shown} of {total} segments.",
  "discussion.createDiscussion": "Create discussion",
  "discussion.messageCount": "{count} messages",
  "discussion.scopeTitle": "{scope} discussion",
  "discussion.resolve": "Resolve",
  "discussion.reopen": "Reopen",
  "discussion.deletedMessage": "Deleted message",
  "discussion.editNamed": "Edit message {ordinal}",
  "discussion.deleteNamed": "Delete message {ordinal}",
  "discussion.replyPlaceholder": "Add a local reply",
  "discussion.reopenBeforeReply": "Reopen this discussion before replying",
  "discussion.deleteAction": "Delete message",
  "discussion.threadPages": "Thread pages",
  "discussion.messagePages": "Message pages",
  "discussion.revision": "Revision {revision}",
  "discussion.activeMessages": "{count} active messages",
  "snapshot.immutableCheckpoint": "Immutable checkpoint",
  "snapshot.create": "Create snapshot",
  "snapshot.revision": "Revision {revision}",
  "snapshot.refreshPreview": "Refresh preview",
  "snapshot.previewRestore": "Preview restore",
  "snapshot.baseRevision": "Base revision",
  "snapshot.documents": "Documents",
  "snapshot.segments": "Segments",
  "snapshot.threads": "Threads",
  "snapshot.expectedRevision": "Expected revision {revision}",
  "snapshot.state": "State {digest}",
  "snapshot.restoreSnapshot": "Restore snapshot",
  "snapshot.restoreTitle": "Restore {name}",
  "snapshot.restoreBody":
    "The Engine will recheck project revision {revision} and the current state digest before applying this preview in one transaction.",
  "snapshot.restoreAction": "Restore snapshot",
  "snapshot.snapshotPages": "Snapshot pages",
  "snapshot.restoredLabel": "Restored",
  "snapshot.documentsAdded": "Documents added",
  "snapshot.documentsRemoved": "Documents removed",
  "snapshot.documentsChanged": "Documents changed",
  "snapshot.segmentsAdded": "Segments added",
  "snapshot.segmentsRemoved": "Segments removed",
  "snapshot.segmentsChanged": "Segments changed",
  "snapshot.commentsChanged": "Comments changed",
  "snapshot.reviewsChanged": "Reviews changed",
  "snapshot.discussionsChanged": "Discussions changed",
  "snapshot.mountsAdded": "Mounts added",
  "snapshot.mountsRemoved": "Mounts removed",
  "snapshot.mountsChanged": "Mounts changed",
  "curation.semanticProvider": "Semantic provider",
  "curation.readOnly": "read only",
  "curation.minimumChars": "Minimum chars",
  "curation.minimumRatio": "Minimum ratio %",
  "curation.maximumRatio": "Maximum ratio %",
  "curation.nearDuplicate": "Near duplicate %",
  "curation.semanticScore": "Semantic score bp",
  "curation.quarantineScore": "Quarantine score bp",
  "curation.minimumTermFrequency": "Minimum term frequency",
  "curation.scoreProjection": "Score projection",
  "curation.loadingUnits": "Loading analyzed units",
  "curation.cleanDataset": "Export clean dataset",
  "curation.lastExport": "Last export: {path}",
  "curation.projectOrigin": "Project {id}",
  "curation.globalOrigin": "Global",
  "curation.documentOrigin": " / document {id}",
  "curation.unitOrigin": "Unit {id}",
  "curation.selectFinding": "Select {kind} finding {id}",
  "curation.languageIntelligence": "Language intelligence",
  "curation.agreement": "agreement",
  "curation.relatedUnits": "related units",
  "curation.metricAnalyzed": "Analyzed",
  "curation.metricWithFindings": "With findings",
  "curation.metricFindings": "Findings",
  "curation.metricQuarantine": "Quarantine candidates",
  "curation.metricTerms": "Term candidates",
  "curation.metricDrift": "Drift groups",
  "curation.applyDialogTitle": "Apply curation selection",
  "curation.rollbackDialogTitle": "Rollback curation run",
  "curation.applyDialogBody":
    "Quarantine {count} explicitly selected finding(s) and update the score projection.",
  "curation.rollbackDialogBody":
    "Restore every unit changed by this run from its recorded before image.",
  "curation.applyAction": "Apply selection",
  "curation.rollbackAction": "Rollback run",
  "curation.exportStatus": "Last export: {path}",
  "curation.findingPages": "Curation finding pages",
  "curation.unitPages": "Analyzed unit pages",
  "curation.termUses": "{count} uses",
  "curation.relatedUnitCount": "{count} related unit(s)",
  "curation.scoreNotAvailable": "Not scored",
  "curation.findingExactDuplicate": "Exact duplicate",
  "curation.findingNearDuplicate": "Near duplicate",
  "curation.findingCompetingTranslation": "Competing translation",
  "curation.findingSourceEqualsTarget": "Source equals target",
  "curation.findingMinimumLength": "Minimum length",
  "curation.findingLengthRatio": "Length ratio",
  "curation.findingNumberMismatch": "Number mismatch",
  "curation.findingDateMismatch": "Date mismatch",
  "curation.findingPlaceholderMismatch": "Placeholder mismatch",
  "curation.findingCreatedOutsideRange": "Created outside range",
  "curation.findingLikelyWrongLanguage": "Likely wrong language",
  "curation.findingSemanticMismatch": "Semantic mismatch",
  "curation.severityError": "Error",
  "curation.severityWarning": "Warning",
  "curation.severityInfo": "Info",
  "curation.dispositionKeep": "Keep",
  "curation.dispositionReview": "Review",
  "curation.dispositionQuarantine": "Quarantine",
  "curation.evidenceSource": "Source: {value}",
  "curation.evidenceTarget": "Target: {value}",
  "curation.evidenceRelatedUnit": "Related unit: {value}",
  "curation.noAdditionalEvidence": "No additional evidence",
};

const zhCn: MessageCatalog = {
  "app.name": "Translunar CAT",
  "app.tagline": "本地优先的翻译与资产中枢",
  "action.openProject": "打开项目",
  "action.createProject": "创建项目",
  "action.importDocument": "导入文档",
  "action.export": "导出",
  "action.settings": "设置",
  "action.backup": "备份工作区",
  "action.restore": "恢复工作区",
  "action.checkUpdates": "检查更新",
  "action.skip": "跳过",
  "action.next": "下一步",
  "action.focusControl": "转到高亮控件",
  "action.back": "上一步",
  "action.finish": "完成",
  "action.restartTutorial": "重新开始教程",
  "action.openExample": "打开示例项目",
  "action.chooseDirectory": "选择目录",
  "action.migrateDataDirectory": "迁移数据目录",
  "action.discardDraft": "丢弃",
  "action.restoreDraft": "恢复",
  "action.copyDraft": "复制文本",
  "action.deferUpdate": "稍后提醒",
  "action.installUpdate": "安装更新",
  "action.rollbackUpdate": "恢复更新前备份",
  "action.openInstaller": "打开已下载的安装包",
  "action.confirmRestore": "确认恢复",
  "action.cancelRestore": "取消恢复",
  "action.retry": "重试",
  "status.ready": "就绪",
  "status.loading": "加载中…",
  "status.saving": "保存中…",
  "status.engineReconnecting": "正在重新连接翻译引擎…",
  "status.engineReconnected": "引擎已重连，正在重新加载工作区…",
  "status.busy": "处理中…",
  "status.freeSpace": "剩余 {size}",
  "status.healthy": "健康",
  "status.unhealthy": "需要关注",
  "error.generic": "出现错误。",
  "error.engineUnavailable": "翻译引擎不可用。",
  "error.engineExited": "翻译引擎意外退出。",
  "error.dataDirectoryInvalid": "无法使用该数据目录。",
  "error.dataDirectoryMigrateFailed": "数据目录迁移失败，已回滚到原始工作区。",
  "error.backupFailed": "备份失败。",
  "error.restoreFailed": "恢复失败，当前工作区未被修改。",
  "error.updateFailed": "更新失败。",
  "error.allowlistDenied": "该 AI 配置文件不允许用于此项目（{profileId}）。",
  "error.draftStale": "草稿修订号已过期，不会被静默应用。",
  "error.projectInRecycleBin": "该项目位于回收站中。",
  "error.projectNoDocuments": "该项目没有活动文档。",
  "shellError.canceled": "操作已取消。",
  "shellError.notWritable": "所选位置不可写。",
  "shellError.insufficientSpace": "目标磁盘空间不足。",
  "shellError.existingWorkspace": "所选文件夹已是另一个工作区。",
  "shellError.destinationExists": "目标已存在，不会被覆盖。",
  "shellError.unsafePath": "该路径不安全，无法使用。",
  "shellError.invalidBackup": "该备份无效或不完整。",
  "shellError.incompatibleBackup": "该备份与当前引擎不兼容。",
  "shellError.schemaTooNew": "该备份的架构版本比本应用更新。",
  "shellError.hashMismatch": "备份校验失败：文件哈希不匹配。",
  "shellError.invalidWorkspaceShape": "备份的工作区结构无法识别。",
  "shellError.restoreInProgress": "恢复操作已在进行中。",
  "shellError.confirmationExpired": "确认已过期，请重新预览备份。",
  "shellError.confirmationInvalid": "确认无效，请重新预览备份。",
  "shellError.healthFailed": "已恢复的工作区未通过健康检查。",
  "shellError.stagingIncomplete": "暂存副本不完整。原始工作区保持不变。",
  "shellError.unknown": "该操作无法完成。",
  "settings.title": "产品设置",
  "settings.locale": "界面语言",
  "settings.localeHelp": "立即生效，并在下次启动时保留。",
  "settings.dataDirectory": "数据目录",
  "settings.dataDirectoryHelp":
    "项目、翻译记忆、质检与本地文件保存在此。迁移会先复制并在健康检查通过后原子切换。",
  "settings.currentPath": "当前路径",
  "settings.freeSpace": "可用空间",
  "settings.updates": "应用更新",
  "settings.updateMode": "更新检查",
  "settings.updateMode.automatic": "自动",
  "settings.updateMode.manual": "仅手动",
  "settings.updateMode.disabled": "已禁用",
  "settings.backupHistory": "最近备份",
  "settings.allowlist": "允许的 AI 配置",
  "settings.allowlistHelp":
    "留空表示允许所有已启用的工作区配置；非空则限制交互、批量与流水线 AI。",
  "settings.allowlistEmpty": "全部已启用配置（无限制）",
  "settings.noBackups": "尚未记录备份。",
  "settings.close": "关闭设置",
  "settings.localeName.enUS": "English（英语）",
  "settings.localeName.zhCN": "简体中文",
  "settings.profileDisabled": "（已禁用）",
  "backup.title": "工作区备份",
  "backup.destination": "选择目标文件夹",
  "backup.progress": "正在创建备份…",
  "backup.success": "备份已创建：{path}",
  "backup.reminder": "更新或重大迁移前请先备份数据目录。",
  "backup.historyCount": "{count, plural, one {# 条备份} other {# 条备份}}",
  "restore.title": "恢复工作区",
  "restore.preview": "在切换活动工作区前先验证备份",
  "restore.previewTitle": "恢复预览",
  "restore.confirm": "恢复此备份",
  "restore.success": "工作区已恢复并重新启动引擎。",
  "restore.noClobber": "恢复不会覆盖已存在的目标。",
  "restore.schema": "架构版本 {version}",
  "restore.files": "{count, plural, one {# 个文件} other {# 个文件}}",
  "restore.size": "总大小 {size}",
  "restore.hashStatus": "哈希校验：{status}",
  "restore.compatible": "兼容性：{status}",
  "restore.freeSpace": "可用空间 {size}",
  "restore.sourcePath": "来源 {path}",
  "restore.cancel": "取消",
  "restore.confirmAction": "确认并恢复",
  "update.title": "应用更新",
  "update.checking": "正在检查更新…",
  "update.available": "发现新版本 {version}。",
  "update.upToDate": "当前已是最新版本（{version}）。",
  "update.downloading": "正在下载更新… {percent}%",
  "update.ready": "更新已就绪，可以安装。",
  "update.deferred": "更新已推迟至 {when}。",
  "update.disabled": "已禁用自动更新。",
  "update.failed": "检查更新失败：{detail}",
  "update.unsigned": "开发构建未签名，已跳过签名钩子。",
  "update.preBackup": "安装前正在备份工作区…",
  "update.pendingRestart":
    "已接受更新 {version} 的安装。应用将重启以完成安装。",
  "update.notConfigured": "当前构建未配置更新源。",
  "update.recoveryRequired": "需要更新恢复：{detail}",
  "update.rollbackSucceeded": "已成功恢复更新前的工作区备份。",
  "update.rollbackFailed": "工作区回滚失败：{detail}",
  "update.manualInstallerOpened":
    "已打开下载的安装包以便手动恢复；这不代表更新已经安装。",
  "home.continueTranslating": "继续翻译",
  "home.archivedProjects": "已归档项目",
  "home.newProject": "新建项目",
  "home.projects": "项目",
  "home.search": "搜索",
  "home.templates": "模板",
  "home.recycle": "回收站",
  "home.refresh": "刷新",
  "home.noActiveProjects": "暂无进行中的项目",
  "home.noArchivedProjects": "暂无已归档项目",
  "home.createToBegin": "创建项目并添加源文件以开始。",
  "home.archivedHelp": "已归档项目会保留在此，直至恢复或移入回收站。",
  "home.projectLifecycle": "项目生命周期",
  "home.projectPages": "项目分页",
  "home.workspaceViews": "项目工作区视图",
  "home.localProjects": "本地项目",
  "home.projectCount":
    "{count, plural, one {本视图 # 个项目} other {本视图 # 个项目}}",
  "home.active": "进行中",
  "home.archived": "已归档",
  "home.restoreArchive": "恢复归档",
  "home.projectWorkspace": "项目工作区",
  "home.archiveRestored": "项目归档已以新身份恢复。",
  "home.noActiveDocuments": "该项目没有可打开的活动文档。",
  "home.loadingWorkspaceData": "正在加载工作区数据",
  "home.general": "常规",
  "home.projectProgress": "项目进度",
  "home.unavailable": "不可用",
  "home.completionAria": "{name} 完成度",
  "home.filesCount": "{count, plural, one {# 个文件} other {# 个文件}}",
  "home.segmentsCount": "{count, plural, one {# 个句段} other {# 个句段}}",
  "home.blockersCount": "{count, plural, one {# 个阻断项} other {# 个阻断项}}",
  "home.moreFiles": "另有 {count} 个文件",
  "home.openProject": "打开项目",
  "home.archiveProject": "归档项目",
  "home.restoreProject": "恢复项目",
  "home.archiveNamed": "归档 {name}",
  "home.restoreNamed": "恢复 {name}",
  "home.moveToRecycle": "移入回收站",
  "home.recycleNamed": "将 {name} 移入回收站",
  "home.archiveActionTitle": "归档项目",
  "home.restoreActionTitle": "恢复项目",
  "home.archiveActionDescription":
    "{name} 将从活动项目列表移除，但仍可完整恢复。",
  "home.restoreActionDescription": "{name} 将返回活动项目列表。",
  "home.archiveActionConfirm": "归档",
  "home.restoreActionConfirm": "恢复",
  "home.recycleActionTitle": "将项目移入回收站",
  "home.recycleActionDescription": "{name} 及其文档将从普通项目和搜索中隐藏。",
  "home.recycleActionConfirm": "移入回收站",
  "home.templateRevisionCreated": "模板修订已创建。",
  "home.templateCreated": "模板已创建。",
  "home.deleteTemplateTitle": "删除项目模板",
  "home.deleteTemplateDescription":
    "{name} 的修订 {revision} 及其修订历史将被删除。现有项目不受影响。",
  "home.deleteTemplateConfirm": "删除模板",
  "home.restoreItemTitle": "恢复回收站项目",
  "home.restoreItemDescription": "{name} 将恢复到之前的状态。",
  "home.purgeItemTitle": "永久清除项目",
  "home.purgeItemDescription": "{name} 将被永久删除，无法撤销。",
  "home.purgeItemConfirm": "永久清除",
  "home.workspaceIndex": "工作区索引",
  "home.globalSearch": "全局搜索",
  "home.globalSearchHelp": "在活动项目中搜索原文、译文、名称、批注和导入备注。",
  "home.searchPlaceholder": "搜索工作区",
  "home.globalSearchQuery": "全局搜索查询",
  "home.searchProject": "搜索项目",
  "home.allActiveProjects": "所有活动项目",
  "home.searchField": "搜索字段",
  "home.allFields": "所有字段",
  "home.fieldSource": "原文",
  "home.fieldTarget": "译文",
  "home.fieldProject": "项目名称",
  "home.fieldDocument": "文档名称",
  "home.fieldComment": "批注",
  "home.fieldNote": "导入备注",
  "home.searchWorkflowState": "搜索工作流状态",
  "home.anyWorkflowState": "任意工作流状态",
  "home.workflowTranslation": "翻译",
  "home.workflowReview": "审校",
  "home.workflowSigned": "已签核",
  "home.searchSubmit": "搜索",
  "home.noMatchingContent": "没有匹配的工作区内容",
  "home.searchEveryActive": "搜索所有活动项目",
  "home.tryAnother": "请尝试其他字段、项目或短语。",
  "home.resultsLink": "结果会直接链接到权威文档和句段。",
  "home.resultCount": "{count, plural, one {# 个结果} other {# 个结果}}",
  "home.segmentNumber": "句段 {number}",
  "home.reusableConfiguration": "可复用配置",
  "home.projectTemplates": "项目模板",
  "home.templatesDescription":
    "语言区域、配置、审校策略和安全编辑器默认值。绝不存储凭据。",
  "home.newTemplate": "新建模板",
  "home.builtIn": "内置",
  "home.custom": "自定义",
  "home.revision": "修订 {revision}",
  "home.noDescription": "无描述",
  "home.locales": "语言区域",
  "home.analysis": "分析",
  "home.review": "审校",
  "home.required": "必需",
  "home.optional": "可选",
  "home.updated": "更新于 {value}",
  "home.deleteTemplate": "删除模板",
  "home.deleteTemplateNamed": "删除 {name} 模板",
  "home.safeReusableConfiguration": "安全的可复用配置",
  "home.editProjectTemplate": "编辑项目模板",
  "home.newProjectTemplate": "新建项目模板",
  "home.name": "名称",
  "home.description": "描述",
  "home.sourceLocale": "源语言区域",
  "home.targetLocale": "目标语言区域",
  "home.analysisProfile": "分析配置",
  "home.requireReviewBeforeSignoff": "签核前需要审校",
  "home.engineResolvesPolicy": "创建项目时由引擎解析该策略。",
  "home.localesMustDiffer": "源语言区域和目标语言区域必须不同。",
  "home.saveTemplate": "保存模板",
  "home.recoverableDeletion": "可恢复删除",
  "home.recycleBin": "回收站",
  "home.recycleDescription": "恢复保留的项目和文档，或明确永久清除。",
  "home.recycleEmpty": "回收站为空",
  "home.recycleEmptyHelp": "删除的项目和文档在保留期内仍可在此恢复。",
  "home.deletedAt": "{kind} · 删除于 {value}",
  "home.retainedUntil": "保留至 {value} · {actor}",
  "home.restoreItem": "恢复",
  "home.permanentlyPurge": "永久清除",
  "home.purgeNamed": "清除 {name}",
  "draft.recoveryTitle": "发现未保存草稿",
  "draft.recoveryBody": "崩溃后找到可恢复的编辑器草稿。应用前请逐条确认。",
  "draft.staleWarning": "修订号不匹配 — 仅在审阅后恢复。",
  "draft.count": "{count, plural, one {# 条草稿} other {# 条草稿}}",
  "tutorial.welcomeTitle": "欢迎使用 Translunar",
  "tutorial.welcomeBody":
    "导入文档、确认译文、运行质检，然后导出。翻译记忆与术语库保存在本机。",
  "tutorial.createTitle": "创建或打开项目",
  "tutorial.createBody":
    "在项目主页创建带有源/目标语言的项目，或打开已有项目。",
  "tutorial.importTitle": "导入源文档",
  "tutorial.importBody":
    "通过与日常工作相同的受信任文件对话框导入 DOCX、Office、文本、XLIFF 或 PDF。",
  "tutorial.editTitle": "编辑并确认句段",
  "tutorial.editBody":
    "在工作台起草译文。引擎确认保存后，使用 Ctrl/Cmd+Enter 确认。",
  "tutorial.qaTitle": "运行质量检查",
  "tutorial.qaBody": "打开质检审阅，查看引擎生成的问题，再交付。",
  "tutorial.exportTitle": "导出译文",
  "tutorial.exportBody":
    "通过原始格式路径导出。在质检通过或明确覆盖前，交付会保持拦截。",
  "tutorial.completeTitle": "准备就绪",
  "tutorial.completeBody":
    "可随时从设置打开捆绑示例项目，或直接使用自己的文件开始。",
  "tutorial.progress": "第 {current} / {total} 步",
  "aria.settings": "打开产品设置",
  "aria.closeDialog": "关闭对话框",
  "aria.tutorialOverlay": "首次使用教程",
  "aria.localeSelector": "界面语言",
  "aria.backupHistory": "备份历史",
  "aria.dataDirectoryPath": "当前数据目录路径",
  "empty.noProjects": "还没有项目。创建一个开始吧。",
  "empty.noBackups": "尚无备份历史。",
  "loading.workspace": "正在打开工作区",
  "dialog.selectDataDirectory": "选择数据目录",
  "dialog.selectBackupDestination": "选择备份目标",
  "dialog.selectRestoreSource": "选择要恢复的备份",
  "dialog.selectSource": "导入源文档",
  "dialog.selectSources": "添加源文档",
  "dialog.selectSourceFolder": "添加源文件夹",
  "dialog.selectProjectArchive": "恢复 Translunar 项目",
  "dialog.selectProjectArchiveDestination": "导出 Translunar 项目归档",
  "dialog.selectExport": "导出 Translunar 文件",
  "dialog.selectExportTaskPackage": "导出离线任务包",
  "dialog.selectInteropReview": "打开双语审阅 DOCX",
  "dialog.selectInteropTable": "打开双语对照表",
  "dialog.selectTaskPackageInput": "打开离线任务包",
  "dialog.selectCorpusInput": "导入参考语料",
  "dialog.selectPluginPackage": "选择插件包目录或 .tlplugin 文件",
  "nav.home": "首页",
  "plural.backup": "{count, plural, one {# 条备份} other {# 条备份}}",
  "plural.draft": "{count, plural, one {# 条草稿} other {# 条草稿}}",
  "format.bytes": "大小：{value} {unit}",
  "format.checkedAt": "检查于 {value}",
  "common.refresh": "刷新",
  "common.cancel": "取消",
  "common.close": "关闭",
  "common.save": "保存",
  "common.actor": "操作者",
  "common.reason": "原因",
  "common.workingOn": "正在处理：{task}",
  "common.unknown": "未知",
  "common.documentSegmentPath": "{document} / 句段 {ordinal}",
  "common.previousPage": "上一页",
  "common.nextPage": "下一页",
  "common.status": "状态",
  "common.source": "原文",
  "common.target": "译文",
  "common.active": "活动",
  "common.domain": "领域",
  "common.profile": "配置",
  "common.scope": "范围",
  "common.all": "全部",
  "common.views": "视图",
  "common.moreActions": "更多操作",
  "common.discard": "丢弃",
  "common.confirm": "确认",
  "common.enable": "启用",
  "common.disable": "禁用",
  "common.optional": "可选",
  "common.none": "无",
  "common.loading": "加载中…",
  "common.edit": "编辑",
  "common.delete": "删除",
  "common.install": "安装",
  "common.uninstall": "卸载",
  "common.open": "打开",
  "common.apply": "应用",
  "common.select": "选择",
  "common.kind": "类型",
  "common.locale": "语言区域",
  "common.quality": "质量",
  "common.provenance": "来源信息",
  "common.score": "分数",
  "common.disposition": "处置",
  "common.evidence": "证据",
  "common.diagnostics": "诊断",
  "common.translationMemory": "翻译记忆",
  "common.termbase": "术语库",
  "common.referenceCorpus": "参考语料",
  "common.confirmed": "已确认",
  "common.workflow": "工作流",
  "common.period": "周期",
  "common.edits": "编辑数",
  "common.terms": "术语",
  "common.unit": "单元",
  "common.collection": "集合",
  "common.state": "状态",
  "common.model": "模型",
  "common.reasoning": "推理",
  "common.low": "低",
  "common.medium": "中",
  "common.high": "高",
  "common.send": "发送",
  "common.undo": "撤销",
  "common.redo": "重做",
  "common.comments": "批注",
  "common.issue": "问题",
  "common.suggestions": "建议",
  "common.document": "文档",
  "common.segment": "句段",
  "common.project": "项目",
  "common.threads": "讨论串",
  "common.snapshots": "快照",
  "common.provider": "提供方",
  "common.requests": "请求",
  "common.input": "输入",
  "common.output": "输出",
  "common.elapsed": "耗时",
  "common.failed": "失败",
  "common.skipped": "已跳过",
  "common.current": "当前",
  "common.returned": "返回",
  "common.severity": "严重性",
  "common.rule": "规则",
  "common.recommendation": "建议",
  "common.explanation": "说明",
  "common.policy": "策略",
  "plugins.title": "插件",
  "plugins.lede": "安装本地插件、审查分范围授权，并控制插件贡献项。",
  "plugins.installPackage": "安装插件包…",
  "plugins.loading": "正在加载插件…",
  "plugins.empty": "尚未安装插件。请选择包目录或 .tlplugin 归档。",
  "plugins.permissions": "权限：{list}",
  "plugins.permissionsNone": "无",
  "plugins.connectorProfiles": "{count} 个提供方配置",
  "plugins.connectorVersion": "当前版本",
  "plugins.connectorOperations": "操作",
  "plugins.connectorAuthority": "连接器权限：{state}",
  "plugins.connectorOrigins": "来源：{list}",
  "plugins.connectorOriginNone": "未授予",
  "plugins.connectorNotRequested": "未请求",
  "plugins.connectorPermissionUnknown": "无法读取权限状态",
  "plugins.connectorFailure": "最近一次安全故障：{message}",
  "plugins.compatibility": "兼容性：{state}",
  "plugins.compatibilityReady": "受支持",
  "plugins.compatibilityBlocked": "不受支持",
  "plugins.inventoryAria": "质检与流水线贡献项",
  "plugins.inventoryTitle": "质检与流水线贡献项",
  "plugins.contributionCount": "{count} 个贡献项",
  "plugins.permissionUnknown": "无法读取权限状态",
  "plugins.contributionKind": "类型",
  "plugins.qaRule": "质检规则",
  "plugins.pipelineStep": "流水线步骤",
  "plugins.pluginVersion": "插件版本、层级与状态",
  "plugins.operationAuthority": "操作权限",
  "plugins.contributionVersion": "贡献项版本",
  "plugins.descriptorVersions": "契约版本",
  "plugins.descriptorVersionShort": "描述符 v{version}",
  "plugins.operationVersionShort": "操作 v{version}",
  "plugins.ruleContract": "规则类型与严重性",
  "plugins.configSchemaVersion": "配置架构版本",
  "plugins.artifactContract": "工件契约",
  "plugins.schemaVersions": "架构版本",
  "plugins.configVersionShort": "配置 v{version}",
  "plugins.checkpointVersionShort": "检查点 v{version}",
  "plugins.executionControls": "执行控制",
  "plugins.resumable": "可恢复：{state}",
  "plugins.cancellable": "可取消：{state}",
  "plugins.yes": "是",
  "plugins.no": "否",
  "plugins.pipelineHistoryAria": "流水线运行历史",
  "plugins.pipelineHistoryKicker": "持久执行历史",
  "plugins.pipelineHistoryTitle": "流水线运行历史",
  "plugins.pipelineRunCount": "最近 {count} 次运行",
  "plugins.pipelineHistoryLoading": "正在加载流水线历史…",
  "plugins.pipelineHistoryEmpty": "此项目尚无流水线运行记录。",
  "plugins.pipelineNoPluginSteps": "此次运行未执行插件拥有的步骤。",
  "plugins.activationRevision": "激活修订 {revision}",
  "plugins.activationRevisionLabel": "激活修订",
  "plugins.review": "审查权限",
  "plugins.previewPanel": "预览面板",
  "plugins.panel.loading": "正在加载",
  "plugins.panel.connecting": "正在连接",
  "plugins.panel.ready": "已连接",
  "plugins.panel.error": "错误",
  "plugins.panel.revoked": "已撤销",
  "plugins.panel.connectionFailed": "插件面板无法建立安全连接。",
  "plugins.panel.sessionEnded": "此插件面板会话已结束。",
  "plugins.actions.aria": "插件 AI 操作",
  "plugins.actions.title": "插件操作",
  "plugins.actions.accept": "接受建议",
  "plugins.actions.cancel": "取消操作",
  "plugins.actions.cancelled": "插件操作已取消。",
  "plugins.actions.failure": "插件操作失败。",
  "plugins.workbenchPanels.aria": "插件面板",
  "plugins.workbenchPanels.title": "插件面板",
  "plugins.workbenchPanels.tab": "插件",
  "plugins.workbenchPanels.refresh": "刷新插件面板",
  "plugins.workbenchPanels.loading": "正在加载插件面板…",
  "plugins.workbenchPanels.empty": "没有活动的插件面板。",
  "plugins.workbenchPanels.closedHint": "选择面板标签以打开。",
  "plugins.workbenchPanels.failure": "无法加载面板清单。",
  "plugins.permissionKicker": "明确授权",
  "plugins.reviewTitle": "插件权限审查",
  "plugins.versionChanges": "版本变更",
  "plugins.versionChange": "版本变化",
  "plugins.change.none": "无版本变化",
  "plugins.change.added": "新增请求",
  "plugins.change.expanded": "范围扩大",
  "plugins.change.narrowed": "范围缩小",
  "plugins.change.unchanged": "保持不变",
  "plugins.change.removed": "已移除请求",
  "plugins.reasonPlaceholder": "记录作出此权限决定的原因",
  "plugins.required": "必需",
  "plugins.optional": "可选",
  "plugins.unsupported": "不受支持",
  "plugins.contribution": "贡献项",
  "plugins.allContributions": "全部插件贡献项",
  "plugins.scope": "授予范围",
  "plugins.scopeUnscoped": "无附加范围",
  "plugins.grant": "授予",
  "plugins.deny": "拒绝",
  "plugins.revoke": "撤销",
  "plugins.audit": "权限审计",
  "plugins.auditEmpty": "尚无权限事件记录。",
  "plugins.effect.fileRead": "读取引擎管理的源文件位置。",
  "plugins.effect.fileWrite": "写入引擎管理的输出文件位置。",
  "plugins.effect.networkConnect": "仅连接列出的网络来源。",
  "plugins.effect.assetRead": "读取选定的翻译资产。",
  "plugins.effect.assetWrite": "修改选定的翻译资产。",
  "plugins.effect.projectRead": "读取选定项目的数据。",
  "plugins.effect.projectWrite": "修改选定项目的数据。",
  "plugins.effect.engineConnector": "调用列出的引擎特权操作。",
  "plugins.effect.qaRegister": "注册列出的质量检查贡献项。",
  "plugins.effect.pipelineRegister": "注册列出的流水线步骤。",
  "plugins.effect.aiAction": "注册并运行列出的 AI 操作。",
  "plugins.effect.uiPanel": "向桌面界面添加列出的面板。",
  "plugins.effect.externalConnector": "使用列出的外部连接器操作。",
  "plugins.effect.diagnosticsRead": "读取列出的受限诊断类别。",
  "plugins.effect.unsupported": "当前引擎不支持此可选能力，因此无法授予权限。",
  "export.kicker": "交付门禁",
  "export.title": "导出审阅",
  "export.checking": "正在检查当前译文",
  "export.ready": "可以交付",
  "export.blocked": "发布已拦截",
  "export.heroBody": "每次导出都会在发布前对 {name} 重新运行质检。",
  "export.checkAgain": "重新检查",
  "export.gateClear": "质检门禁已通过",
  "export.blockingErrors":
    "{count, plural, one {# 个阻断错误} other {# 个阻断错误}}",
  "export.countsLine": "{warnings} 警告 · {info} 提示 · {waived} 已豁免",
  "export.awaiting": "等待权威结果",
  "export.segmentsChecked": "已检查句段",
  "export.run": "运行",
  "export.originalFormat": "原始格式",
  "export.blockingFindings": "阻断问题",
  "export.noOpenErrors": "无未解决错误",
  "export.resolveBefore": "交付前请先处理",
  "export.segmentLabel": "句段 {ordinal}",
  "export.nothingBlocks": "没有阻断发布的问题",
  "export.warningsRemain": "警告与已豁免问题仍可在质检报告中查看。",
  "export.publication": "发布",
  "export.publicationBody": "输出会经过校验，且绝不会覆盖已存在的目标。",
  "export.overrideAria": "覆盖质检交付门禁",
  "export.overrideTitle": "覆盖阻断性质检",
  "export.overrideHelp": "该决定会与导出结果一并记录。",
  "export.actorPlaceholder": "责任人",
  "export.reasonPlaceholder": "必须继续交付的原因",
  "export.publishing": "正在发布…",
  "export.exportDocument": "导出文档",
  "export.helpBlocked": "在编辑器中打开每个阻断项，或明确启用有理由的覆盖。",
  "export.success": "已导出 {count} 个已翻译句段到 {name}。",
  "export.checkingTranslation": "正在检查当前译文",
  "export.readyForDelivery": "可以交付",
  "export.publicationBlocked": "发布已阻断",
  "export.qaRunsAgainst": "质检针对当前译文运行",
  "tm.exactKicker": "精确记忆",
  "tm.title": "翻译记忆",
  "tm.exactAria": "精确翻译记忆",
  "tm.activeLookup": "当前原文检索",
  "tm.searchAria": "搜索精确原文",
  "tm.searchExactPlaceholder": "搜索精确原文…",
  "tm.lookupFailed": "精确检索失败",
  "tm.lookingUp": "正在查找精确匹配…",
  "tm.noExactMatch": "无精确匹配",
  "tm.noExactBody": "没有已确认条目具有该精确原文。",
  "tm.concordance": "上下文检索",
  "tm.concordanceQuery": "上下文检索查询",
  "tm.concordanceDirection": "上下文检索方向",
  "tm.noConcordance": "无上下文检索结果。",
  "tm.closeConcordance": "关闭上下文检索",
  "tm.sourceAndTarget": "原文与译文",
  "nav.backToWorkbench": "返回工作台",
  "nav.applicationViews": "应用视图",
  "setup.brand": "Translunar",
  "setup.tagline": "计算机辅助翻译",
  "setup.localWorkspace": "本地工作区",
  "setup.stepsAria": "项目设置步骤",
  "setup.step1": "步骤 01 · 标识",
  "setup.nameWorkspace": "命名双语工作区",
  "setup.projectName": "项目名称",
  "setup.sourceLanguage": "源语言",
  "setup.targetLanguage": "目标语言",
  "setup.locale.enUS": "英语（美国）",
  "setup.locale.enGB": "英语（英国）",
  "setup.locale.zhCN": "中文（简体）",
  "setup.locale.zhTW": "中文（繁体）",
  "setup.locale.ja": "日语",
  "setup.step2": "步骤 02 · 可复用配置",
  "setup.chooseProfile": "选择运行配置",
  "setup.projectTemplate": "项目模板",
  "setup.noTemplate": "无模板 · 内置默认",
  "setup.qaProfile": "质检配置",
  "setup.templateDefault": "模板 / 默认",
  "setup.pipeline": "流水线",
  "setup.templateNone": "模板 / 无",
  "setup.aiProfile": "AI 配置",
  "setup.templateOffline": "模板 / 离线助手",
  "setup.analysisProfile": "分析配置",
  "setup.templateStandard": "模板 / 标准",
  "setup.reviewPolicy": "审校策略",
  "setup.requireReview": "需要审校",
  "setup.allowDirectSignOff": "允许直接签核",
  "setup.step3": "步骤 03 · 源文件审阅",
  "setup.addFiles": "添加文件和文件夹",
  "setup.commitMode": "提交模式",
  "setup.dropFiles": "将文件或文件夹拖放到此处",
  "setup.selectedPathsAria": "已选源路径",
  "setup.removeSource": "移除源文件",
  "setup.removeSourceNamed": "移除 {name}",
  "setup.templateDeps": "模板依赖",
  "setup.importDiagnostics": "导入诊断",
  "setup.languagesMustDiffer": "源语言与目标语言必须不同。",
  "setup.enterName": "请输入项目名称。",
  "setup.addFilesFirst": "导入前请至少添加一个受支持的文件或文件夹。",
  "setup.importedNone": "项目设置未导入任何受支持文件",
  "setup.rollbackEmpty": "回滚空项目设置",
  "setup.emptyRemoved": "空项目已移除。",
  "setup.noFilesImported": "未导入任何文件。{cleanup} 请查看诊断后重试。",
  "setup.stepProject": "项目",
  "setup.stepConfiguration": "配置",
  "setup.stepFiles": "文件",
  "setup.identityDescription":
    "设置项目身份，以及筛选、质检、翻译记忆和分析使用的单一源/目标语言区域对。",
  "setup.configurationDescription":
    "引用由引擎解析。缺失的模板依赖会安全回退，并继续显示在诊断中。",
  "setup.filesDescription":
    "文件夹由引擎递归发现。相对路径、冲突和不支持的文件会逐项报告。",
  "setup.loadingProfiles": "正在加载可复用配置",
  "setup.stepCounter": "步骤 0{step}",
  "setup.revisionOption": "{name} · 修订 {revision}",
  "setup.sourceSelections":
    "{count, plural, one {# 个源选择} other {# 个源选择}}",
  "setup.diagnosticImported": "已导入",
  "setup.cleanupSkipped": "项目已不再处于活动状态，因此跳过清理。",
  "setup.projectRetained": "项目包含已导入文档，因此予以保留。",
  "qa.kicker": "质量系统",
  "qa.title": "质检与审校",
  "qa.controlsAria": "质检控件",
  "qa.mandatoryReview": "强制审校",
  "qa.latestRunAria": "最近质检运行",
  "qa.filtersAria": "问题筛选",
  "qa.findings": "问题列表",
  "qa.findingsAria": "质检问题",
  "qa.noMatch": "没有匹配的问题",
  "qa.changeFilters": "更改筛选条件或重新运行质检。",
  "qa.prevIssuePage": "上一页问题",
  "qa.nextIssuePage": "下一页问题",
  "qa.detailAria": "问题详情",
  "qa.selectFinding": "选择一个问题",
  "qa.evidenceHere": "证据与操作显示在此处。",
  "qa.reviewBandAria": "审校统计与队列",
  "qa.reviewState": "审校状态",
  "qa.translation": "翻译",
  "qa.pendingProposals": "待处理建议",
  "qa.accepted": "已接受",
  "qa.rejected": "已拒绝",
  "qa.reviewedChars": "已审校字符",
  "qa.reviewerQueue": "审校队列",
  "qa.noPendingProposals": "本文档没有待处理的修订建议。",
  "qa.falsePositive": "误报判定",
  "qa.waiveFinding": "豁免此问题",
  "qa.loadingFindings": "正在加载问题",
  "qa.noEvidence": "此规则不需要文本证据。",
  "qa.profileRules": "配置规则",
  "qa.closeEditor": "关闭配置编辑器",
  "qa.customRegex": "自定义正则规则",
  "qa.noCompletedRun": "尚无完成的运行",
  "qa.runToCreate": "运行质检以创建快照",
  "qa.loadingReview": "正在加载审校状态",
  "qa.queueClear": "队列已清空",
  "qa.cloneProfile": "克隆配置",
  "qa.customProfile": "自定义配置",
  "qa.saveProfile": "保存配置",
  "qa.customRule": "自定义规则",
  "qa.customPattern": "匹配到自定义模式",
  "qa.mandatoryEnabled": "已启用强制审校。",
  "qa.directSignOff": "已启用直接签核，需要填写操作者与原因。",
  "qa.settingsTitle": "质检审阅设置",
  "qa.reportSaved": "已将 {format} 报告保存为 {name}。",
  "qa.checkedSegments": "质检已检查 {count} 个句段",
  "qa.removeRule": "移除 {label}",
  "qa.errors": "错误",
  "qa.warnings": "警告",
  "qa.info": "信息",
  "qa.waived": "已豁免",
  "qa.checked": "已检查 {count}",
  "qa.builtIn": "内置",
  "qa.pluginHistoryAria": "插件质检运行溯源",
  "qa.pluginHistoryKicker": "持久规则溯源",
  "qa.pluginHistoryTitle": "插件质检历史",
  "qa.runHistoryCount": "最近 {count} 次运行",
  "qa.pluginHistoryEmpty": "最近的质检运行未执行插件拥有的规则。",
  "qa.executionCounts": "执行 {executions} 次 · 发现 {findings} 项",
  "qa.pluginOwner": "插件所有者",
  "assistant.archive": "归档对话",
  "assistant.archiveNamed": "归档 {title}",
  "assistant.requestedModel": "请求的模型",
  "assistant.localPreview": "本地预览",
  "assistant.localPreviewOffline": "本地预览（离线）",
  "assistant.reasoningLevel": "推理级别",
  "assistant.offlinePreview": "离线预览",
  "assistant.actionsAria": "助手操作",
  "assistant.useInTarget": "用于译文",
  "assistant.noMessages": "暂无消息",
  "assistant.askAria": "询问当前句段",
  "assistant.askPlaceholder": "询问当前句段…",
  "assistant.sendAria": "发送助手消息",
  "assistant.metricsAria": "合成响应指标",
  "assistant.aiMetricsAria": "AI 响应指标",
  "assistant.discardSuggestion": "丢弃建议",
  "assistant.wordDiff": "词级差异",
  "assistant.proposedTarget": "建议译文",
  "assistant.discardProposal": "丢弃建议",
  "assistant.diffAria": "AI 译文差异",
  "assistant.engineConnected": "引擎已连接",
  "assistant.credentialRequired": "需要凭据",
  "assistant.offlineReady": "离线预览已就绪",
  "assistant.startGrounded": "开始有依据的运行",
  "assistant.preparing": "正在准备依据上下文…",
  "assistant.runStatus": "运行状态：{status}。",
  "assistant.noActiveSegment": "没有活动句段。",
  "assistant.chooseProvider": "请先选择已连接的提供方与对话。",
  "assistant.groundingUnavailable": "依据预览不可用。",
  "assistant.aiRunFailed": "AI 运行失败。",
  "assistant.newConversation": "新建对话",
  "assistant.prompt.translate": "翻译此句段",
  "assistant.prompt.improve": "改进此译文",
  "assistant.prompt.formal": "使译文更正式",
  "assistant.prompt.shorten": "缩短译文",
  "assistant.reasoningLine": "推理级别：{level}。",
  "assistant.requestModel": "请求模型：{model}",
  "assistant.inputTokens": "输入 token：{value}",
  "assistant.cacheReadTokens": "缓存读取 token：{value}",
  "assistant.thinkingTokens": "思考 token：{value}",
  "assistant.outputTokens": "输出 token：{value}",
  "assistant.cacheWriteTokens": "缓存写入 token：{value}",
  "assistant.elapsedTime": "耗时",
  "assistant.groundingContext": "依据上下文",
  "assistant.characters": "字符",
  "assistant.sections": "个分段",
  "ai.kicker": "工作区策略",
  "ai.title": "AI 控制",
  "ai.description":
    "凭证存储在操作系统密钥环中。语境、运行、使用记录及译文写入均由引擎管理。",
  "ai.enabled": "启用 AI",
  "ai.interactiveRuns": "交互运行",
  "ai.batchRuns": "批量运行",
  "ai.budgetPlaceholder": "无限制",
  "ai.originsPlaceholder": "留空表示允许已验证的配置来源",
  "ai.viewsAria": "AI 控制视图",
  "ai.connectorCatalog": "连接器目录",
  "ai.chooseConnector": "选择连接器",
  "ai.connectorAvailable": "可用",
  "ai.connectorUnavailable": "不可用",
  "ai.connectorDegraded": "已降级",
  "ai.connectorBuiltin": "内置",
  "ai.connectorPlugin": "插件",
  "ai.connectorSchemaVersion": "配置架构 v{version}",
  "ai.addProvider": "添加提供方",
  "ai.configured": "已配置",
  "ai.providerProfiles": "提供方配置",
  "ai.credentialPlaceholder": "只写凭据",
  "ai.testConnection": "测试连接",
  "ai.editProfile": "编辑配置",
  "ai.deleteCredential": "删除凭据",
  "ai.deleteProfile": "删除配置",
  "ai.profileEnabled": "配置已启用",
  "ai.cancelEdit": "取消编辑",
  "ai.cancelEditAria": "取消配置编辑",
  "ai.noProfiles": "暂无提供方配置",
  "ai.tmFirst": "翻译记忆优先",
  "ai.pretranslate": "预翻译文档",
  "ai.chooseProfile": "选择配置",
  "ai.replaceDrafts": "替换现有草稿",
  "ai.durableQueue": "持久队列",
  "ai.selectedBatchAria": "所选批次",
  "ai.batchItemsAria": "批次条目",
  "ai.noBatchRuns": "暂无批量运行",
  "ai.currentMonth": "本月",
  "ai.authoritativeUsage": "权威用量",
  "ai.refreshUsage": "刷新用量",
  "ai.cacheRead": "缓存读取",
  "ai.thinking": "思考",
  "ai.noUsage": "本月尚无 AI 用量",
  "ai.enterCredential": "请先输入凭据。",
  "ai.credentialSaved": "凭据已保存到操作系统密钥环。",
  "ai.providerTestFailed": "提供方测试失败。",
  "ai.credentialRemoved": "凭据已从操作系统密钥环删除。",
  "ai.budgetInvalid": "每月 token 预算必须为正整数。",
  "ai.policySaved": "AI 工作区策略已保存。",
  "ai.chooseProviderProfile": "请选择提供方配置。",
  "ai.batchStarted": "批量预翻译已开始。",
  "ai.providerCredential": "提供方凭据",
  "ai.providerCredentialDefault": "提供方凭据（默认）",
  "ai.credentialFor": "{name} 的凭据",
  "ai.testNamed": "测试 {name}",
  "ai.editNamed": "编辑 {name}",
  "ai.deleteCredentialFor": "删除 {name} 的凭据",
  "ai.deleteNamed": "删除 {name}",
  "ai.pending": "待处理",
  "ai.testTimeout": "提供方测试未在 30 秒内完成。",
  "interop.modeAria": "互操作模式",
  "interop.tableFormat": "表格格式",
  "interop.package": "包",
  "interop.signedReview": "已签名审阅 DOCX",
  "interop.writableTm": "可写翻译记忆库",
  "interop.noWritableLibrary": "没有匹配的可写库",
  "interop.documentRevision": "文档修订号",
  "interop.applyReason": "应用原因",
  "interop.reviewPreviewAria": "审阅预览",
  "interop.returnedTarget": "返回译文 / 批注",
  "interop.tablePreviewAria": "表格预览",
  "interop.sourceTarget": "原文 / 译文",
  "interop.structuralPath": "结构路径",
  "interop.diagnosticsMeta": "诊断 / 元数据",
  "interop.prevPage": "上一预览页",
  "interop.nextPage": "下一预览页",
  "task.modeAria": "任务包模式",
  "task.auditAria": "任务包审计字段",
  "task.createAssignment": "创建分配任务包",
  "task.assignmentDocs": "分配文档",
  "task.optionalSegmentIds": "可选句段 ID",
  "task.segmentIdsPlaceholder": "留空表示全部句段",
  "task.noActiveDocuments": "没有可用的活动文档。",
  "task.instructions": "给接收方的说明",
  "task.instructionsPlaceholder": "描述请求的交接内容",
  "task.notImported": "此项目不是导入的任务项目。",
  "task.importFirst": "导出回传包前请先导入分配任务包。",
  "task.exportReturn": "导出回传包",
  "task.taskProject": "任务项目",
  "task.originPackage": "来源包",
  "task.originProject": "来源项目",
  "task.returnInstructions": "回传说明",
  "task.returnNotePlaceholder": "给项目所有者的可选备注",
  "task.previewTitle": "预览分配或回传",
  "task.detachedName": "分离项目名称",
  "task.detachedPlaceholder": "包项目名 +（任务）",
  "task.engineClassifications": "引擎分类",
  "task.discardStaged": "丢弃暂存包",
  "task.countsAria": "任务包计数",
  "task.rowsAria": "任务包行",
  "task.noRows": "本页没有返回任何行。",
  "task.detachedReady": "分离任务项目已就绪",
  "task.importDocumentCount":
    "{count, plural, one {# 个文档} other {# 个文档}}",
  "task.importBoundRowCount":
    "{count, plural, one {# 个绑定行} other {# 个绑定行}}",
  "task.optionalSlices": "可选切片",
  "task.tmTermRows": "翻译记忆 / 术语库行",
  "task.noMountedLibrary": "没有已挂载的库",
  "task.explicitRowIds": "显式行 ID",
  "task.removeSlice": "移除资产切片",
  "task.transactionalMerge": "事务性合并",
  "task.applySelected": "应用所选行？",
  "task.workflowTitle": "离线任务包工作流",
  "task.assignmentExported": "分配包 {id} 已导出到 {name}。",
  "task.returnExported": "回传包 {id} 已导出到 {name}。",
  "task.detachedCreated": "已创建分离任务项目，共 {count} 个来源绑定。",
  "task.applied": "已应用 {count} 行；项目修订号现为 {revision}。",
  "task.discarded": "已丢弃暂存的任务包文件。",
  "task.boundedHandoff": "有界交接",
  "task.noDestination": "未选择目标",
  "task.detachedWork": "分离工作",
  "task.trustedReview": "受信任包审阅",
  "task.noPackage": "未选择任务包",
  "task.sourceUnavailable": "原文不可用",
  "task.selectRow": "选择 {disposition} 行 {ordinal}",
  "task.sliceKind": "资产切片 {index} 类型",
  "task.sliceLibrary": "资产切片 {index} 库",
  "task.sliceRowIds": "资产切片 {index} 行 ID",
  "task.removeSliceN": "移除资产切片 {index}",
  "task.remoteChanged": "远端已更改",
  "task.localChanged": "本地已更改",
  "task.bothChanged": "双方均已更改",
  "task.tagInvalid": "标签无效",
  "task.missingDependency": "缺少依赖",
  "task.applyCount": "应用已选择的 {count} 行",
  "task.applyMerge": "应用合并",
  "task.applyDialogBody":
    "引擎会校验预览修订，并在单个事务中应用 {count} 个安全行。冲突行保持不变。",
  "task.rowNumber": "第 {ordinal} 行",
  "insights.kicker": "项目操作",
  "insights.title": "项目洞察",
  "insights.refresh": "刷新项目洞察",
  "insights.panelAria": "项目洞察面板",
  "insights.progressAria": "项目进度",
  "insights.progressTitle": "项目进度",
  "insights.completionAria": "项目完成度",
  "insights.productivity": "生产力",
  "insights.aiContribution": "AI 贡献",
  "insights.assetHealth": "资产健康度",
  "insights.trends": "运营趋势",
  "insights.qaRuns": "质检运行",
  "insights.tmUnits": "翻译记忆单元",
  "insights.dropFiles": "拖放文件或文件夹以添加",
  "insights.recycleDocument": "回收文档",
  "insights.reconciliation": "对账计划",
  "insights.reimportCounts": "重新导入计数",
  "insights.portable": "可移植项目",
  "insights.exportArchive": "导出归档",
  "insights.recoverable": "可恢复删除",
  "insights.recycleProject": "回收项目",
  "insights.history": "项目历史",
  "insights.analysis": "项目分析",
  "insights.matchBands": "匹配区间",
  "insights.explicitAction": "显式操作",
  "insights.discussionsTab": "讨论 / 快照",
  "insights.alignmentTab": "对齐 / 语料",
  "insights.taskTab": "任务包",
  "insights.batchFinished": "批次完成：成功 {succeeded}，失败 {failed}。",
  "insights.removedFromFiles": "已从项目文件移除",
  "insights.removedFromInsights": "已从项目洞察移除",
  "insights.applyReimport": "应用重新导入",
  "insights.applyPreview": "应用预览",
  "insights.archiveExported": "归档已导出到 {name}。",
  "insights.analysisStale": "分析已完成，但相对当前项目修订已过期。",
  "insights.analysisDone": "分析快照已完成。",
  "insights.analyticsUnavailable": "项目分析不可用。",
  "insights.qaBlockers": "质检阻断项",
  "insights.activeEditing": "活跃编辑",
  "insights.confirmedPerHour": "每小时确认数",
  "insights.activityEvents": "活动事件",
  "insights.idleThreshold": "空闲阈值",
  "insights.appliedSegments": "已应用句段",
  "insights.retainedSegments": "保留句段",
  "insights.replacedSegments": "已替换句段",
  "insights.retainedChars": "保留字符",
  "insights.aiHistoryUnavailable": "AI 历史不可用。",
  "insights.termEntries": "术语条目",
  "insights.openBlockers": "未解决阻断",
  "insights.mountedHits": "挂载命中",
  "insights.curationOutcomes": "策展结果",
  "insights.recentBuckets": "最近分桶",
  "insights.noTrendBuckets": "没有可用的趋势分桶。",
  "insights.activeSourceSet": "活动源集",
  "insights.recycleNamed": "回收 {name}",
  "insights.lastBatch": "上一批次",
  "insights.revisionReconciliation": "修订对账",
  "insights.currentRevision": "当前修订",
  "insights.currentVersion": "当前版本",
  "insights.sourceHash": "原文哈希",
  "insights.noReplacement": "未选择替换项",
  "insights.previewId": "预览 {id}",
  "insights.oldOrdinal": "旧 {ordinal}",
  "insights.newOrdinal": "新 {ordinal}",
  "insights.noOperations": "没有可用的项目操作。",
  "insights.engineSnapshot": "引擎快照",
  "insights.staleAnalysis": "过期分析快照",
  "insights.analysisSnapshot": "分析快照",
  "insights.sourceWords": "原文词数",
  "insights.sourceChars": "原文字符",
  "insights.sourceCjk": "原文 CJK",
  "insights.targetWords": "译文词数",
  "insights.targetChars": "译文字符",
  "insights.targetCjk": "译文 CJK",
  "insights.weightedEffort": "加权工作量",
  "insights.editDistance": "编辑距离",
  "insights.noAnalysis": "此视图尚未运行分析快照。",
  "curation.reviewAssets": "审阅翻译资产",
  "curation.applied": "已应用策展：隔离 {count} 个单元。",
  "curation.rollbackRestored": "回滚已恢复 {count} 个单元。",
  "curation.exported": "已导出 {count} 个活动单元为 {format}。",
  "curation.refreshed": "已从引擎刷新策展状态。",
  "curation.catalog": "资产目录",
  "curation.unifiedCatalog": "统一资产目录",
  "curation.refreshState": "刷新策展状态",
  "curation.catalogScope": "目录范围",
  "curation.allAssets": "全部资产",
  "curation.anyDomain": "任意领域",
  "curation.queryPlaceholder": "原文或译文",
  "curation.query": "查询",
  "curation.noCatalogRows": "无目录行",
  "curation.analyzeLibrary": "分析一个翻译记忆库",
  "curation.selectTm": "选择翻译记忆库",
  "curation.offlineChecks": "离线确定性检查",
  "curation.thresholds": "确定性阈值",
  "curation.thresholdsHelp": "所有值都会与本次运行一并发送到引擎。",
  "curation.reviewChanges": "审阅并选择更改",
  "curation.noFindingsPage": "本页无问题",
  "curation.analyzedUnits": "已分析单元",
  "curation.applyRollbackExport": "应用、回滚与导出",
  "curation.selectedFindings": "已选问题",
  "curation.allActive": "全部活动",
  "curation.noRun": "尚无策展运行",
  "curation.catalogRowsAria": "资产目录行",
  "curation.findingsAria": "策展问题",
  "curation.unitsAria": "已分析策展单元",
  "curation.termsDrift": "术语与漂移",
  "curation.termCandidates": "术语候选",
  "curation.noCandidates": "没有有界候选。",
  "curation.driftGroups": "漂移组",
  "curation.revisionSafe": "修订安全变更",
  "curation.assetKind": "资产类型",
  "curation.sourceLocale": "源语言区域",
  "curation.targetLocale": "目标语言区域",
  "curation.originProject": "来源项目 ID",
  "curation.originDocument": "来源文档 ID",
  "curation.createdAfter": "创建时间晚于",
  "curation.createdBefore": "创建时间早于",
  "curation.loadingCatalog": "正在加载资产目录",
  "alignment.modeAria": "对齐与语料模式",
  "alignment.revisionBound": "修订绑定工作区",
  "alignment.documentAlignment": "文档对齐",
  "alignment.refresh": "刷新对齐工作区",
  "alignment.sourceDocument": "源文档",
  "alignment.twoDocsRequired": "需要两个活动文档",
  "alignment.targetDocument": "目标文档",
  "alignment.auditReason": "审计原因",
  "alignment.session": "对齐会话",
  "alignment.noSessions": "尚无会话",
  "alignment.noSession": "无对齐会话",
  "alignment.selectTwoDocs": "选择两个活动文档以创建首个会话。",
  "alignment.linkTitle": "链接所选仅原文与仅译文组",
  "alignment.mergeTitle": "合并连续候选范围",
  "alignment.unlinkTitle": "将一个双语候选拆为未对齐两侧",
  "alignment.splitTitle": "按句段顺序拆分分组候选",
  "alignment.aiProfile": "AI 精炼配置",
  "alignment.noCredentialProfile": "没有已启用的带凭据配置",
  "alignment.writableTm": "可写翻译记忆",
  "alignment.noLocaleTm": "没有语言匹配的可写翻译记忆",
  "alignment.bilingualName": "双语语料名称",
  "alignment.corpusPlaceholder": "已确认对齐语料",
  "alignment.candidatesAria": "对齐候选",
  "alignment.manualLink": "手动双语链接",
  "corpus.projectOwned": "项目自有检索",
  "corpus.importTitle": "导入参考语料",
  "corpus.refresh": "刷新参考语料",
  "corpus.kind": "语料类型",
  "corpus.monoSource": "单语原文",
  "corpus.monoTarget": "单语译文",
  "corpus.bilingual": "双语",
  "corpus.name": "语料名称",
  "corpus.namePlaceholder": "产品文档 2026",
  "corpus.sourceLocale": "源语言区域",
  "corpus.targetLocale": "目标语言区域",
  "corpus.mounted": "已挂载资产",
  "corpus.removed": "已移除",
  "corpus.authoritative": "权威排序",
  "corpus.searchTitle": "搜索语料",
  "corpus.query": "查询",
  "corpus.queryPlaceholder": "搜索原文或译文表达",
  "corpus.side": "侧",
  "corpus.sourceAndTarget": "原文与译文",
  "corpus.allActive": "全部活动语料",
  "corpus.noSearchYet": "尚未运行语料搜索。",
  "corpus.reference": "参考语料",
  "corpus.closeRemove": "关闭移除语料确认",
  "discussion.modeAria": "讨论与快照工作流",
  "discussion.start": "开始讨论",
  "discussion.scopeAria": "讨论范围",
  "discussion.titleOptional": "标题（可选）",
  "discussion.titlePlaceholder": "审校问题",
  "discussion.firstMessage": "首条消息",
  "discussion.messagePlaceholder": "撰写本地备注，必要时使用字面 @提及。",
  "discussion.threadsAria": "讨论串",
  "discussion.refresh": "刷新讨论",
  "discussion.includeResolved": "包含已解决",
  "discussion.noMatching": "没有匹配的讨论",
  "discussion.startOne": "为所选范围开始一个讨论。",
  "discussion.selectedAria": "所选讨论",
  "discussion.editMessage": "编辑消息",
  "discussion.mentionsAria": "字面提及",
  "discussion.noMessagesPage": "本页无消息",
  "discussion.reply": "回复",
  "discussion.selectOne": "选择一个讨论",
  "discussion.messagesHere": "消息与修订绑定操作显示在此处。",
  "discussion.tombstone": "持久墓碑",
  "snapshot.createNamed": "创建命名快照",
  "snapshot.name": "快照名称",
  "snapshot.namePlaceholder": "法务审阅前",
  "snapshot.listAria": "项目快照",
  "snapshot.refresh": "刷新项目快照",
  "snapshot.none": "暂无项目快照",
  "snapshot.createCheckpoint": "为此项目创建命名检查点。",
  "snapshot.selectedAria": "所选项目快照",
  "snapshot.previewAria": "恢复预览",
  "snapshot.workspaceChanges": "工作区变更",
  "snapshot.missingDeps": "缺少已挂载依赖",
  "snapshot.runPreviewFirst": "恢复此快照前请先运行预览。",
  "snapshot.selectOne": "选择一个快照",
  "snapshot.metaHere": "元数据与恢复预览显示在此处。",
  "snapshot.atomicRestore": "原子恢复",
  "workbench.activeDocument": "活动文档",
  "workbench.searchPlaceholder": "在文档中搜索",
  "workbench.searchAria": "在文档中搜索",
  "workbench.segmentFilters": "句段筛选",
  "workbench.additionalFilters": "附加句段筛选",
  "workbench.tagged": "带标签",
  "workbench.commented": "带批注",
  "workbench.exactTmMatching": "精确翻译记忆匹配",
  "workbench.exactTm": "精确记忆",
  "workbench.editorCommands": "编辑器命令",
  "workbench.commandPalette": "命令面板",
  "workbench.openCommandPalette": "打开命令面板",
  "workbench.findReplace": "查找与替换",
  "workbench.openFindReplace": "打开查找与替换",
  "workbench.undoAria": "撤销编辑器操作",
  "workbench.redoAria": "重做编辑器操作",
  "workbench.openComments": "打开句段批注",
  "workbench.issueNav": "问题导航",
  "workbench.prevIssue": "上一问题",
  "workbench.nextIssue": "下一问题",
  "workbench.segmentsAria": "翻译句段",
  "workbench.segmentTools": "活动句段工具",
  "workbench.copyTags": "复制受保护标签",
  "workbench.insertTag": "插入受保护标签",
  "workbench.insertTagPair": "插入受保护标签对",
  "workbench.splitSegment": "拆分句段",
  "workbench.mergeNext": "与下一句段合并",
  "workbench.correctSource": "更正原文",
  "workbench.openChinese": "打开中文转换",
  "workbench.openCommentsShort": "打开批注",
  "workbench.openReview": "打开审校面板",
  "workbench.targetTags": "译文受保护标签",
  "workbench.moveTagHint": "选中后使用“移动标签到光标”",
  "workbench.untranslated": "未翻译",
  "workbench.tab": "Tab",
  "workbench.addDictionary": "添加到用户词典",
  "workbench.noSegmentsMatch": "没有匹配此视图的句段。",
  "workbench.loadingMatches": "正在检查精确翻译记忆匹配…",
  "workbench.loadingTerms": "正在检查术语…",
  "workbench.loadingAssistant": "正在等待助手的首个响应…",
  "workbench.loadingPdfPage": "正在渲染 PDF 页面…",
  "workbench.noTmMatchState": "此句段没有精确翻译记忆匹配。",
  "workbench.noTermHitState": "此句段没有术语命中。",
  "workbench.noOpenQaState": "没有未解决的质检问题。",
  "workbench.noAssistantConversation": "尚无助手对话。",
  "workbench.noGridMatches": "没有句段匹配这些筛选条件。",
  "workbench.clearGridFilters": "清除筛选",
  "workbench.noPdfPage": "没有可用的 PDF 页面。",
  "workbench.noPdfBlocks": "本页没有提取块。",
  "workbench.commandPaletteAria": "命令面板对话框",
  "workbench.typeCommand": "输入命令",
  "workbench.filterCommands": "筛选命令",
  "workbench.closeCommandPalette": "关闭命令面板",
  "workbench.preferencesAria": "编辑器偏好",
  "workbench.workspacePreferences": "工作区偏好",
  "workbench.editorShortcuts": "编辑器与快捷键",
  "workbench.closePreferences": "关闭编辑器偏好",
  "workbench.themeSystem": "跟随系统",
  "workbench.themeLight": "浅色",
  "workbench.themeDark": "深色",
  "workbench.shortcutPresets": "快捷键预设",
  "workbench.auditedSource": "已审计原文编辑",
  "workbench.chineseDicts": "内嵌 OpenCC 词典",
  "workbench.simplifiedTraditional": "简体 / 繁体中文",
  "workbench.projectTransform": "项目转换",
  "workbench.noComments": "此句段暂无批注。",
  "workbench.reviewBypass": "审校旁路",
  "workbench.signOffDirectly": "直接签核",
  "workbench.localReview": "本地审校工作流",
  "workbench.reviewRevisions": "审校修订",
  "workbench.sourceRevision": "原文修订",
  "workbench.targetRevision": "译文修订",
  "workbench.documentPreview": "文档预览",
  "workbench.followActive": "跟随活动",
  "workbench.previewStructure": "文档流",
  "workbench.previewStructureRail": "文档结构",
  "workbench.previewStructureAvailable": "引擎结构路径",
  "workbench.previewStructureLimited": "有序句段",
  "workbench.previewStructureNote": "当前显示引擎顺序；此格式不提供页面布局。",
  "workbench.noExtractedBlocks": "本页没有提取的块。",
  "workbench.projectTm": "项目翻译记忆",
  "workbench.preferredTarget": "首选译文",
  "workbench.closeSourceCorrection": "关闭原文更正",
  "workbench.correctedSource": "更正后的原文",
  "workbench.sourceCorrectionReason": "原文更正原因",
  "workbench.chineseConversion": "中文转换",
  "workbench.closeChinese": "关闭中文转换",
  "workbench.chineseProfile": "中文转换配置",
  "workbench.closeFindReplace": "关闭查找与替换",
  "workbench.segmentComments": "句段批注",
  "workbench.closeComments": "关闭批注",
  "workbench.editedComment": "已编辑批注文本",
  "workbench.addDurableComment": "添加持久批注",
  "workbench.newComment": "新批注",
  "workbench.addComment": "添加批注",
  "workbench.closeReview": "关闭审校面板",
  "workbench.workflowState": "句段工作流状态",
  "workbench.proposedSource": "建议原文修订",
  "workbench.proposedTarget": "建议译文修订",
  "workbench.createReview": "创建审校建议",
  "workbench.resizePreview": "调整文档预览大小",
  "workbench.followActiveSegment": "跟随活动句段",
  "workbench.pdfPage": "PDF 页",
  "workbench.extractedBlocks": "提取的 PDF 块",
  "workbench.correctOcr": "更正 OCR 原文",
  "workbench.ocrReason": "OCR 更正原因",
  "workbench.reasonForCorrection": "更正原因",
  "workbench.collapseSuggestions": "折叠建议",
  "workbench.openSuggestions": "打开建议",
  "workbench.targetSegment": "目标句段 {ordinal}",
  "workbench.exportedSegments": "已导出 {count} 个已翻译句段到 {name}。",
  "plugins.disable": "禁用",
  "plugins.uninstall": "卸载",
  "plugins.bundledTitle": "随附核心插件",
  "plugins.bundledLede":
    "由 Engine 管理的离线发行随附包。渲染层不会接触资源路径。",
  "plugins.bundledUnavailable":
    "随附目录不可用。本地安装与已安装插件仍可正常使用。",
  "plugins.bundledEmpty": "没有列出的随附包。",
  "plugins.bundledInstall": "安装",
  "plugins.bundledUpdate": "更新",
  "plugins.bundledCurrent": "已是最新",
  "plugins.bundledState.available": "可安装",
  "plugins.bundledState.installed": "已安装",
  "plugins.bundledState.updateAvailable": "有更新",
  "plugins.bundledState.current": "当前版本",
  "plugins.installedTitle": "已安装插件",
  "plugins.upgrade": "升级…",
  "plugins.versionHistory": "版本",
  "plugins.versionHistoryTitle": "版本 — {name}",
  "plugins.versionActive": "当前",
  "plugins.rollback": "回滚",
  "plugins.inspectTitle": "检查插件包",
  "plugins.inspectId": "插件 ID",
  "plugins.inspectVersion": "版本",
  "plugins.inspectTier": "层级",
  "plugins.inspectSource": "来源",
  "plugins.inspectHash": "包哈希",
  "plugins.inspectLicense": "发行方 / 许可证",
  "plugins.inspectLicenseNone": "未声明",
  "plugins.inspectCompatibility": "兼容性",
  "plugins.inspectContributions": "贡献数",
  "plugins.inspectConfirmInstall": "安装此包",
  "plugins.inspectConfirmUpgrade": "升级此包",
  "plugins.inspectIdMismatch":
    "升级包 ID {actual} 与已安装插件 {expected} 不一致。",
  "plugins.source.localDirectory": "本地目录",
  "plugins.source.localArchive": "本地归档",
  "plugins.source.bundled": "随附",
  "plugins.crashCount": "崩溃次数：{count}",
  "export.checkAgainInline": "重新检查",
  "export.warningsRemainInline": "警告与已豁免问题仍可在质检报告中查看。",
  "export.publicationBodyInline": "输出会经过校验，且绝不会覆盖已存在的目标。",
  "export.overrideHelpInline": "该决定会与导出结果一并记录。",
  "export.helpBlockedInline":
    "在编辑器中打开每个阻断项，或明确启用有理由的覆盖。",
  "ai.defaultProfile": "默认配置",
  "ai.monthlyBudget": "每月 token 预算",
  "ai.allowedOrigins": "允许的来源",
  "ai.connector": "连接器",
  "ai.profileName": "配置名称",
  "ai.baseUrl": "基础 URL",
  "ai.timeoutMs": "超时（毫秒）",
  "ai.tmThreshold": "翻译记忆阈值",
  "ai.concurrency": "并发",
  "ai.requestsPerMinute": "每分钟请求数",
  "alignment.noCandidatesPage": "本页无候选。",
  "alignment.noCorporaMatch": "没有匹配此状态筛选的语料。",
  "alignment.noCorpusEntry": "没有匹配此查询与范围的语料条目。",
  "alignment.reloadState": "重新加载权威状态",
  "alignment.createdCandidates":
    "已在 {units} 个工作单元中创建 {links} 个候选。",
  "alignment.appliedTm":
    "已应用 {inserted} 个翻译记忆单元；保留 {duplicates} 个已有单元。",
  "curation.staleRevisions": "引擎修订已变更。重试变更前请先刷新。",
  "curation.reloadState": "重新加载权威状态",
  "curation.selectAndAnalyze": "选择一个库并分析，以查看分数与问题。",
  "curation.noCompeting": "没有竞争译文。",
  "assistant.newConversationInline": "新建对话",
  "assistant.openAiProfile": "OpenAI 兼容配置",
  "assistant.applied": "已应用",
  "discussion.discussions": "讨论",
  "discussion.projectSnapshots": "项目快照",
  "discussion.tombstoneBody":
    "消息正文将被可审计的墓碑替换。其序号仍保留在讨论串中。",
  "snapshot.revisionBoundPreview": "修订绑定预览",
  "snapshot.created": "快照 {name} 已创建。",
  "interop.selectAndPreview": "选择输入并预览以检查权威行。",
  "interop.appliedReview": "已应用 {count} 条审阅行。",
  "interop.reviewImportReason": "互操作审阅导入",
  "interop.tableImportReason": "双语对照表导入",
  "interop.reviewPreviewEmpty": "审阅包预览",
  "interop.tablePreviewEmpty": "双语对照表预览",
  "insights.previewReconciliation": "预览对账",
  "insights.restoreFromHome": "项目恢复与清除仍可从项目主页操作。",
  "qa.documentScope": "文档",
  "qa.projectScope": "项目",
  "qa.editProfile": "编辑配置",
  "qa.resetFilters": "重置筛选",
  "qa.openSegment": "打开句段",
  "qa.revokeWaiver": "撤销豁免",
  "qa.waiveFindingBtn": "豁免问题",
  "qa.recordWaiver": "记录豁免",
  "qa.maxTargetChars": "最大译文字符数",
  "qa.builtinImmutable": "内置配置不可变。保存会创建可编辑的项目自有克隆。",
  "qa.addRule": "添加规则",
  "qa.pattern": "模式",
  "qa.message": "消息",
  "qa.replacementHint": "替换提示",
  "setup.templateRequired": "模板 / 必需默认",
  "setup.bestEffort": "尽力而为 · 保留有效文件",
  "setup.allOrNothing": "全部或无 · 原子批次",
  "setup.pathsSanitized":
    "路径在受信任预加载中清理；渲染进程从不读取文件内容。",
  "setup.sqlitePrivate": "SQLite 工作区 · 本地文件 · 默认私有",
  "task.exportImmutable": "导出不可变源，以及你明确选择的行与资产。",
  "task.everySliceRequires":
    "每个新增资产切片都需要已挂载库和至少一个显式行 ID。",
  "task.engineChangedOnly": "引擎只会包含绑定到来源分配的已变更行。",
  "task.noAssetRows": "未选择资产行。分配导出将不包含共享库数据。",
  "nav.workbench": "工作台",
  "nav.qaReview": "质检审阅",
  "nav.exportReview": "导出审阅",
  "nav.translationMemory": "翻译记忆",
  "nav.aiControl": "AI 控制",
  "nav.projectInsights": "项目洞察",
  "nav.projects": "项目",
  "workbench.confirm": "确认",
  "workbench.default": "默认",
  "workbench.saveShortcuts": "保存快捷键",
  "workbench.insertTarget": "插入译文",
  "workbench.applyCorrection": "应用更正",
  "workbench.conversionProfile": "转换配置",
  "workbench.applyConversion": "应用转换",
  "workbench.replaceWith": "替换为",
  "workbench.regularExpression": "正则表达式",
  "workbench.caseSensitive": "区分大小写",
  "workbench.wholeWord": "全词匹配",
  "tm.lookingUpDots": "正在查找精确匹配…",
  "assistant.askPlaceholderDots": "询问当前句段…",
  "workbench.preview": "预览",
  "workbench.applyUnchanged": "应用未变更预览",
  "workbench.editComment": "编辑批注",
  "workbench.saveEdit": "保存编辑",
  "workbench.mandatoryDisabled":
    "此项目已禁用强制审校。该显式决定会写入持久历史。",
  "workbench.signOff": "签核",
  "workbench.noReviewProposals": "此句段没有审校建议。",
  "workbench.proposeTags": "建议使用从原文复制的受保护标签",
  "workbench.correctOcrBtn": "更正 OCR",
  "discussion.tombstoneBody2":
    "消息正文将被可审计的墓碑替换。其序号仍保留在讨论串中。",
  "setup.cleanupFailed": "空项目清理失败：{detail}",
  "insights.archiveExportedDiag": "归档已导出。{detail}",
  "discussion.tombstoneBody3":
    "消息正文将被可审计的墓碑替换。其序号仍保留在讨论串历史中。",
  "ai.profileCreated": "{name} 配置已创建。",
  "ai.connectionSucceeded": "{name} 连接成功。",
  "ai.profileRemoved": "已删除 {name}。",
  "ai.profileUpdated": "{name} 配置已更新。",
  "ai.savePolicy": "保存策略",
  "ai.providersTab": "提供方",
  "ai.batchTab": "批量",
  "ai.usageTab": "用量",
  "ai.startBatch": "开始批量",
  "ai.resume": "继续",
  "ai.store": "存储",
  "ai.credentialStored": "已存储",
  "ai.credentialMissing": "缺失",
  "discussion.createdWithMessage": "讨论已创建并包含首条消息。",
  "discussion.replyAdded": "已添加回复。",
  "discussion.messageUpdated": "消息 {ordinal} 已更新。",
  "discussion.messageTombstoned": "消息 {ordinal} 已删除为墓碑。",
  "discussion.resolved": "讨论已解决。",
  "discussion.reopened": "讨论已重新打开。",
  "discussion.loadingThreads": "正在加载讨论串",
  "discussion.loadingMessages": "正在加载消息",
  "snapshot.loading": "正在加载快照",
  "snapshot.previewReady": "恢复预览已就绪。",
  "snapshot.previewNeedsDeps": "预览已就绪，但必须先恢复依赖项才能应用。",
  "snapshot.restored": "快照已恢复。",
  "snapshot.restoredWithOp": "快照已在操作 {id} 中恢复。",
  "snapshot.createdBy": "由 {actor} 创建",
  "snapshot.checkpointCount": "{count} 个不可变检查点",
  "interop.reviewExported": "审阅 DOCX 已导出，共 {count} 行。",
  "interop.reviewPreviewReady": "审阅预览就绪：{count} 行。",
  "interop.tablePreviewReady": "表格预览就绪：{count} 行。",
  "interop.tableImported": "已将 {count} 行导入翻译记忆。",
  "interop.reviewDocxTab": "审阅 DOCX",
  "interop.tableToTmTab": "表格到翻译记忆",
  "interop.preview": "预览",
  "interop.exportDestination": "审阅导出目标",
  "interop.inputRow": "输入行 {row}",
  "interop.applyCount": "应用 {count}",
  "interop.reviewRowCount": "{count} 条审阅行",
  "interop.tableRowCount": "{count} 条表格行",
  "interop.selectReviewInput": "选择审阅 DOCX",
  "interop.selectTableInput": "选择表格",
  "interop.noInputSelected": "未选择输入",
  "interop.applied": "已应用",
  "interop.selectReviewRow": "选择审阅行 {row}",
  "interop.selectTableRow": "选择表格行 {row}",
  "interop.row": "行 {row}",
  "interop.noStatus": "无状态",
  "interop.currentTarget": "当前：{value}",
  "interop.noTarget": "无译文",
  "interop.comment": "批注：{value}",
  "interop.noComment": "无批注",
  "interop.emptySource": "（原文为空）",
  "interop.unchangedTarget": "（译文未变更）",
  "interop.missingSource": "（缺少原文）",
  "interop.missingTarget": "（缺少译文）",
  "alignment.correctionSaved": "{command} 更正已保存，会话修订为 {revision}。",
  "alignment.candidateMarked": "候选 {ordinal} 已标记为 {status}。",
  "alignment.refinementCanceled": "对齐精炼已取消，链接未更改。",
  "alignment.aiSuggestionsReady": "AI 建议已作为提议对齐链接就绪。",
  "alignment.corpusCreated": "已创建 {name}，含 {count} 条双语条目。",
  "alignment.corpusImported":
    "已导入 {name}：{entries} 条条目，{diagnostics} 条诊断。",
  "alignment.corpusReindexed": "已在修订 {revision} 重建 {name} 索引。",
  "alignment.corpusRemoved": "{name} 已从检索中移除；其托管源文件仍可恢复。",
  "alignment.createSession": "创建会话",
  "alignment.tabAlignment": "对齐",
  "alignment.tabCorpora": "参考语料",
  "alignment.link": "链接",
  "alignment.merge": "合并",
  "alignment.unlink": "取消链接",
  "alignment.split": "拆分",
  "alignment.createCorpus": "创建语料",
  "alignment.reject": "拒绝",
  "alignment.selectFile": "选择文件",
  "alignment.importCorpus": "导入语料",
  "alignment.reindex": "重建索引",
  "curation.runCompleted": "{mode} 策展运行已完成，共 {count} 个单元。",
  "curation.modeProvider": "提供方",
  "curation.modeOffline": "离线",
  "curation.baseLibraryRevision": "基础库修订 {revision}",
  "curation.runRevisionLabel": "运行修订 {revision}",
  "curation.global": "全局",
  "curation.applyFilters": "应用筛选",
  "curation.reset": "重置",
  "curation.refreshRevisions": "刷新修订",
  "curation.selectVisible": "选择可见项",
  "curation.clear": "清除",
  "curation.applySelected": "应用所选",
  "curation.rollbackRun": "回滚运行",
  "curation.noCatalogMatch": "没有资产匹配当前范围与筛选条件。",
  "curation.catalogPages": "资产目录分页",
  "curation.runKicker": "策展运行",
  "curation.libraryRevision": "库修订 {revision}",
  "curation.noLibrarySelected": "未选择库",
  "curation.tmLibrary": "翻译记忆库",
  "curation.analyzeAction": "分析库",
  "curation.rolledBack": "已回滚",
  "curation.providerRefinement": "提供方优化",
  "curation.offlineAnalysis": "离线分析",
  "curation.actor": "操作者 {actor}",
  "curation.findingsKicker": "可解释问题",
  "curation.selectedCount": "已选择 {count} 项",
  "curation.loadingFindings": "正在加载策展问题",
  "curation.noFindingsDetail": "本次运行在当前页没有发现问题。",
  "curation.actionsKicker": "修订安全操作",
  "curation.quarantineSelected": "已跨页选择 {count} 个隔离候选。",
  "curation.exportFormat": "导出格式",
  "curation.minimumScore": "最低分数（bp）",
  "curation.applySelection": "应用选择",
  "insights.movedToRecycle": "{name} 已移入回收站。",
  "insights.reimportPreviewReady": "重新导入预览已就绪。",
  "insights.reimported": "{name} 已重新导入。",
  "insights.tabOverview": "概览",
  "insights.tabFiles": "文件",
  "insights.tabReimport": "重新导入",
  "insights.tabAssets": "资产",
  "insights.tabPlugins": "插件",
  "insights.tabInterop": "互操作",
  "insights.tabArchive": "归档",
  "insights.tabAnalysis": "分析",
  "insights.loading": "正在加载项目数据",
  "insights.addFiles": "添加文件",
  "insights.addFolder": "添加文件夹",
  "insights.selectReplacement": "选择替换文件",
  "insights.exportTlcat": "导出 .tlcat",
  "insights.recycleDocumentDescription":
    "{name} 将离开活动项目，并可从项目主页恢复。",
  "insights.recycleProjectDescription":
    "{name} 及其活动文档将从普通项目与搜索结果中移除。",
  "insights.applyReimportDescription":
    "将此修订绑定预览应用到 {name}。已移除及有歧义的句段将遵循引擎协调计划。",
  "insights.projectFiles": "{count} 个项目文件",
  "insights.unavailable": "不可用",
  "insights.diagnosticsCount": "{count} 条诊断",
  "insights.blockerCount": "{count} 个阻断项",
  "insights.unchanged": "未变更",
  "insights.changed": "已变更",
  "insights.newSegments": "新增",
  "insights.removed": "已移除",
  "insights.ambiguous": "有歧义",
  "insights.runAnalysis": "运行分析",
  "insights.newLabel": "新增 {ordinal}",
  "insights.newItem": "新增",
  "insights.removedLabel": "已移除",
  "insights.untranslated": "未翻译",
  "insights.draft": "草稿",
  "insights.reviewed": "已审阅",
  "insights.translation": "翻译",
  "insights.review": "审阅",
  "insights.signed": "已签署",
  "insights.activity": "活动",
  "insights.automation": "自动化",
  "insights.tmReuse": "翻译记忆复用",
  "insights.historyCount": "已记录 {count} 项操作",
  "insights.fileRevisionVersion": "修订 {revision} · 版本 {version}",
  "insights.fileSegments": "{count} 个句段",
  "insights.fileSegmentsDiagnostics": "{count} 个句段 · {diagnostics} 条诊断",
  "insights.profileRevision": "{profile} · 修订 {revision}",
  "insights.repetitions": "重复",
  "insights.exact": "完全匹配",
  "insights.match9599": "95–99",
  "insights.match8594": "85–94",
  "insights.match7584": "75–84",
  "insights.match5074": "50–74",
  "insights.noMatch": "无匹配",
  "insights.milliUnits": "{value} mU",
  "insights.percent": "{value}%",
  "insights.durationSeconds": "{value} 秒",
  "insights.durationMinutes": "{value} 分钟",
  "insights.durationHours": "{value} 小时",
  "qa.run": "运行质检",
  "qa.waivedBy": "由 {actor} 豁免",
  "qa.relatedSegmentCount":
    "{count, plural, one {# 个相关句段} other {# 个相关句段}}",
  "qa.segmentOrdinal": "句段 {ordinal}",
  "qa.name": "名称",
  "qa.label": "标签",
  "qa.field": "字段",
  "qa.reviewStats": "{signed} 已签核 · {review} 审校中",
  "qa.pendingProposalCount": "{count} 条待处理建议",
  "task.previewReady": "{kind} 预览就绪：{count} 行。",
  "task.kindAssignment": "分配",
  "task.kindReturn": "回传",
  "task.identicalEdit": "相同编辑",
  "task.openPackage": "打开任务包",
  "task.chooseDestination": "选择 .tltask 目标",
  "task.exportAssignment": "导出分配",
  "task.openTltask": "打开 .tltask",
  "task.previewPackage": "预览任务包",
  "task.importDetached": "导入独立任务",
  "task.selectSafeOnPage": "选择本页安全行",
  "task.previous": "上一页",
  "task.openTaskProject": "打开任务项目",
  "task.addSlice": "添加切片",
  "setup.addFilesBtn": "添加文件",
  "setup.addFolderBtn": "添加文件夹",
  "setup.noSourcesSelected": "未选择源文件",
  "setup.continue": "继续",
  "setup.openWorkspace": "打开工作区",
  "setup.importing": "正在导入",
  "assistant.action.improve": "改进",
  "assistant.action.fixTerms": "修正术语",
  "assistant.action.shorten": "缩短",
  "assistant.action.explain": "解释",
  "assistant.action.translate": "翻译",
  "assistant.action.formal": "正式",
  "assistant.prompt.fixTerms": "修正术语",
  "assistant.prompt.explain": "解释原文",
  "assistant.conversation": "对话",
  "assistant.you": "你",
  "assistant.roleAssistant": "助手",
  "assistant.metric.offlineModel": "离线模型配置：{model}",
  "assistant.metric.inputTokens": "合成输入 token：{count}",
  "assistant.metric.cacheRead": "合成缓存读取 token：{count}",
  "assistant.metric.thinking": "合成思考 token：{count}",
  "assistant.metric.outputTokens": "合成输出 token：{count}",
  "assistant.metric.cacheWrite": "合成缓存写入 token：{count}",
  "assistant.metric.elapsed": "合成耗时：{value}",
  "assistant.stop": "停止",
  "assistant.newConversationTitle": "新建对话",
  "assistant.elapsedLabel": "耗时",
  "workbench.runQa": "运行质检",
  "workbench.more": "更多",
  "workbench.tags": "标签",
  "workbench.theme": "主题",
  "workbench.zoom": "缩放",
  "workbench.trados": "Trados",
  "workbench.find": "查找",
  "workbench.reject": "拒绝",
  "workbench.accept": "接受",
  "workbench.matches": "匹配",
  "workbench.assistant": "助手",
  "workbench.insert": "插入",
  "workbench.translationProject": "翻译项目",
  "workbench.segmentsCount": "{count, plural, one {# 个句段} other {# 个句段}}",
  "workbench.conversionDescription":
    "引擎会使用 OpenCC 级短语词典转换当前完整译文。该变更会生成修订，可撤销或重做。",
  "workbench.openPreview": "打开预览",
  "workbench.collapsePreview": "折叠预览",
  "workbench.restoreSuggestions": "还原建议面板",
  "workbench.maximizeSuggestions": "最大化建议面板",
  "workbench.segmentLabel": "句段 {number}",
  "workbench.noExactMatch": "没有精确翻译记忆匹配",
  "workbench.noTermHits": "没有术语命中",
  "workbench.noTargetTranslation": "没有目标译文",
  "workbench.chinese.s2t": "简体 → 繁体",
  "workbench.chinese.s2tw": "简体 → 台湾用语",
  "workbench.chinese.s2hk": "简体 → 香港",
  "workbench.chinese.t2s": "繁体 → 简体",
  "workbench.chinese.tw2s": "台湾用语 → 简体",
  "workbench.chinese.hk2s": "香港 → 简体",
  "workbench.filterAll": "全部",
  "workbench.filterUntranslated": "未翻译",
  "workbench.filterDraft": "草稿",
  "workbench.filterConfirmed": "已确认",
  "workbench.filterIssues": "问题",
  "workbench.sourceColumn": "原文（{locale}）",
  "workbench.targetColumn": "译文（{locale}）",
  "workbench.spellFindingsFrom": "拼写问题来自 {provider}",
  "workbench.selectProtectedTag": "选择位置 {position} 的受保护标签 {tag}",
  "workbench.acceptAutocomplete": "接受 {provider} 自动补全",
  "workbench.signedReadOnly":
    "已签核句段为只读。请先将句段退回审校或翻译状态。",
  "workbench.importNote": "导入备注",
  "workbench.reopen": "重新打开",
  "workbench.resolve": "解决",
  "workbench.changedFrom": "从 {before} 更改为 {after}",
  "common.pageRange": "{start}–{end} / 共 {total}",
  "common.positionOf": "{position} / 共 {total}",
  "common.revision": "修订 {revision}",
  "common.messages": "条消息",
  "common.activeMessages": "条活动消息",
  "common.entries": "条目",
  "common.diagnosticsCount": "条诊断",
  "common.readOnly": "只读",
  "common.units": "个单元",
  "common.matches": "个匹配",
  "common.relatedUnits": "个相关单元",
  "common.agreement": "一致度",
  "common.segmentCount": "{count, plural, one {# 个句段} other {# 个句段}}",
  "common.selectedCount": "已选择 {count} 项",
  "common.sourceExpression": "原文表达",
  "common.targetExpression": "译文表达",
  "common.noSourceExpression": "（无原文表达）",
  "common.noTargetExpression": "（无译文表达）",
  "common.noStructuralPath": "无结构路径",
  "common.noSourceMember": "无原文成员",
  "common.noTargetMember": "无译文成员",
  "common.projectScope": "项目范围",
  "common.documentScope": "文档范围",
  "common.segmentScope": "句段范围",
  "common.entireProject": "整个项目",
  "common.localReview": "本地审阅",
  "common.immutableCheckpoint": "不可变检查点",
  "common.createSnapshot": "创建快照",
  "common.restoreSnapshot": "恢复快照",
  "common.previewRestore": "预览恢复",
  "common.refreshPreview": "刷新预览",
  "common.baseRevision": "基础修订",
  "common.documents": "文档",
  "common.segments": "句段",
  "common.threadsCount": "讨论串",
  "common.expectedRevision": "预期修订 {revision}",
  "common.stateDigest": "状态 {digest}",
  "common.selectNamed": "选择 {name}",
  "common.deleteNamed": "删除 {name}",
  "common.editNamed": "编辑 {name}",
  "alignment.loadingSessions": "正在加载对齐会话",
  "alignment.loadingCorpora": "正在加载参考语料",
  "alignment.sessionsLabel": "对齐会话",
  "alignment.candidatesLabel": "对齐候选",
  "alignment.selectedCount": "已选择 {count} 项",
  "alignment.sessionStatus": "会话 {status}",
  "alignment.terminalResult":
    "已插入 {inserted} 条，保留 {duplicates} 条重复项，翻译记忆修订为 {revision}。",
  "alignment.terminalLocked": "该会话已结束，更正控件已锁定。",
  "alignment.refine": "精炼 {count, plural, one {# 个提议} other {# 个提议}}",
  "alignment.applyTmCount": "应用 {count}",
  "alignment.selectCandidate": "选择对齐候选 {ordinal}",
  "alignment.sourceSegments": "原文 · {count} 个句段",
  "alignment.targetSegments": "译文 · {count} 个句段",
  "alignment.sourceUnaligned": "（原文未对齐）",
  "alignment.targetUnaligned": "（译文未对齐）",
  "alignment.noSourceMember": "无原文成员",
  "alignment.noTargetMember": "无译文成员",
  "alignment.evidenceCount": "证据 · {count}",
  "alignment.refinementFailed": "对齐精炼失败。",
  "alignment.refinementPollingCanceled": "对齐精炼轮询已取消。",
  "alignment.refinementTimeout": "对齐精炼在两分钟内未完成。",
  "alignment.candidateCount": "{count} 个对齐候选",
  "alignment.sessionMeta": "会话 {id} · 修订 {revision}",
  "corpus.chooseOrDrop": "选择或拖放一个语料文件",
  "corpus.noFileSelected": "未选择文件",
  "corpus.referenceCount": "{count} 个参考语料",
  "corpus.entries": "条目",
  "corpus.diagnostics": "条诊断",
  "corpus.revision": "修订",
  "corpus.matchCount": "{count} 个匹配",
  "corpus.entry": "条目 {ordinal} · {id}",
  "corpus.noSourceExpression": "（无原文表达）",
  "corpus.noTargetExpression": "（无译文表达）",
  "corpus.noStructuralPath": "无结构路径",
  "corpus.noProvenance": "无其他来源信息",
  "corpus.provenanceUnavailable": "来源信息不可用",
  "corpus.removeNamed": "移除 {name}",
  "corpus.removeBody":
    "移除后，搜索与 AI grounding 将立即排除此语料。原始文档、翻译记忆单元和托管源文件不会更改。",
  "corpus.removing": "正在移除",
  "corpus.searchResults": "语料搜索结果",
  "corpus.referenceCorpora": "参考语料",
  "corpus.documents": "文档 {source} / {target}",
  "corpus.alignment": "对齐 {id}",
  "corpus.removeAction": "移除语料",
  "discussion.localReview": "本地审阅",
  "discussion.segmentLimit": "显示前 {shown} / 共 {total} 个句段。",
  "discussion.createDiscussion": "创建讨论",
  "discussion.messageCount": "{count} 条消息",
  "discussion.scopeTitle": "{scope}讨论",
  "discussion.resolve": "解决",
  "discussion.reopen": "重新打开",
  "discussion.deletedMessage": "已删除消息",
  "discussion.editNamed": "编辑消息 {ordinal}",
  "discussion.deleteNamed": "删除消息 {ordinal}",
  "discussion.replyPlaceholder": "添加本地回复",
  "discussion.reopenBeforeReply": "重新打开讨论后再回复",
  "discussion.deleteAction": "删除消息",
  "discussion.threadPages": "讨论串分页",
  "discussion.messagePages": "消息分页",
  "discussion.revision": "修订 {revision}",
  "discussion.activeMessages": "{count} 条活动消息",
  "snapshot.immutableCheckpoint": "不可变检查点",
  "snapshot.create": "创建快照",
  "snapshot.revision": "修订 {revision}",
  "snapshot.refreshPreview": "刷新预览",
  "snapshot.previewRestore": "预览恢复",
  "snapshot.baseRevision": "基础修订",
  "snapshot.documents": "文档",
  "snapshot.segments": "句段",
  "snapshot.threads": "讨论串",
  "snapshot.expectedRevision": "预期修订 {revision}",
  "snapshot.state": "状态 {digest}",
  "snapshot.restoreSnapshot": "恢复快照",
  "snapshot.restoreTitle": "恢复 {name}",
  "snapshot.restoreBody":
    "引擎会在单个事务中应用此预览前重新检查项目修订 {revision} 与当前状态摘要。",
  "snapshot.restoreAction": "恢复快照",
  "snapshot.snapshotPages": "快照分页",
  "snapshot.restoredLabel": "已恢复",
  "snapshot.documentsAdded": "新增文档",
  "snapshot.documentsRemoved": "移除文档",
  "snapshot.documentsChanged": "变更文档",
  "snapshot.segmentsAdded": "新增句段",
  "snapshot.segmentsRemoved": "移除句段",
  "snapshot.segmentsChanged": "变更句段",
  "snapshot.commentsChanged": "变更评论",
  "snapshot.reviewsChanged": "变更审阅",
  "snapshot.discussionsChanged": "变更讨论",
  "snapshot.mountsAdded": "新增挂载",
  "snapshot.mountsRemoved": "移除挂载",
  "snapshot.mountsChanged": "变更挂载",
  "curation.semanticProvider": "语义提供方",
  "curation.readOnly": "只读",
  "curation.minimumChars": "最少字符数",
  "curation.minimumRatio": "最小比例 %",
  "curation.maximumRatio": "最大比例 %",
  "curation.nearDuplicate": "近重复 %",
  "curation.semanticScore": "语义分数 bp",
  "curation.quarantineScore": "隔离分数 bp",
  "curation.minimumTermFrequency": "最小术语频次",
  "curation.scoreProjection": "分数投影",
  "curation.loadingUnits": "正在加载已分析单元",
  "curation.cleanDataset": "导出干净数据集",
  "curation.lastExport": "上次导出：{path}",
  "curation.projectOrigin": "项目 {id}",
  "curation.globalOrigin": "全局",
  "curation.documentOrigin": " / 文档 {id}",
  "curation.unitOrigin": "单元 {id}",
  "curation.selectFinding": "选择 {kind} 问题 {id}",
  "curation.languageIntelligence": "语言智能",
  "curation.agreement": "一致度",
  "curation.relatedUnits": "相关单元",
  "curation.metricAnalyzed": "已分析",
  "curation.metricWithFindings": "含问题",
  "curation.metricFindings": "问题",
  "curation.metricQuarantine": "隔离候选",
  "curation.metricTerms": "术语候选",
  "curation.metricDrift": "漂移组",
  "curation.applyDialogTitle": "应用策展选择",
  "curation.rollbackDialogTitle": "回滚策展运行",
  "curation.applyDialogBody": "隔离明确选择的 {count} 个问题并更新分数投影。",
  "curation.rollbackDialogBody":
    "从记录的变更前映像恢复本次运行更改的所有单元。",
  "curation.applyAction": "应用选择",
  "curation.rollbackAction": "回滚运行",
  "curation.exportStatus": "上次导出：{path}",
  "curation.findingPages": "策展问题分页",
  "curation.unitPages": "已分析单元分页",
  "curation.termUses": "使用 {count} 次",
  "curation.relatedUnitCount": "{count} 个相关单元",
  "curation.scoreNotAvailable": "未评分",
  "curation.findingExactDuplicate": "完全重复",
  "curation.findingNearDuplicate": "近似重复",
  "curation.findingCompetingTranslation": "竞争译文",
  "curation.findingSourceEqualsTarget": "原文等于译文",
  "curation.findingMinimumLength": "长度不足",
  "curation.findingLengthRatio": "长度比例",
  "curation.findingNumberMismatch": "数字不一致",
  "curation.findingDateMismatch": "日期不一致",
  "curation.findingPlaceholderMismatch": "占位符不一致",
  "curation.findingCreatedOutsideRange": "创建时间超出范围",
  "curation.findingLikelyWrongLanguage": "疑似语言错误",
  "curation.findingSemanticMismatch": "语义不匹配",
  "curation.severityError": "错误",
  "curation.severityWarning": "警告",
  "curation.severityInfo": "信息",
  "curation.dispositionKeep": "保留",
  "curation.dispositionReview": "审阅",
  "curation.dispositionQuarantine": "隔离",
  "curation.evidenceSource": "原文：{value}",
  "curation.evidenceTarget": "译文：{value}",
  "curation.evidenceRelatedUnit": "相关单元：{value}",
  "curation.noAdditionalEvidence": "没有其他证据",
};

const catalogs: Record<AppLocale, MessageCatalog> = {
  "en-US": enUs,
  "zh-CN": zhCn,
};

const MESSAGE_KEYS = Object.keys(enUs) as MessageKey[];

export type FormatVars = Record<
  string,
  string | number | Date | null | undefined
>;

export function listLocales(): AppLocale[] {
  return ["en-US", "zh-CN"];
}

export function listMessageKeys(): MessageKey[] {
  return [...MESSAGE_KEYS];
}

export function normalizeLocale(value: string | null | undefined): AppLocale {
  if (!value) return "en-US";
  const lower = value.toLocaleLowerCase();
  if (lower.startsWith("zh")) return "zh-CN";
  return "en-US";
}

/** ICU-lite: `{name}`, `{count, plural, one {…} other {…}}`. */
export function formatMessage(
  locale: AppLocale,
  key: MessageKey,
  vars?: FormatVars,
): string {
  const template =
    catalogs[locale][key] ?? catalogs["en-US"][key] ?? String(key);
  return renderTemplate(locale, template, vars);
}

/** @deprecated Prefer formatMessage; kept for existing call sites. */
export function t(
  locale: AppLocale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  return formatMessage(locale, key, vars);
}

export function formatDate(
  locale: AppLocale,
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(
    locale,
    options ?? { dateStyle: "medium", timeStyle: "short" },
  ).format(date);
}

export function formatNumber(
  locale: AppLocale,
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatBytes(locale: AppLocale, bytes: number): string {
  const units =
    locale === "zh-CN"
      ? (["字节", "KB", "MB", "GB", "TB"] as const)
      : (["B", "KB", "MB", "GB", "TB"] as const);
  let size = Math.max(0, bytes);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const value =
    unitIndex === 0
      ? formatNumber(locale, size, { maximumFractionDigits: 0 })
      : formatNumber(locale, size, { maximumFractionDigits: 1 });
  return formatMessage(locale, "format.bytes", {
    value,
    unit: units[unitIndex],
  });
}

/**
 * Keys that may remain identical across locales (product name / technical tokens).
 */
export const AUDITED_BILINGUAL_IDENTICAL_KEYS = [
  "app.name",
  "setup.brand",
  "workbench.tab",
  "workbench.trados",
  "insights.milliUnits",
  "insights.percent",
] as const satisfies readonly MessageKey[];

/**
 * Technical / provider / engine payload strings that stay as data and must not
 * be rewritten by the renderer catalog.
 */
export const AUDITED_TECHNICAL_STRING_ALLOWLIST = [
  "Engine/protocol error messages from formatError()",
  "Provider profile names and IDs from ai.provider.*",
  "Plugin status tokens and lastError from plugin.list",
  "QA rule IDs, finding messages, and profile names from qa.*",
  "Document/format identifiers (docx, xlsx, pdf, …) returned by Engine",
  "User-authored source/target/comment/reason bodies",
  "Format tokens shown as data: DOCX, XLSX, JSONL, TSV when not product chrome",
] as const;

export function catalogDiagnostics(locale: AppLocale): string[] {
  const issues: string[] = [];
  for (const key of MESSAGE_KEYS) {
    const value = catalogs[locale][key];
    if (!value || !value.trim()) {
      issues.push(`missing:${locale}:${key}`);
    }
  }
  if (locale === "zh-CN") {
    for (const key of MESSAGE_KEYS) {
      const zh = catalogs["zh-CN"][key];
      const en = catalogs["en-US"][key];
      const identicalOk = new Set<string>(
        AUDITED_BILINGUAL_IDENTICAL_KEYS as readonly string[],
      );
      if (
        !identicalOk.has(key) &&
        zh === en &&
        /[A-Za-z]{4,}/.test(en) &&
        !en.includes("Translunar")
      ) {
        issues.push(`placeholder:${key}`);
      }
    }
  }
  return issues;
}

export function missingKeyDiagnostics(
  locale: AppLocale,
  key: string,
): string | null {
  if ((MESSAGE_KEYS as string[]).includes(key)) return null;
  return `missing-key:${locale}:${key}`;
}

function renderTemplate(
  locale: AppLocale,
  template: string,
  vars?: FormatVars,
): string {
  let text = template.replace(
    /\{(\w+),\s*plural,\s*one\s*\{([^}]*)\}\s*other\s*\{([^}]*)\}\}/gu,
    (_match, name: string, one: string, other: string) => {
      const raw = vars?.[name];
      const count = typeof raw === "number" ? raw : Number(raw ?? 0);
      const branch = Math.abs(count) === 1 ? one : other;
      return branch.replaceAll("#", formatNumber(locale, count));
    },
  );
  if (!vars) return text;
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined || value === null) continue;
    if (value instanceof Date) {
      text = text.replaceAll(`{${name}}`, formatDate(locale, value));
    } else if (typeof value === "number") {
      text = text.replaceAll(`{${name}}`, formatNumber(locale, value));
    } else {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
