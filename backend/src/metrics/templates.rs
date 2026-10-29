/// Build a WarpScript that fetches the raw points for CPU user% and memory used%
/// for each provided id, tagged by `label_name` (e.g. `"app_id"` or `"addon_id"`).
///
/// Output is an array of GTS lists (2 per id — one for cpu, one for mem) that a
/// single call to `split_cpu_ram` with the matching label can parse. The Rust
/// parser takes the last raw point of each series.
pub fn cpu_ram_last_script(token: &str, label_name: &str, ids: &[String]) -> String {
    // Fetch the last 5 minutes of RAW points and let the Rust parser pick
    // the most recent one. No BUCKETIZE — we tried:
    //   - bucketizer.mean / 60s: 3-5 min lag on a drop from 100% to 0%,
    //     because a partially-post-drop bucket averaged old and new samples.
    //   - bucketizer.last / 30s: worse — CC publishes every 60s and half
    //     of our 30s buckets were empty by construction, so `points.last()`
    //     hit an empty bucket and emitted 0% even when the previous bucket
    //     (still within our 5-min window) held the real value.
    // Simpler is better here: the merged timeline's last raw point IS the
    // freshest value CC has published. If CC goes silent for >5 min we
    // return nothing (frontend keeps the last known value).
    //
    // MERGE is essential: when an app/addon has multiple instances (a
    // restart, a scale-out, a migration), FETCH returns one GTS per
    // instance. MERGE flattens them into a single chronologically-ordered
    // GTS so `last` means "most recent across all instances". RENAME keeps
    // the class name after MERGE (which otherwise strips it).
    let mut script = String::new();
    for id in ids {
        script.push_str(&format!(
            "[ '{token}' 'cpu.usage_user' {{ '{label}' '{id}' }} NOW 5 m ] FETCH\n\
             MERGE 'cpu.usage_user' RENAME\n\
             [ '{token}' 'mem.used_percent' {{ '{label}' '{id}' }} NOW 5 m ] FETCH\n\
             MERGE 'mem.used_percent' RENAME\n",
            token = token,
            label = label_name,
            id = id
        ));
    }
    script
}

/// Split a CPU+RAM GTS response into `{ id -> (cpu?, ram?) }`, where the id is read from the
/// `label_name` label of each GTS object (e.g. `"app_id"` for apps, `"addon_id"` for addons).
///
/// The Warp10 response nests arrays: `[ [gts_list_1], [gts_list_2], ... ]`. Each inner GTS object
/// has a class name in `c` (e.g. `"cpu.usage_user"`) and labels in `l`. We walk the tree and pick
/// the last numeric point for each known metric class per id.
pub fn split_cpu_ram(
    value: &serde_json::Value,
    label_name: &str,
) -> std::collections::HashMap<String, (Option<f32>, Option<f32>)> {
    use std::collections::HashMap;
    let mut out: HashMap<String, (Option<f32>, Option<f32>)> = HashMap::new();

    fn visit_gts(
        gts: &serde_json::Value,
        label_name: &str,
        out: &mut HashMap<String, (Option<f32>, Option<f32>)>,
    ) {
        let class = gts.get("c").and_then(|v| v.as_str()).unwrap_or("");
        let id = match gts
            .get("l")
            .and_then(|l| l.get(label_name))
            .and_then(|v| v.as_str())
        {
            Some(id) => id.to_string(),
            None => return,
        };
        let Some(points) = gts.get("v").and_then(|v| v.as_array()) else {
            return;
        };
        let Some(last) = points.last().and_then(|p| p.as_array()) else {
            return;
        };
        let Some(raw) = last.last() else { return };
        let v: f64 = match raw {
            serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0),
            serde_json::Value::String(s) => s.parse().unwrap_or(0.0),
            _ => return,
        };

        let entry = out.entry(id).or_insert((None, None));
        if class.starts_with("cpu.") {
            let prev = entry.0.unwrap_or(f32::MIN);
            entry.0 = Some(prev.max(v as f32));
        } else if class.starts_with("mem.") {
            let prev = entry.1.unwrap_or(f32::MIN);
            entry.1 = Some(prev.max(v as f32));
        }
    }

    fn walk(
        v: &serde_json::Value,
        label_name: &str,
        out: &mut HashMap<String, (Option<f32>, Option<f32>)>,
    ) {
        match v {
            serde_json::Value::Array(arr) => {
                for item in arr {
                    walk(item, label_name, out);
                }
            }
            serde_json::Value::Object(_) => visit_gts(v, label_name, out),
            _ => {}
        }
    }

    walk(value, label_name, &mut out);
    out
}
