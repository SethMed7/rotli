// The shape of `cli_models` (src-tauri/src/provider_models.rs): one model a
// connected client reported as selectable right now. Every field arrives
// already cleaned and bounded by Rust — ids match the argv id shape, efforts
// are within Rotli's vocabulary, labels carry no control characters.

export interface DiscoveredModel {
  id: string;
  label: string;
  /** Reasoning efforts the client offers for this model; empty = no control. */
  efforts: string[];
  /** Codex: the Fast service tier is available. */
  fastTier: boolean;
  vision: boolean;
  /** The client's own default entry. */
  isDefault: boolean;
}
