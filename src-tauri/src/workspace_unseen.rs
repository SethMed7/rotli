//! An agent never learns whether a protected item exists
//! (docs/architecture/egress-threat-model.md, row 16k). Every id an agent
//! names is admitted here before any tool reads, judges, or writes it: an
//! item that is protected (`protected_path`, in any spelling), hidden from
//! agents, refused by the remote read gate, or simply not there gets the one
//! answer a missing note gets. A folder an agent names as a target or a
//! parent is refused when the path rule protects it, whether it exists or not.

use super::*;

/// The one refusal for a folder an agent may not name.
pub(super) fn folder_unavailable(folder: &str) -> String {
    format!("folder not available to agents: {folder}")
}

impl Workspace {
    /// The workspace and local id for an item an agent named, admitted.
    pub(super) fn open_for_visible(item_id: &str, requested_root: Option<&str>) -> Result<(Self, String), String> {
        let (mut workspace, local) = Self::open_for_item(item_id, requested_root)?;
        workspace.admit(&local)?;
        Ok((workspace, local))
    }

    /// Ok when an agent may see the item `local_id` names; else the answer a
    /// missing note gets, word for word.
    pub(super) fn admit(&mut self, local_id: &str) -> Result<(), String> {
        if self.store.names_protected_path(local_id) || !self.reference_visible_to_remote(local_id) {
            return Err(crate::corpus::note_not_found(local_id));
        }
        Ok(())
    }

    /// Ok when a Main item an agent names is one `rotli_list_main` shows it:
    /// a Main folder, or a reference it may see. A hidden reference answers
    /// as an item Main doesn't hold.
    pub(super) fn main_item_shown(&mut self, item_id: &str) -> Result<(), String> {
        if !item_id.starts_with(MAIN_ROOT) && !self.reference_visible_to_remote(item_id) {
            return Err(format!("Main item not found: {item_id}"));
        }
        Ok(())
    }

    /// Ok when an agent may name `folder` as a target or a parent.
    pub(super) fn admit_folder(&mut self, folder: &str) -> Result<(), String> {
        if self.store.names_protected_path(folder) {
            return Err(folder_unavailable(folder));
        }
        Ok(())
    }
}
