# 100k Storage Capacity Evidence

Date: 2026-07-19

Environment: `moehub`, Linux x86_64, Rust release profile.

Command:

```bash
cargo run -p translunar-storage --bin storage-benchmark --release
```

The command creates a disposable SQLite workspace by streaming 100,000 segment
rows and 100,000 operation rows through prepared statements. It then reopens
the workspace through `Store`, reads aggregate counts, and requests bounded
first/middle/last segment pages plus a bounded middle history page. It does not
call `all_segments`, and it removes the generated workspace after measurement.

Result:

```json
{
  "segmentCount": 100000,
  "historyCount": 100000,
  "coldOpenMs": 0,
  "projectCountMs": 51,
  "firstPageMs": 5,
  "middlePageMs": 8,
  "lastPageMs": 11,
  "historyPageMs": 13,
  "peakRssKib": 6436,
  "retainedDirectory": null
}
```

Interpretation: the tested queries stay paged and the observed process peak
was 6.3 MiB. These timings are evidence from this VPS run, not CI thresholds.
