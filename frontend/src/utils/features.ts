/**
 * Whether the automated-content screens are shown at all: AI suggestions and
 * drafts, AI images and news cards, the editor assist panel, crawled sources
 * and the rewrite comparison, article voice and the reader's listen controls,
 * audio bulletins and e-paper radio.
 *
 * On: WowIndian shows them, and whether each feature actually runs is its
 * switch in CMS → Settings — every one of which starts off. Set false only
 * alongside the backend kill switch `AI_ENABLED=false`, to hide them too.
 */
export const AI_FEATURES = true;
