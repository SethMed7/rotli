//! Pure parser and evaluator for the portable memex query grammar.
//!
//! `QUERY.md` in the memex foundation owns the public syntax. This module has
//! no filesystem access: workspace adapters build records only after their
//! access and secure-content gates have passed.

use std::collections::BTreeMap;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QueryClause {
    pub field: String,
    pub operator: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ParsedQuery {
    pub source: String,
    pub clauses: Vec<QueryClause>,
}

const DATE_FIELDS: [&str; 2] = ["created", "updated"];

fn canonical_field(field: &str) -> Option<&'static str> {
    Some(match field {
        "id" => "id",
        "title" => "title",
        "file" | "filename" => "filename",
        "path" => "path",
        "alias" | "aliases" => "aliases",
        "owner" => "owner",
        "shelf" => "shelf",
        "reach" => "reach",
        "area" => "area",
        "summary" => "summary",
        "tag" | "tags" => "tags",
        "link" | "links" => "links",
        "view" | "view_tag" => "view_tag",
        "created" => "created",
        "updated" => "updated",
        "pinned" => "pinned",
        "locked" => "locked",
        "text" => "text",
        _ => return None,
    })
}

fn tokenize(source: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut token = String::new();
    let mut quote = None;
    let mut escaped = false;
    for character in source.trim().chars() {
        if escaped {
            token.push(character);
            escaped = false;
        } else if character == '\\' {
            escaped = true;
        } else if let Some(expected) = quote {
            if character == expected {
                quote = None;
            } else {
                token.push(character);
            }
        } else if matches!(character, '"' | '\'') {
            quote = Some(character);
        } else if character.is_whitespace() {
            if !token.is_empty() {
                out.push(std::mem::take(&mut token));
            }
        } else {
            token.push(character);
        }
    }
    if escaped {
        token.push('\\');
    }
    if quote.is_some() {
        return Err("unterminated quote in query".into());
    }
    if !token.is_empty() {
        out.push(token);
    }
    Ok(out)
}

fn split_operator(raw: &str) -> (&'static str, &str) {
    for operator in [">=", "<=", "!=", "=", "~", ">", "<"] {
        if let Some(value) = raw.strip_prefix(operator) {
            return (operator, value);
        }
    }
    ("=", raw)
}

fn valid_iso_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes
            .iter()
            .enumerate()
            .all(|(index, value)| matches!(index, 4 | 7) || value.is_ascii_digit())
    {
        return false;
    }
    let month = value[5..7].parse::<u8>().unwrap_or_default();
    let day = value[8..10].parse::<u8>().unwrap_or_default();
    (1..=12).contains(&month) && (1..=31).contains(&day)
}

pub fn parse_query(source: &str) -> Result<ParsedQuery, String> {
    let tokens = tokenize(source)?;
    if tokens.is_empty() {
        return Err("query must contain at least one clause".into());
    }
    let mut clauses = Vec::with_capacity(tokens.len());
    for token in tokens {
        let Some((input_field, raw_value)) = token.split_once(':') else {
            clauses.push(QueryClause {
                field: "text".into(),
                operator: "~".into(),
                value: token,
            });
            continue;
        };
        if input_field.is_empty() {
            return Err("a query field must not be empty".into());
        }
        let input_field = input_field.to_lowercase();
        let field = canonical_field(&input_field)
            .ok_or_else(|| format!("unknown query field: {input_field}"))?;
        let (mut operator, value) = split_operator(raw_value);
        let value = value.trim();
        if value.is_empty() {
            return Err(format!("query field {input_field} needs a value"));
        }
        if matches!(operator, ">" | ">=" | "<" | "<=") && !DATE_FIELDS.contains(&field) {
            return Err("ordering is supported only for created and updated".into());
        }
        if DATE_FIELDS.contains(&field) && !valid_iso_date(value) {
            return Err(format!("{field} needs an ISO YYYY-MM-DD value"));
        }
        if field == "text" && operator == "=" {
            operator = "~";
        }
        clauses.push(QueryClause {
            field: field.into(),
            operator: operator.into(),
            value: value.into(),
        });
    }
    Ok(ParsedQuery {
        source: source.into(),
        clauses,
    })
}

fn folded(value: &str) -> String {
    value.to_lowercase()
}

fn clause_matches(values: &[String], clause: &QueryClause) -> bool {
    let expected = folded(&clause.value);
    let equal = values.iter().any(|value| folded(value) == expected);
    match clause.operator.as_str() {
        "=" => equal,
        "!=" => !equal,
        "~" => values.iter().any(|value| folded(value).contains(&expected)),
        ">" => values.first().is_some_and(|value| value > &clause.value),
        ">=" => values.first().is_some_and(|value| value >= &clause.value),
        "<" => values.first().is_some_and(|value| value < &clause.value),
        "<=" => values.first().is_some_and(|value| value <= &clause.value),
        _ => false,
    }
}

pub fn record_matches(fields: &BTreeMap<String, Vec<String>>, query: &ParsedQuery) -> bool {
    query.clauses.iter().all(|clause| {
        clause_matches(
            fields.get(&clause.field).map(Vec::as_slice).unwrap_or(&[]),
            clause,
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_aliases_phrases_and_dates() {
        assert_eq!(
            parse_query(r#"tag:payments updated:>=2026-07-01 "launch plan""#)
                .unwrap()
                .clauses,
            vec![
                QueryClause {
                    field: "tags".into(),
                    operator: "=".into(),
                    value: "payments".into(),
                },
                QueryClause {
                    field: "updated".into(),
                    operator: ">=".into(),
                    value: "2026-07-01".into(),
                },
                QueryClause {
                    field: "text".into(),
                    operator: "~".into(),
                    value: "launch plan".into(),
                },
            ]
        );
    }

    #[test]
    fn rejects_typos_unsupported_ordering_and_bad_dates() {
        assert!(parse_query("tage:payments")
            .unwrap_err()
            .contains("unknown query field"));
        assert!(parse_query("area:>projects")
            .unwrap_err()
            .contains("ordering is supported only"));
        assert!(parse_query("updated:2026-19-99")
            .unwrap_err()
            .contains("ISO YYYY-MM-DD"));
        assert!(parse_query("\"open phrase")
            .unwrap_err()
            .contains("unterminated quote"));
    }

    #[test]
    fn evaluates_scalar_list_substring_negation_and_date_clauses() {
        let fields = BTreeMap::from([
            ("area".into(), vec!["projects".into()]),
            ("tags".into(), vec!["payments".into(), "privacy".into()]),
            ("updated".into(), vec!["2026-07-20".into()]),
            ("text".into(), vec!["Payments launch plan".into()]),
        ]);
        assert!(record_matches(
            &fields,
            &parse_query(
                r#"area:projects tag:payments tag:!=draft updated:>=2026-07-01 "launch plan""#
            )
            .unwrap()
        ));
        assert!(!record_matches(
            &fields,
            &parse_query("tag:models").unwrap()
        ));
    }
}
