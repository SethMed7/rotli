use super::*;

/// The shape Claude Code 2.1.280 answers `initialize` with, trimmed to the
/// fields discovery reads (the real reply also carries account details —
/// never needed, never copied into a fixture).
const CLAUDE_INIT: &str = r#"{"type":"control_response","response":{"subtype":"success","request_id":"rq-1","response":{"commands":[],"models":[
{"value":"default","resolvedModel":"claude-opus-5-5[1m]","displayName":"Default (recommended)","description":"Opus 5.5 with 1M context · Best for everyday, complex tasks","supportsEffort":true,"supportedEffortLevels":["low","medium","high","xhigh","max"]},
{"value":"opus[1m]","resolvedModel":"claude-opus-5-5[1m]","displayName":"Opus (1M context)","description":"Opus 5.5 with 1M context · Best for everyday, complex tasks","supportedEffortLevels":["low","medium","high","xhigh","max"]},
{"value":"claude-fable-5-1[1m]","resolvedModel":"claude-fable-5-1","displayName":"Fable","description":"Fable 5.1 · Most capable for your hardest and longest-running tasks","supportedEffortLevels":["low","medium","high","xhigh","max","turbo\"; rm -rf"]},
{"value":"sonnet","resolvedModel":"claude-sonnet-5","displayName":"Sonnet","description":"Sonnet 5 · Efficient for routine tasks","supportedEffortLevels":["low","medium","high","xhigh","max"]},
{"value":"haiku","resolvedModel":"claude-haiku-4-5-20251001","displayName":"Haiku","description":"Haiku 4.5 · Fastest for quick answers"},
{"value":"--dangerously-skip-permissions","displayName":"Evil","description":"x"}
]}}}"#;

#[test]
fn claude_initialize_lists_the_accounts_models_with_readable_labels() {
    assert!(parse_claude_initialize(r#"{"type":"system","subtype":"hook_started"}"#, "rq-1").is_none());
    assert!(parse_claude_initialize("not json", "rq-1").is_none());
    let other = CLAUDE_INIT.replace("rq-1", "rq-2");
    assert!(parse_claude_initialize(&other, "rq-1").is_none(), "another request's answer is not ours");

    let models = parse_claude_initialize(CLAUDE_INIT, "rq-1").unwrap().unwrap();
    let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["default", "opus[1m]", "claude-fable-5-1[1m]", "sonnet", "haiku"]);
    let labels: Vec<&str> = models.iter().map(|m| m.label.as_str()).collect();
    assert_eq!(
        labels,
        [
            "Claude Default · Opus 5.5 (1M context)",
            "Claude Opus 5.5 (1M context)",
            "Claude Fable 5.1",
            "Claude Sonnet 5",
            "Claude Haiku 4.5",
        ]
    );
    assert!(models[0].is_default && !models[1].is_default);
    assert_eq!(models[2].efforts, ["low", "medium", "high", "xhigh", "max"], "unknown efforts are dropped");
    assert!(models[4].efforts.is_empty(), "haiku reported no effort control");
    assert!(models.iter().all(|m| m.vision && !m.fast_tier));

    let refused = r#"{"type":"control_response","response":{"subtype":"error","request_id":"rq-1","error":"not signed in"}}"#;
    assert_eq!(parse_claude_initialize(refused, "rq-1").unwrap().unwrap_err(), "not signed in");
}

const CODEX_CACHE: &str = r#"{"fetched_at":"2026-09-23T12:51:20Z","client_version":"0.155.1","models":[
{"slug":"gpt-6-sol","display_name":"GPT-6-Sol","visibility":"list","priority":2,"input_modalities":["text","image"],"supported_reasoning_levels":[{"effort":"low"},{"effort":"ultra"}],"additional_speed_tiers":["fast"]},
{"slug":"gpt-6-astra","display_name":"GPT-6-Astra","visibility":"list","priority":1,"input_modalities":["text","image"],"supported_reasoning_levels":[{"effort":"medium"},{"effort":"max"},{"effort":"\" -c evil=1"}],"additional_speed_tiers":["fast"]},
{"slug":"gpt-reserve","display_name":"GPT-Reserve","visibility":"hide","priority":3},
{"slug":"gpt-5.5","display_name":"GPT-5.5","visibility":"list","priority":12,"input_modalities":["text"],"supported_reasoning_levels":[{"effort":"high"}]},
{"slug":"-c","display_name":"Flag","visibility":"list","priority":0}
]}"#;

