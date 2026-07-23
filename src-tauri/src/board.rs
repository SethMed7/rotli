//! Shared Excalidraw resource boundary for GUI, CLI, and MCP writes.

use serde_json::Value;

pub(crate) const BOARD_MAX_BYTES: usize = 8_000_000;
pub(crate) const BOARD_MAX_ELEMENTS: usize = 10_000;
pub(crate) const BOARD_MAX_ACTIONS: usize = 500;
pub(crate) const BOARD_MAX_STRING_CHARS: usize = 100_000;
pub(crate) const BOARD_MAX_COORDINATE: f64 = 10_000_000.0;
pub(crate) const BOARD_MAX_FILES: usize = 1_000;
pub(crate) const BOARD_MAX_DEPTH: usize = 64;
pub(crate) const BOARD_MAX_NODES: usize = 200_000;

pub(crate) fn validate_scene(raw: &str) -> Result<Value, String> {
    if raw.len() > BOARD_MAX_BYTES {
        return Err("board exceeds the 8 MB safety limit".into());
    }
    let value: Value =
        serde_json::from_str(raw).map_err(|error| format!("invalid board JSON: {error}"))?;
    let object = value.as_object().ok_or("board root must be an object")?;
    if object.get("type").and_then(Value::as_str) != Some("excalidraw") {
        return Err("board type must be excalidraw".into());
    }
    let elements = object
        .get("elements")
        .and_then(Value::as_array)
        .ok_or("board elements must be an array")?;
    if elements.len() > BOARD_MAX_ELEMENTS {
        return Err("board has too many elements".into());
    }
    if elements.iter().any(|element| !element.is_object()) {
        return Err("board elements must be objects".into());
    }
    if object
        .get("appState")
        .is_some_and(|value| !value.is_object())
    {
        return Err("board appState must be an object".into());
    }
    if let Some(files) = object.get("files") {
        let files = files.as_object().ok_or("board files must be an object")?;
        if files.len() > BOARD_MAX_FILES {
            return Err("board has too many embedded files".into());
        }
    }
    if let Some(metadata) = object.get("rotliMeta") {
        let metadata = metadata
            .as_object()
            .ok_or("board rotliMeta must be an object")?;
        for field in ["description", "tags"] {
            if metadata.get(field).is_some_and(|value| !value.is_string()) {
                return Err(format!("board rotliMeta {field} must be a string"));
            }
        }
    }
    let mut nodes = 0;
    validate_value(&value, 0, &mut nodes)?;
    Ok(value)
}

fn validate_value(value: &Value, depth: usize, nodes: &mut usize) -> Result<(), String> {
    if depth > BOARD_MAX_DEPTH {
        return Err("board data is nested too deeply".into());
    }
    *nodes += 1;
    if *nodes > BOARD_MAX_NODES {
        return Err("board has too much nested data".into());
    }
    match value {
        Value::String(text) if text.chars().count() > BOARD_MAX_STRING_CHARS => {
            return Err("board contains a string that is too long".into());
        }
        Value::Array(values) => {
            for child in values {
                validate_value(child, depth + 1, nodes)?;
            }
        }
        Value::Object(values) => {
            for (key, child) in values {
                if key.chars().count() > 256 {
                    return Err("board contains an invalid field name".into());
                }
                if matches!(key.as_str(), "x" | "y" | "width" | "height") {
                    if let Some(number) = child.as_f64() {
                        if !number.is_finite() || number.abs() > BOARD_MAX_COORDINATE {
                            return Err(
                                "board contains a coordinate outside the supported range".into()
                            );
                        }
                    }
                }
                if key == "points" {
                    validate_points(child)?;
                }
                validate_value(child, depth + 1, nodes)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_points(value: &Value) -> Result<(), String> {
    let Some(points) = value.as_array() else {
        return Ok(());
    };
    for point in points {
        let Some(coordinates) = point.as_array() else {
            continue;
        };
        for coordinate in coordinates {
            if let Some(number) = coordinate.as_f64() {
                if !number.is_finite() || number.abs() > BOARD_MAX_COORDINATE {
                    return Err("board contains a coordinate outside the supported range".into());
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_scene_shape_and_resource_limits() {
        assert!(validate_scene(r#"{"type":"excalidraw","elements":[],"files":{}}"#).is_ok());
        assert!(validate_scene("{}").is_err());
        assert!(validate_scene(
            &json!({"type":"excalidraw","elements":[{"x": BOARD_MAX_COORDINATE + 1.0}]})
                .to_string()
        )
        .is_err());
        assert!(validate_scene(
            &json!({"type":"excalidraw","elements":[{"points": [[0, BOARD_MAX_COORDINATE + 1.0]]}]})
                .to_string()
        )
        .is_err());
        assert!(validate_scene(
            &json!({"type":"excalidraw","elements":[{"text": "x".repeat(BOARD_MAX_STRING_CHARS + 1)}]}).to_string()
        )
        .is_err());
    }
}
