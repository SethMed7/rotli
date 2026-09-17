//! `rotli://` links, validated before anything acts on them. Two hosts:
//!
//! - `rotli://open?id=…&kind=…` — open a note/board/file (the `rotli open`
//!   flow; the id resolves inside the corpus).
//! - `rotli://reveal?id=<relative file>&vault=<folder name>` — show a vault
//!   file in Finder. Rotli Web has no Finder to open (2026-09-17: "it should
//!   open the actual finder in the location of the file I am in"), so it hands
//!   the reveal to the installed app through this link. `vault` names the
//!   folder the page is connected to; the app reveals only when that is its
//!   own default vault, never another vault's file by mistake.
//!
//! Pure so the refusal law is unit-tested: ids only (ULID or in-corpus
//! relative path), `kind` from the open lane's allowlist, and hostile shapes
//! (absolute paths, traversal, control chars) are `None`.

#[derive(Debug, PartialEq, Eq)]
pub enum DeepLink {
    Open { id: String, kind: String },
    Reveal { rel: String, vault: Option<String> },
}

fn valid_id(id: &str) -> bool {
    // `..` only as a FULL path segment — `draft..final.md` is a legal filename
    // (review F2); backslashes and control chars stay refused outright.
    !id.is_empty()
        && id.len() <= 512
        && !id.starts_with('/')
        && !id.split('/').any(|seg| seg == "..")
        && !id.contains('\\')
        && !id.chars().any(char::is_control)
}

pub fn parse(url: &tauri::Url) -> Option<DeepLink> {
    if url.scheme() != "rotli" {
        return None;
    }
    let mut id = String::new();
    let mut kind = "note".to_string();
    let mut vault: Option<String> = None;
    for (k, v) in url.query_pairs() {
        match k.as_ref() {
            "id" => id = v.into_owned(),
            "kind" => kind = v.into_owned(),
            "vault" => vault = Some(v.into_owned()),
            _ => {}
        }
    }
    if !valid_id(&id) {
        return None;
    }
    match url.host_str() {
        Some("open") => {
            if !matches!(kind.as_str(), "note" | "board" | "file") {
                return None;
            }
            Some(DeepLink::Open { id, kind })
        }
        Some("reveal") => {
            let vault = vault.filter(|v| !v.is_empty() && v.len() <= 255 && !v.contains('/'));
            Some(DeepLink::Reveal { rel: id, vault })
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{parse, DeepLink};

    fn open(s: &str) -> Option<(String, String)> {
        match parse(&s.parse::<tauri::Url>().unwrap()) {
            Some(DeepLink::Open { id, kind }) => Some((id, kind)),
            _ => None,
        }
    }

    #[test]
    fn accepts_ulid_and_relative_path_ids_with_the_open_kinds() {
        assert_eq!(
            open("rotli://open?id=01J8Z9ABCDEF"),
            Some(("01J8Z9ABCDEF".into(), "note".into()))
        );
        assert_eq!(
            open("rotli://open?id=wiki%2Fprojects%2Fplan.md&kind=note"),
            Some(("wiki/projects/plan.md".into(), "note".into()))
        );
        assert_eq!(
            open("rotli://open?id=Board%2Fsketch.excalidraw&kind=board"),
            Some(("Board/sketch.excalidraw".into(), "board".into()))
        );
    }

    #[test]
    fn refuses_hostile_shapes_and_foreign_kinds() {
        assert_eq!(open("rotli://open"), None); // no id
        assert_eq!(open("rotli://open?id=%2Fetc%2Fpasswd"), None); // absolute
        assert_eq!(open("rotli://open?id=..%2F..%2Fsecrets.md"), None); // traversal
        assert_eq!(open("rotli://open?id=%2e%2e%2f%2e%2e%2fsecrets.md"), None);
        assert_eq!(open("rotli://open?id=wiki%2F..%2Fsecrets.md"), None); // mid-path segment
        assert_eq!(open("rotli://open?id=a&kind=chat"), None); // kind not in the lane
        assert_eq!(
            open("rotli://open?id=draft..final.md"),
            Some(("draft..final.md".into(), "note".into()))
        );
        assert_eq!(parse(&"https://open?id=a".parse::<tauri::Url>().unwrap()), None);
        assert_eq!(parse(&"rotli://elsewhere?id=a".parse::<tauri::Url>().unwrap()), None);
    }

    #[test]
    fn a_reveal_names_the_file_and_the_vault_it_came_from() {
        assert_eq!(
            parse(&"rotli://reveal?id=chats%2Fplan.md&vault=memex-vault".parse::<tauri::Url>().unwrap()),
            Some(DeepLink::Reveal { rel: "chats/plan.md".into(), vault: Some("memex-vault".into()) })
        );
        // no vault named: the default vault answers
        assert_eq!(
            parse(&"rotli://reveal?id=wiki%2Fa.md".parse::<tauri::Url>().unwrap()),
            Some(DeepLink::Reveal { rel: "wiki/a.md".into(), vault: None })
        );
        // a vault "name" that is a path is not a name
        assert_eq!(
            parse(&"rotli://reveal?id=wiki%2Fa.md&vault=..%2Fx".parse::<tauri::Url>().unwrap()),
            Some(DeepLink::Reveal { rel: "wiki/a.md".into(), vault: None })
        );
        assert_eq!(parse(&"rotli://reveal?id=%2Fetc%2Fpasswd".parse::<tauri::Url>().unwrap()), None);
    }
}