#[test]
fn codex_cache_lists_visible_models_in_priority_order() {
    let models = parse_codex_cache(CODEX_CACHE).unwrap();
    let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["gpt-6-astra", "gpt-6-sol", "gpt-5.5"], "hidden and malformed ids are skipped");
    assert_eq!(models[0].label, "GPT-6 Astra");
    assert_eq!(models[2].label, "GPT-5.5");
    assert_eq!(models[0].efforts, ["medium", "max"], "an effort outside the vocabulary never survives");
    assert!(models[0].fast_tier && !models[2].fast_tier);
    assert!(models[0].vision && !models[2].vision);
    assert!(parse_codex_cache("{}").is_err());
    assert!(parse_codex_cache(r#"{"models":[]}"#).is_err(), "an empty list is a failure, not a lane with nothing");
    assert_eq!(codex_label("GPT-5.3-Codex-Spark", "x"), "GPT-5.3 Codex Spark");
}

#[test]
fn codex_cache_reads_are_bounded_and_explain_a_missing_file() {
    let dir = tempfile::tempdir().unwrap();
    let missing = read_codex_cache(&dir.path().join("models_cache.json")).unwrap_err();
    assert!(missing.contains("open Codex once"));
    let path = dir.path().join("models_cache.json");
    std::fs::write(&path, CODEX_CACHE).unwrap();
    assert_eq!(read_codex_cache(&path).unwrap().len(), 3);
}

#[test]
fn cursor_models_parse_strictly_and_map_auto_to_the_stable_id() {
    let text = "Available models\n\nauto - Auto (default)\n\u{1b}[1mcomposer-2.5\u{1b}[0m - Composer 2.5\ngrok-4.7-low-fast - Grok 4.7  Low Fast\u{200b}\u{200b}\n--yolo - Evil\nno dash here\n\nTip: use --model <id> (or /model <id> in interactive mode) to switch.\n";
    let models = parse_cursor_models(text).unwrap();
    let ids: Vec<&str> = models.iter().map(|m| m.id.as_str()).collect();
    assert_eq!(ids, ["cursor-auto", "composer-2.5", "grok-4.7-low-fast"]);
    assert!(models[0].is_default);
    assert_eq!(models[0].label, "Auto (default)");
    assert_eq!(models[2].label, "Grok 4.7 Low Fast", "invisible padding and double spaces are cleaned");
    assert!(models.iter().all(|m| !m.vision && m.efforts.is_empty()));
    assert!(parse_cursor_models("Please log in first.").is_err());
}

#[test]
fn antigravity_session_models_keep_names_and_the_current_value() {
    let session = serde_json::json!({
        "sessionId": "s",
        "configOptions": [{
            "id": "model",
            "currentValue": "gemini-3.8-flash-high",
            "options": [
                { "value": "gemini-3.8-flash-high", "name": "Gemini 3.8 Flash (High)" },
                { "name": "Legacy", "options": [{ "value": "gemini-3.7-flash-low", "name": "Gemini 3.7 Flash (Low)" }] }
            ]
        }]
    });
    let models = parse_acp_session_models(&session).unwrap();
    assert_eq!(models.len(), 2);
    assert_eq!(models[1].label, "Gemini 3.7 Flash (Low)");
    assert!(models[0].is_default && !models[1].is_default);
    assert!(parse_acp_session_models(&serde_json::json!({})).is_err());
}

#[test]
fn model_id_shape_refuses_flags_spaces_and_oversize() {
    for ok in ["sonnet", "opus[1m]", "claude-fable-5-1[1m]", "gpt-5.6-sol", "cursor_auto", "A1"] {
        assert!(valid_model_id(ok), "{ok}");
    }
    let long = "a".repeat(97);
    for bad in ["", "--help", "-m", "a b", "opus[2m]", "[1m]", "x;y", "x\"y", "é", long.as_str()] {
        assert!(!valid_model_id(bad), "{bad:?}");
    }
    assert!(valid_model_id(&"a".repeat(96)));
}

fn model(id: &str) -> DiscoveredModel {
    DiscoveredModel {
        id: id.into(),
        label: id.into(),
        efforts: Vec::new(),
        fast_tier: false,
        vision: false,
        is_default: false,
    }
}

#[test]
fn the_cache_reuses_fresh_lists_and_keeps_the_last_good_one_on_failure() {
    let cache = ModelCache::default();
    let mut calls = 0;
    let first = cache.get_or_fetch("codex", false, || {
        calls += 1;
        Ok(vec![model("gpt-6-sol")])
    });
    assert_eq!(first.unwrap().len(), 1);
    // fresh: no second fetch
    let again = cache.get_or_fetch("codex", false, || {
        calls += 1;
        Ok(vec![])
    });
    assert_eq!(again.unwrap()[0].id, "gpt-6-sol");
    assert_eq!(calls, 1);
    // a forced refresh that fails keeps the last good list — never evicts
    let failed = cache.get_or_fetch("codex", true, || Err("offline".into()));
    assert_eq!(failed.unwrap()[0].id, "gpt-6-sol");
    assert!(cache.lookup("codex", "gpt-6-sol").is_some());
    assert!(cache.lookup("codex", "gpt-7").is_none());
    assert!(cache.lookup("claude", "gpt-6-sol").is_none(), "lists never cross lanes");
    // and the failure is remembered: an ordinary ask does not re-spawn
    let quiet = cache.get_or_fetch("codex", false, || panic!("must not refetch inside the failure window"));
    assert!(quiet.is_ok());
}

#[test]
fn a_lane_that_never_listed_reports_its_error_and_is_not_respawned() {
    let cache = ModelCache::default();
    let err = cache.get_or_fetch("cursor", false, || Err("not signed in".into()));
    assert_eq!(err.unwrap_err(), "not signed in");
    let again = cache.get_or_fetch("cursor", false, || panic!("failure is cached"));
    assert_eq!(again.unwrap_err(), "not signed in");
    let now = Instant::now();
    assert!(matches!(cache.freshness("cursor", now + FAILED_FOR), Freshness::Stale));
}

#[test]
fn discovery_refuses_an_unknown_provider_before_any_spawn() {
    assert!(discover("gemini", false).unwrap_err().contains("unknown provider"));
    assert!(!ensure_allowed("gemini", "x"));
    // a static id needs no discovery; a malformed one never triggers any
    assert!(ensure_allowed("claude", "sonnet"));
    assert!(!ensure_allowed("claude", "--help"));
    assert!(!ensure_allowed("codex", "a b"));
}

#[test]
fn the_claude_discovery_spawn_keeps_the_chat_lanes_isolation() {
    for flag in ["-p", "--safe-mode", "--no-session-persistence"] {
        assert!(CLAUDE_DISCOVERY_ARGS.contains(&flag), "{flag}");
    }
    let tools = CLAUDE_DISCOVERY_ARGS.iter().position(|a| *a == "--tools").unwrap();
    assert_eq!(CLAUDE_DISCOVERY_ARGS[tools + 1], "", "every tool stays off");
    assert!(!CLAUDE_DISCOVERY_ARGS.iter().any(|a| a.contains("dangerously") || *a == "--model"));
}

/// Manual smoke against the real clients on this machine (read-only, no
/// prompt, no tokens): `cargo test --lib provider_models -- --ignored --nocapture`.
#[test]
#[ignore]
fn smoke_list_the_real_clients_on_this_machine() {
    for provider in ["claude", "codex", "cursor", "antigravity"] {
        let started = Instant::now();
        match discover(provider, true) {
            Ok(models) => {
                println!("{provider}: {} models in {:?}", models.len(), started.elapsed());
                for m in models {
                    println!(
                        "  {} — {}{} efforts={:?} fast={} vision={}",
                        m.id,
                        m.label,
                        if m.is_default { " (default)" } else { "" },
                        m.efforts,
                        m.fast_tier,
                        m.vision
                    );
                }
            }
            Err(e) => println!("{provider}: ERROR {e} after {:?}", started.elapsed()),
        }
    }
}

// ── the argv allowlist with discovery in the loop ─────────────────────────────

use crate::provider::build_args_for;

fn reported(id: &str, efforts: &[&str], fast_tier: bool) -> DiscoveredModel {
    DiscoveredModel {
        efforts: efforts.iter().map(|e| e.to_string()).collect(),
        fast_tier,
        ..model(id)
    }
}

#[test]
fn a_client_reported_id_is_runnable_and_an_unreported_one_is_not() {
    let nova = reported("gpt-7-nova", &["low", "ultra"], true);
    let (args, _) = build_args_for("codex", "gpt-7-nova", Some("ultra"), Some("fast"), None, Some(&nova)).unwrap();
    let at = args.iter().position(|a| a == "--model").unwrap();
    assert_eq!(args[at + 1], "gpt-7-nova");
    assert!(args.contains(&"model_reasoning_effort=\"ultra\"".to_string()));
    // the reported efforts are the whole policy for that model
    let high = build_args_for("codex", "gpt-7-nova", Some("high"), None, None, Some(&nova));
    assert!(high.unwrap_err().contains("reasoning effort"));
    // never reported → refused; reported for ANOTHER id → refused
    assert!(build_args_for("codex", "gpt-7-nova", None, None, None, None).unwrap_err().contains("allowlist"));
    let other = reported("gpt-7-other", &[], false);
    assert!(build_args_for("codex", "gpt-7-nova", None, None, None, Some(&other)).is_err());
}

#[test]
fn a_reported_id_of_the_wrong_shape_never_reaches_argv() {
    for bad in ["--help", "a b", "-c", "x\"y", "opus[2m]"] {
        let entry = reported(bad, &[], false);
        assert!(build_args_for("claude", bad, None, None, None, Some(&entry)).is_err(), "{bad}");
        assert!(build_args_for("cursor", bad, None, None, None, Some(&entry)).is_err(), "{bad}");
    }
    // an effort outside the vocabulary is refused even if "reported"
    let odd = reported("gpt-7-nova", &["turbo"], false);
    assert!(build_args_for("codex", "gpt-7-nova", Some("turbo"), None, None, Some(&odd)).is_err());
}

#[test]
fn claude_default_runs_without_a_model_flag_and_1m_ids_pass_verbatim() {
    let (args, _) = build_args_for("claude", "default", None, None, None, None).unwrap();
    assert!(!args.iter().any(|a| a == "--model"), "the account's default needs no flag");
    assert_eq!(&args[..4], ["-p", "--safe-mode", "--tools", ""]);
    let opus = reported("opus[1m]", &["low", "max"], false);
    let (args, _) = build_args_for("claude", "opus[1m]", Some("max"), None, None, Some(&opus)).unwrap();
    let at = args.iter().position(|a| a == "--model").unwrap();
    assert_eq!(args[at + 1], "opus[1m]");
    // haiku reported no effort control: an effort is refused
    let haiku = reported("haiku", &[], false);
    assert!(build_args_for("claude", "haiku", Some("low"), None, None, Some(&haiku)).is_err());
    // cursor ids the CLI reported run with --model, auto stays flagless
    let composer = reported("composer-2.5", &[], false);
    let (args, _) = build_args_for("cursor", "composer-2.5", None, None, None, Some(&composer)).unwrap();
    assert_eq!(args, ["--model", "composer-2.5", "--mode", "ask", "acp"]);
}

#[test]
fn static_effort_and_tier_rules_cover_the_built_in_ids() {
    assert!(effort_allowed("codex", "gpt-6-astra", "ultra", None));
    assert!(!effort_allowed("codex", "gpt-6-luna", "ultra", None));
    assert!(!effort_allowed("codex", "gpt-5.5", "max", None));
    assert!(effort_allowed("claude", "default", "xhigh", None));
    assert!(!effort_allowed("claude", "haiku", "low", None));
    assert!(!effort_allowed("cursor", "cursor-auto", "low", None));
    assert!(fast_tier_allowed("codex", "gpt-6-sol", None));
    assert!(!fast_tier_allowed("codex", "gpt-5.5", None));
    assert!(fast_tier_allowed("codex", "gpt-5.5", Some(&reported("gpt-5.5", &[], true))));
    assert!(!fast_tier_allowed("claude", "sonnet", None));
}
