/**
 * WowIndian feature switch for automated content: AI suggestions and drafts,
 * AI images and news cards, the editor assist panel, crawled sources and the
 * rewrite comparison, article voice and the reader's listen controls, audio
 * bulletins and e-paper radio.
 *
 * Off. The screens are kept in the codebase but not routed, linked or
 * rendered, matching the backend's `AI_ENABLED=false`, which refuses their
 * endpoints. Turning them back on takes both: this flag and that env var.
 */
export const AI_FEATURES = false;
