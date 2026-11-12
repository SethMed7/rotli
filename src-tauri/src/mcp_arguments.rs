//! Every MCP tool call is held to the input schema its tool advertises, before
//! the tool runs, on both stdio servers (`rotli-workspace` and the Librarian
//! route) and the loopback adapter, which all answer through
//! `workspace::handle_mcp_with`. The schemas are the contract a host shows its
//! model; until this check they were only advice (review 2026-11-09, #8).
//!
//! Only the JSON Schema keywords Rotli's tool schemas use are implemented, and
//! a test walks every tool of both servers to fail on any other keyword, so a
//! limit can't be advertised without being enforced.

use serde_json::Value;

/// The keywords this checker enforces (`description` is prose for the model).
#[cfg(test)]
pub(crate) const KEYWORDS: &[&str] = &[
    "type",
    "properties",
    "required",
    "additionalProperties",
    "maxLength",
    "minLength",
    "enum",
    "minimum",
    "maximum",
    "items",
    "minItems",
    "maxItems",
    "description",
];

/// The `type` values this checker knows.
#[cfg(test)]
pub(crate) const TYPES: &[&str] = &["object", "array", "string", "integer", "number", "boolean"];

/// Check `arguments` against the schema of the tool called `name` in `tools`.
/// A name no tool has is left to the server, which answers "unknown tool".
/// Missing arguments (JSON null) are an empty object, as MCP allows.
pub(crate) fn check(tools: &[Value], name: &str, arguments: &Value) -> Result<(), String> {
    let Some(schema) = tools.iter().find(|tool| tool["name"] == name).and_then(|tool| tool.get("inputSchema")) else {
        return Ok(());
    };
    let empty = Value::Object(Default::default());
    let arguments = if arguments.is_null() { &empty } else { arguments };
    if !arguments.is_object() {
        return Err(format!("{name}: arguments must be a JSON object"));
    }
    check_value(schema, arguments, "").map_err(|why| format!("{name}: {why}"))
}

fn named(at: &str) -> &str {
    if at.is_empty() { "arguments" } else { at }
}

fn child(at: &str, key: &str) -> String {
    if at.is_empty() { key.to_string() } else { format!("{at}.{key}") }
}

fn check_value(schema: &Value, value: &Value, at: &str) -> Result<(), String> {
    let what = named(at);
    if let Some(kind) = schema.get("type") {
        let fits = match kind.as_str() {
            Some("object") => value.is_object(),
            Some("array") => value.is_array(),
            Some("string") => value.is_string(),
            Some("boolean") => value.is_boolean(),
            Some("number") => value.is_number(),
            Some("integer") => value.is_i64() || value.is_u64() || value.as_f64().is_some_and(|n| n.fract() == 0.0),
            // a type this checker doesn't know refuses rather than passing unchecked
            _ => false,
        };
        if !fits {
            return Err(format!("{what} must be of type {kind}"));
        }
    }
    if let Some(allowed) = schema.get("enum").and_then(Value::as_array) {
        if !allowed.contains(value) {
            let names: Vec<String> = allowed.iter().map(|v| v.to_string()).collect();
            return Err(format!("{what} must be one of {}", names.join(", ")));
        }
    }
    if let Some(text) = value.as_str() {
        let length = text.chars().count() as u64;
        if let Some(max) = schema.get("maxLength").and_then(Value::as_u64) {
            if length > max {
                return Err(format!("{what} must be at most {max} characters"));
            }
        }
        if let Some(min) = schema.get("minLength").and_then(Value::as_u64) {
            if length < min {
                return Err(format!("{what} must be at least {min} characters"));
            }
        }
    }
    if let Some(number) = value.as_f64().filter(|_| value.is_number()) {
        if let Some(max) = schema.get("maximum").and_then(Value::as_f64) {
            if number > max {
                return Err(format!("{what} must be at most {}", schema["maximum"]));
            }
        }
        if let Some(min) = schema.get("minimum").and_then(Value::as_f64) {
            if number < min {
                return Err(format!("{what} must be at least {}", schema["minimum"]));
            }
        }
    }
    if let Some(items) = value.as_array() {
        if let Some(max) = schema.get("maxItems").and_then(Value::as_u64) {
            if items.len() as u64 > max {
                return Err(format!("{what} must have at most {max} items"));
            }
        }
        if let Some(min) = schema.get("minItems").and_then(Value::as_u64) {
            if (items.len() as u64) < min {
                return Err(format!("{what} must have at least {min} items"));
            }
        }
        if let Some(item) = schema.get("items") {
            for (index, value) in items.iter().enumerate() {
                check_value(item, value, &format!("{what}[{index}]"))?;
            }
        }
    }
    if let Some(object) = value.as_object() {
        let properties = schema.get("properties").and_then(Value::as_object);
        if schema.get("additionalProperties") == Some(&Value::Bool(false)) {
            if let Some(extra) = object.keys().find(|key| !properties.is_some_and(|known| known.contains_key(*key))) {
                return Err(format!("{} is not an argument this tool takes", child(at, extra)));
            }
        }
        for (key, property) in properties.into_iter().flatten() {
            if let Some(value) = object.get(key) {
                check_value(property, value, &child(at, key))?;
            }
        }
        for key in schema.get("required").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
            if !object.contains_key(key) {
                return Err(format!("{} is required", child(at, key)));
            }
        }
    }
    Ok(())
}

