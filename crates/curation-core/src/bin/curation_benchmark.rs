use std::collections::BTreeMap;
use std::fs;
use std::time::Instant;

use serde::Serialize;
use translunar_curation_core::{CurationPolicy, CurationUnit, analyze};

const UNIT_COUNT: usize = 10_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BenchmarkReport {
    unit_count: usize,
    finding_count: u32,
    term_candidate_count: u32,
    drift_group_count: u32,
    elapsed_ms: u64,
    peak_rss_kib: Option<u64>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let unit_count = i64::try_from(UNIT_COUNT)?;
    let units = (0..unit_count)
        .map(|ordinal| CurationUnit {
            id: format!("benchmark-unit-{ordinal:05}"),
            library_id: "benchmark-library".to_string(),
            source_locale: "en-US".to_string(),
            target_locale: "zh-CN".to_string(),
            source_text: format!(
                "Benchmark translation memory source record {ordinal:05} preserves stable legal context for deterministic analysis"
            ),
            target_text: format!("基准翻译记忆源记录 {ordinal:05} 为确定性分析保留稳定法律上下文"),
            domain: Some("benchmark".to_string()),
            origin_project_id: Some("benchmark-project".to_string()),
            origin_document_id: Some("benchmark-document".to_string()),
            origin_segment_id: Some(format!("benchmark-segment-{ordinal:05}")),
            author: Some("curation-benchmark".to_string()),
            metadata: BTreeMap::new(),
            created_at_ms: ordinal,
        })
        .collect::<Vec<_>>();

    let started = Instant::now();
    let analysis = analyze(&units, &CurationPolicy::default(), &[])?;
    let elapsed_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    if analysis.scores.len() != UNIT_COUNT
        || usize::try_from(analysis.summary.analyzed_units)? != UNIT_COUNT
    {
        return Err("curation benchmark did not analyze every fixture unit".into());
    }

    let report = BenchmarkReport {
        unit_count: UNIT_COUNT,
        finding_count: analysis.summary.finding_count,
        term_candidate_count: analysis.summary.term_candidate_count,
        drift_group_count: analysis.summary.drift_group_count,
        elapsed_ms,
        peak_rss_kib: peak_rss_kib(),
    };
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn peak_rss_kib() -> Option<u64> {
    let status = fs::read_to_string("/proc/self/status").ok()?;
    status.lines().find_map(|line| {
        let value = line.strip_prefix("VmHWM:")?.trim();
        value.split_whitespace().next()?.parse().ok()
    })
}
