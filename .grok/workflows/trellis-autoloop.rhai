let meta = #{
    name: "trellis-autoloop",
    description: "Trellis Grok autoloop: plan -> implement -> review/test/fix -> closeout (one middle-loop pass; Orchestrator still owns git merge)",
    phases: [
        #{ title: "Bootstrap", detail: "resolve active task path" },
        #{ title: "Plan", detail: "optional trellis-plan" },
        #{ title: "Implement", detail: "trellis-implement" },
        #{ title: "Quality", detail: "review/test/fix loop" },
        #{ title: "Closeout", detail: "trellis-closeout" },
    ],
    when_to_use: "Run a single Trellis task middle-loop under Grok workers without worktree isolation",
};

// args:
//   task_path: string (required) — e.g. .trellis/tasks/07-31-foo
//   skip_plan: bool optional — default false
//   max_quality_rounds: int optional — default 5
//   goal: string optional — brief for plan/implement

let task_path = if args == () { () } else { args.task_path };
if task_path == () {
    pause("verification", "Pass args.task_path — active Trellis task directory (e.g. .trellis/tasks/MM-DD-name).");
}

let skip_plan = false;
if args != () && args.skip_plan != () { skip_plan = args.skip_plan; }

let max_rounds = 5;
if args != () && args.max_quality_rounds != () { max_rounds = args.max_quality_rounds; }

let goal = "";
if args != () && args.goal != () { goal = args.goal; }

let plan_schema = #{
    "type": "object",
    "required": ["ready_for_start", "summary"],
    "properties": #{
        "ready_for_start": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "research_needed": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let impl_schema = #{
    "type": "object",
    "required": ["done", "summary"],
    "properties": #{
        "done": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "files": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let review_schema = #{
    "type": "object",
    "required": ["verdict", "findings_path", "summary"],
    "properties": #{
        "verdict": #{ "type": "string" },
        "findings_path": #{ "type": "string" },
        "need_verify": #{ "type": "boolean" },
        "verify_mission_purpose": #{ "type": "string" },
        "summary": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["mission_status", "verify_path", "summary_for_reviewer"],
    "properties": #{
        "mission_status": #{ "type": "string" },
        "verify_path": #{ "type": "string" },
        "summary_for_reviewer": #{ "type": "string" },
        "highlights": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["addressed", "summary"],
    "properties": #{
        "addressed": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
    },
};

let close_schema = #{
    "type": "object",
    "required": ["summary", "commit_subject"],
    "properties": #{
        "summary": #{ "type": "string" },
        "commit_subject": #{ "type": "string" },
        "spec_updated": #{ "type": "boolean" },
    },
};

phase("Bootstrap");
log("trellis-autoloop task=" + task_path);

