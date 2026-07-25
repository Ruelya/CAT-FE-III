/**
 * Trellis ↔ Amp bridge plugin.
 *
 * Maps Claude-style Trellis hooks onto Amp plugin events:
 * - SessionStart / UserPromptSubmit → agent.start (hidden message injection)
 * - Shell session identity → tool.call modify (TRELLIS_CONTEXT_ID on shell_command)
 * - Status bar → experimental.createStatusItem (active task / status)
 *
 * Subagent tools are intentionally NOT implemented: Amp has no Claude-style
 * Task/trellis-implement dispatch surface; it may spawn its own generic
 * subagents. Main-session injection + skills cover the common path.
 *
 * Disable with TRELLIS_HOOKS=0 or TRELLIS_DISABLE_HOOKS=1.
 *
 * After editing: command palette → `plugins: reload`.
 */
import type { PluginAPI, ThreadID } from '@ampcode/plugin'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const DRIVER = join('.amp', 'run-trellis-hook.py')
const SESSION_START_HOOK = join('.claude', 'hooks', 'session-start.py')
const WORKFLOW_STATE_HOOK = join('.claude', 'hooks', 'inject-workflow-state.py')

/** Threads that already received the heavy SessionStart payload this process. */
const sessionStartDone = new Set<string>()

type ShellFn = PluginAPI['$']

function hooksDisabled(): boolean {
	return (
		process.env.TRELLIS_HOOKS === '0' || process.env.TRELLIS_DISABLE_HOOKS === '1'
	)
}

/** Stable Trellis session key derived from Amp thread id. */
function contextKeyForThread(threadId: ThreadID): string {
	const safe = threadId.replace(/[^A-Za-z0-9_-]/g, '_')
	return `amp_${safe}`
}

function workspaceRootPath(amp: PluginAPI): string | null {
	const root = amp.system.workspaceRoot
	if (!root) return null
	return amp.helpers.filePathFromURI(root)
}

function isTrellisProject(root: string): boolean {
	return existsSync(join(root, '.trellis'))
}

async function fetchStatusLine(
	$: ShellFn,
	root: string,
	contextKey: string,
): Promise<string> {
	const driverPath = join(root, DRIVER)
	if (!existsSync(driverPath)) return 'Trellis · (no driver)'
	const result = await $`python ${driverPath} --status-line ${contextKey}`
	const line = (result.stdout || '').trim().split(/\r?\n/).pop() || ''
	if (result.exitCode !== 0 || !line) return 'Trellis · (status failed)'
	return line
}

function parseAdditionalContext(stdout: string): string | null {
	const text = stdout.trim()
	if (!text) return null
	try {
		const parsed = JSON.parse(text) as {
			hookSpecificOutput?: { additionalContext?: unknown }
		}
		const ctx = parsed?.hookSpecificOutput?.additionalContext
		if (typeof ctx === 'string' && ctx.trim()) return ctx.trim()
	} catch {
		// bare text path
	}
	if (
		text.includes('<workflow-state>') ||
		text.includes('<first-reply-notice>') ||
		text.includes('SESSION CONTEXT') ||
		text.includes('<trellis')
	) {
		return text
	}
	return null
}

async function runHook(
	$: ShellFn,
	root: string,
	contextKey: string,
	hookRelPath: string,
	sessionId: string,
	hookEventName?: string,
): Promise<string | null> {
	const driverPath = join(root, DRIVER)
	const hookPath = join(root, hookRelPath)
	if (!existsSync(driverPath) || !existsSync(hookPath)) return null

	// Absolute driver path so Amp's shell cwd does not matter.
	const eventArg = hookEventName ?? 'UserPromptSubmit'
	const result = await $`python ${driverPath} ${hookRelPath} ${contextKey} ${sessionId} ${eventArg}`
	if (result.exitCode !== 0) return null
	return parseAdditionalContext(result.stdout)
}

async function collectInjection(
	amp: PluginAPI,
	$: ShellFn,
	threadId: ThreadID,
	logger: { log: (...args: unknown[]) => void },
): Promise<string | null> {
	const root = workspaceRootPath(amp)
	if (!root || !isTrellisProject(root)) return null

	const key = contextKeyForThread(threadId)
	const parts: string[] = []

	if (!sessionStartDone.has(threadId)) {
		sessionStartDone.add(threadId)
		const sessionCtx = await runHook(
			$,
			root,
			key,
			SESSION_START_HOOK,
			threadId,
			'SessionStart',
		)
		if (sessionCtx) {
			parts.push(sessionCtx)
			logger.log('Trellis SessionStart injected for', threadId)
		} else {
			parts.push(
				[
					'<trellis-bootstrap>',
					'Amp Trellis bridge is active.',
					'If you have not loaded Trellis this session, read the `trellis-start` skill once.',
					`Session context key: ${key}`,
					'</trellis-bootstrap>',
				].join('\n'),
			)
		}
	}

	const breadcrumb = await runHook(
		$,
		root,
		key,
		WORKFLOW_STATE_HOOK,
		threadId,
		'UserPromptSubmit',
	)
	if (breadcrumb) {
		parts.push(breadcrumb)
	} else {
		parts.push(
			[
				'<workflow-state>',
				'Status: unknown',
				'Refer to .trellis/workflow.md for current step.',
				`Session: ${key}`,
				'</workflow-state>',
			].join('\n'),
		)
	}

	parts.push(
		[
			'<trellis-amp-session>',
			`TRELLIS_CONTEXT_ID=${key}`,
			'Shell commands in this thread are auto-prefixed with this env var so',
			'`python ./.trellis/scripts/task.py start|current|finish` keep session identity.',
			'</trellis-amp-session>',
		].join('\n'),
	)

	return parts.join('\n\n')
}