/// Every keyword in `schema` and its sub-schemas that this checker doesn't
/// enforce, and every `type` it doesn't know, as `path: keyword`.
#[cfg(test)]
pub(crate) fn unenforced(schema: &Value, at: &str) -> Vec<String> {
    let mut out = Vec::new();
    let Some(object) = schema.as_object() else {
        return vec![format!("{at}: not a schema object")];
    };
    for (key, value) in object {
        if !KEYWORDS.contains(&key.as_str()) {
            out.push(format!("{at}: {key}"));
        }
        if key == "type" && !value.as_str().is_some_and(|kind| TYPES.contains(&kind)) {
            out.push(format!("{at}: type {value}"));
        }
    }
    if let Some(properties) = object.get("properties").and_then(Value::as_object) {
        for (key, property) in properties {
            out.extend(unenforced(property, &format!("{at}.{key}")));
        }
    }
    if let Some(item) = object.get("items") {
        out.extend(unenforced(item, &format!("{at}[]")));
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn tools(schema: Value) -> Vec<Value> {
        vec![json!({ "name": "t", "inputSchema": schema })]
    }

    #[test]
    fn each_keyword_refuses_what_it_should() {
        let schema = json!({"type":"object","properties":{
            "s":{"type":"string","minLength":1,"maxLength":3},
            "n":{"type":"integer","minimum":1,"maximum":5},
            "e":{"type":"string","enum":["a","b"]},
            "b":{"type":"boolean"},
            "list":{"type":"array","minItems":1,"maxItems":2,"items":{"type":"object","properties":{"x":{"type":"string","maxLength":2}},"required":["x"],"additionalProperties":false}}
        },"required":["s"],"additionalProperties":false});
        let t = tools(schema);
        assert_eq!(check(&t, "t", &json!({"s":"abc"})), Ok(()));
        assert_eq!(check(&t, "t", &json!({"s":"abc","n":5.0,"e":"b","b":true,"list":[{"x":"ok"}]})), Ok(()));
        for (arguments, expected) in [
            (json!({}), "s is required"),
            (json!({"s":""}), "s must be at least 1 characters"),
            (json!({"s":"abcd"}), "s must be at most 3 characters"),
            (json!({"s":"ééé"}), ""),
            (json!({"s":"a","n":6}), "n must be at most 5"),
            (json!({"s":"a","n":0}), "n must be at least 1"),
            (json!({"s":"a","n":1.5}), "n must be of type"),
            (json!({"s":"a","n":"1"}), "n must be of type"),
            (json!({"s":"a","e":"c"}), "e must be one of"),
            (json!({"s":"a","b":"true"}), "b must be of type"),
            (json!({"s":"a","list":[]}), "list must have at least 1 items"),
            (json!({"s":"a","list":[{"x":"a"},{"x":"b"},{"x":"c"}]}), "list must have at most 2 items"),
            (json!({"s":"a","list":[{"x":"abc"}]}), "list[0].x must be at most 2 characters"),
            (json!({"s":"a","list":[{"x":"a","y":1}]}), "list[0].y is not an argument"),
            (json!({"s":"a","list":[{}]}), "list[0].x is required"),
            (json!({"s":"a","extra":1}), "extra is not an argument"),
            (json!({"s":null}), "s must be of type"),
        ] {
            let result = check(&t, "t", &arguments);
            if expected.is_empty() {
                assert_eq!(result, Ok(()), "{arguments}: characters, not bytes");
            } else {
                assert!(result.as_ref().is_err_and(|why| why.contains(expected)), "{arguments}: {result:?}");
            }
        }
    }

    #[test]
    fn arguments_must_be_an_object_and_unknown_tools_pass_to_the_server() {
        let t = tools(json!({"type":"object","properties":{},"additionalProperties":false}));
        assert_eq!(check(&t, "t", &Value::Null), Ok(()), "missing arguments are an empty object");
        assert!(check(&t, "t", &json!("x")).unwrap_err().contains("arguments must be a JSON object"));
        assert!(check(&t, "t", &json!([])).is_err());
        assert_eq!(check(&t, "other", &json!({"anything": 1})), Ok(()));
    }

    #[test]
    fn a_type_the_checker_does_not_know_refuses() {
        let t = tools(json!({"type":"object","properties":{"v":{"type":"null"}}}));
        assert!(check(&t, "t", &json!({"v": null})).is_err());
        let mut found = unenforced(&json!({"type":"object","properties":{"v":{"type":"null","pattern":"x"}}}), "t");
        found.sort();
        assert_eq!(found, ["t.v: pattern", "t.v: type \"null\""]);
    }
}