// --- Plan (optional) ---
if !skip_plan {
    phase("Plan");
    let plan_prompt = "";
    plan_prompt += "Active task: " + task_path + "\n";
    plan_prompt += "You are trellis-plan. Follow .trellis/workflow.md Grok Autoloop and guides/autoloop-orchestration.md.\n";
    plan_prompt += "Goal/brief: " + goal + "\n";
    plan_prompt += "Write/update prd/design/implement/jsonl as needed. No product code. No user Q&A.\n";
    plan_prompt += "Prefer complete quality for chosen scope (no deliberately broken MVP cuts).\n";
    plan_prompt += "Return JSON: ready_for_start, summary, research_needed.\n";
    let pr = agent(plan_prompt, #{
        label: "trellis-plan",
        agent_type: "trellis-plan",
        capability_mode: "read-write",
        output_schema: plan_schema,
    });
    if pr == () || !pr.success {
        complete(#{ ok: false, stage: "plan", error: "plan agent failed" });
    }
    if pr.output.research_needed != () {
        let rn = pr.output.research_needed;
        if type_of(rn) == "array" && rn.len() > 0 {
            phase("Research");
            // One batched research spawn for the full question list (not one agent per question).
            let rprompt = "";
            rprompt += "Active task: " + task_path + "\n";
            rprompt += "You are trellis-research. Answer ALL questions below in this single run; persist under research/.\n";
            rprompt += "Questions JSON: " + json_encode(rn) + "\n";
            rprompt += "Return a short summary of files written (paths only).\n";
            let res = agent(rprompt, #{
                label: "trellis-research-batch",
                agent_type: "trellis-research",
                capability_mode: "read-write",
            });
            if res == () || !res.success {
                complete(#{ ok: false, stage: "research", error: "research batch failed" });
            }
            let plan2 = "";
            plan2 += "Active task: " + task_path + "\n";
            plan2 += "You are trellis-plan. Research files may have been added under research/. Update artifacts and jsonl.\n";
            plan2 += "Return JSON: ready_for_start, summary, research_needed (prefer empty).\n";
            let pr2 = agent(plan2, #{
                label: "trellis-plan-after-research",
                agent_type: "trellis-plan",
                capability_mode: "read-write",
                output_schema: plan_schema,
                resume_from: pr.agent_id,
            });
            if pr2 == () || !pr2.success || pr2.output.ready_for_start != true {
                complete(#{ ok: false, stage: "plan-after-research", error: "plan not ready after research" });
            }
        } else if pr.output.ready_for_start != true {
            complete(#{ ok: false, stage: "plan", error: "plan not ready", detail: pr.output });
        }
    } else if pr.output.ready_for_start != true {
        complete(#{ ok: false, stage: "plan", error: "plan not ready", detail: pr.output });
    }
}

// --- Implement ---
phase("Implement");
let impl_prompt = "";
impl_prompt += "Active task: " + task_path + "\n";
impl_prompt += "You are trellis-implement. Implement against prd/design/implement and implement.jsonl.\n";
impl_prompt += "Do light lint/typecheck self-check. Do not commit/merge. Do not spawn subagents.\n";
impl_prompt += "Goal context: " + goal + "\n";
impl_prompt += "Return JSON: done, summary, files.\n";
let ir = agent(impl_prompt, #{
    label: "trellis-implement",
    agent_type: "trellis-implement",
    capability_mode: "all",
    output_schema: impl_schema,
});
if ir == () || !ir.success {
    complete(#{ ok: false, stage: "implement", error: "implement failed" });
}

// --- Quality loop ---
phase("Quality");
let round = 1;
let review_id = ();
let last_verdict = "";
let last_findings = "";

while round <= max_rounds {
    log("quality round " + round.to_string());
    let rev_prompt = "";
    rev_prompt += "Active task: " + task_path + "\n";
    rev_prompt += "You are trellis-review. Write findings under task review/ per autoloop-orchestration.md.\n";
    rev_prompt += "If need_verify, include a full Verify mission (purpose, questions, success_criteria, suggested_commands) — not bare commands.\n";
    rev_prompt += "Round: " + round.to_string() + "\n";
    rev_prompt += "Return JSON: verdict, findings_path, need_verify, verify_mission_purpose, summary. Never request research.\n";

    let rev_opts = #{
        label: "trellis-review-" + round.to_string(),
        agent_type: "trellis-review",
        capability_mode: "read-write",
        output_schema: review_schema,
    };
    if review_id != () {
        rev_opts.resume_from = review_id;
    }
    let rr = agent(rev_prompt, rev_opts);
    if rr == () || !rr.success {
        complete(#{ ok: false, stage: "review", round: round, error: "review failed" });
    }
    review_id = rr.agent_id;
    last_verdict = rr.output.verdict;
    last_findings = rr.output.findings_path;

    if last_verdict == "green" {
        break;
    }
    if last_verdict == "blocked" {
        complete(#{ ok: false, stage: "review", round: round, verdict: "blocked", findings: last_findings });
    }

    let need_v = false;
    if rr.output.need_verify != () { need_v = rr.output.need_verify; }
    if last_verdict == "need_verify" { need_v = true; }

    if need_v {
        let test_prompt = "";
        test_prompt += "Active task: " + task_path + "\n";
        test_prompt += "You are trellis-verify (investigative verifier). Read the Verify mission in findings; answer its questions with evidence.\n";
        test_prompt += "Write a RICH review/verify-" + round.to_string() + ".md (mission answers, actions, findings_for_reviewer V*, unanswered) — not pass/fail only.\n";
        test_prompt += "Findings path: " + last_findings + "\n";
        test_prompt += "Prefer selective/package-scoped commands. Return JSON: mission_status, verify_path, summary_for_reviewer, highlights.\n";
        let tr = agent(test_prompt, #{
            label: "trellis-verify-" + round.to_string(),
            agent_type: "trellis-verify",
            capability_mode: "all",
            output_schema: verify_schema,
        });
        if tr == () || !tr.success {
            complete(#{ ok: false, stage: "test", round: round, error: "test failed" });
        }
        // resume review with verify evidence
        let rev2_prompt = "";
        rev2_prompt += "Active task: " + task_path + "\n";
        rev2_prompt += "Continue review using the FULL verify report (not pass/fail only). Verify path: " + tr.output.verify_path + "\n";
        rev2_prompt += "Ingest V* findings and mission answers; update findings. Return same JSON schema; green if no open blocker/major.\n";
        let rr2 = agent(rev2_prompt, #{
            label: "trellis-review-after-test-" + round.to_string(),
            agent_type: "trellis-review",
            capability_mode: "read-write",
            output_schema: review_schema,
            resume_from: review_id,
        });
        if rr2 == () || !rr2.success {
            complete(#{ ok: false, stage: "review-after-test", round: round, error: "review failed" });
        }
        review_id = rr2.agent_id;
        last_verdict = rr2.output.verdict;
        last_findings = rr2.output.findings_path;
        if last_verdict == "green" {
            break;
        }
    }

    if last_verdict == "need_fix" || last_verdict != "green" {
        let fix_prompt = "";
        fix_prompt += "Active task: " + task_path + "\n";
        fix_prompt += "You are trellis-fix. Read findings and apply minimal fixes only.\n";
        fix_prompt += "Findings path: " + last_findings + "\n";
        fix_prompt += "If same class thrashing, load trellis-break-loop skill and write review/break-loop-*.md.\n";
        fix_prompt += "No commit. Return JSON: addressed, summary.\n";
        let fr = agent(fix_prompt, #{
            label: "trellis-fix-" + round.to_string(),
            agent_type: "trellis-fix",
            capability_mode: "all",
            output_schema: fix_schema,
        });
        if fr == () || !fr.success {
            complete(#{ ok: false, stage: "fix", round: round, error: "fix failed" });
        }
    }

    round += 1;
}

if last_verdict != "green" {
    complete(#{
        ok: false,
        stage: "quality",
        error: "max quality rounds without green",
        rounds: max_rounds,
        verdict: last_verdict,
        findings: last_findings,
    });
}

// --- Closeout ---
phase("Closeout");
let close_prompt = "";
close_prompt += "Active task: " + task_path + "\n";
close_prompt += "You are trellis-closeout. Load trellis-update-spec; write closeout-summary.md with commit_subject.\n";
close_prompt += "No product features. No git commit/merge.\n";
close_prompt += "Return JSON: summary, commit_subject, spec_updated.\n";
let cr = agent(close_prompt, #{
    label: "trellis-closeout",
    agent_type: "trellis-closeout",
    capability_mode: "read-write",
    output_schema: close_schema,
});
if cr == () || !cr.success {
    complete(#{ ok: false, stage: "closeout", error: "closeout failed", findings: last_findings });
}

complete(#{
    ok: true,
    task_path: task_path,
    quality_rounds: round,
    findings: last_findings,
    closeout: cr.output,
    next_orchestrator_steps: "On task branch: commit using commit_subject; checkout main; merge task branch; continue outer loop if goal unfinished.",
});