function shellAlreadyHasContextId(command: string): boolean {
	return (
		command.includes('TRELLIS_CONTEXT_ID=') ||
		command.includes('TRELLIS_CONTEXT_ID =')
	)
}

function injectEnvIntoShellCommand(command: string, contextKey: string): string {
	if (shellAlreadyHasContextId(command)) return command
	const safe = contextKey.replace(/'/g, `'\\''`)
	return `export TRELLIS_CONTEXT_ID='${safe}'; ${command}`
}

export default function (amp: PluginAPI) {
	amp.logger.log('Trellis Amp plugin loaded')

	// Status bar: requires experimental plugin API (createStatusItem).
	const statusItem =
		amp.experimental && typeof amp.experimental.createStatusItem === 'function'
			? amp.experimental.createStatusItem({
					text: 'Trellis · …',
					url: 'command:trellis-status',
				})
			: null

	if (!statusItem) {
		amp.logger.log(
			'Trellis status bar skipped (experimental.createStatusItem unavailable)',
		)
	}

	async function refreshStatusBar(
		$: ShellFn,
		threadId: ThreadID | null,
		logger?: { log: (...args: unknown[]) => void },
	): Promise<void> {
		if (!statusItem || hooksDisabled()) return
		const root = workspaceRootPath(amp)
		if (!root || !isTrellisProject(root)) {
			statusItem.update({ text: 'Trellis · (idle)' })
			return
		}
		const key = threadId
			? contextKeyForThread(threadId)
			: 'amp_no_thread'
		try {
			const text = await fetchStatusLine($, root, key)
			statusItem.update({
				text,
				url: 'command:trellis-status',
			})
		} catch (err) {
			logger?.log('Trellis status bar refresh failed:', err)
			statusItem.update({ text: 'Trellis · (error)' })
		}
	}

	// Initial paint for workspace
	const rootAtLoad = workspaceRootPath(amp)
	if (rootAtLoad && isTrellisProject(rootAtLoad) && statusItem) {
		void (async () => {
			try {
				const text = await fetchStatusLine(amp.$, rootAtLoad, 'amp_boot')
				statusItem.update({ text, url: 'command:trellis-status' })
			} catch {
				statusItem.update({ text: 'Trellis · ready' })
			}
		})()
	}

	amp.on('session.start', async (event, ctx) => {
		await refreshStatusBar(ctx.$, event.thread.id, ctx.logger)
	})

	amp.on('agent.start', async (event, ctx) => {
		if (hooksDisabled()) return

		// Fire-and-forget status update so it does not block injection path length
		void refreshStatusBar(ctx.$, event.thread.id, ctx.logger)

		try {
			const content = await collectInjection(
				amp,
				ctx.$,
				event.thread.id,
				ctx.logger,
			)
			if (!content) return

			return {
				message: {
					content,
					display: false,
				},
			}
		} catch (err) {
			ctx.logger.log('Trellis agent.start inject failed:', err)
			return
		}
	})

	amp.on('agent.end', async (event, ctx) => {
		// Task may have been started/finished mid-turn — refresh bar
		await refreshStatusBar(ctx.$, event.thread.id, ctx.logger)
	})

	amp.on('tool.call', async (event) => {
		if (hooksDisabled()) return { action: 'allow' as const }

		const shell = amp.helpers.shellCommandFromToolCall(event)
		if (!shell?.command) return { action: 'allow' as const }

		const key = contextKeyForThread(event.thread.id)
		const next = injectEnvIntoShellCommand(shell.command, key)
		if (next === shell.command) return { action: 'allow' as const }

		return {
			action: 'modify' as const,
			input: {
				...event.input,
				command: next,
			},
		}
	})

	amp.registerCommand(
		'trellis-status',
		{
			title: 'Show Trellis status',
			category: 'trellis',
			description: 'Show active task / workflow breadcrumb for this thread',
		},
		async (ctx) => {
			const root = workspaceRootPath(amp)
			if (!root || !isTrellisProject(root)) {
				await ctx.ui.notify('Not a Trellis project (no .trellis/).')
				return
			}
			const threadId = ctx.thread?.id ?? null
			const key = threadId ? contextKeyForThread(threadId) : 'amp_no_thread'
			await refreshStatusBar(ctx.$, threadId)
			const breadcrumb = await runHook(
				ctx.$,
				root,
				key,
				WORKFLOW_STATE_HOOK,
				threadId ?? key,
				'UserPromptSubmit',
			)
			const statusLine = await fetchStatusLine(ctx.$, root, key)
			await ctx.ui.notify(
				[statusLine, breadcrumb ?? '(no workflow-state breadcrumb)'].join(
					'\n\n',
				),
			)
		},
	)

	amp.registerCommand(
		'trellis-reload-session',
		{
			title: 'Reload SessionStart context',
			category: 'trellis',
			description: 'Force re-inject Trellis SessionStart on the next user turn',
		},
		async (ctx) => {
			if (ctx.thread) {
				sessionStartDone.delete(ctx.thread.id)
			} else {
				sessionStartDone.clear()
			}
			await refreshStatusBar(ctx.$, ctx.thread?.id ?? null)
			await ctx.ui.notify(
				'Trellis SessionStart will re-run on the next user message in this thread.',
			)
		},
	)
}
