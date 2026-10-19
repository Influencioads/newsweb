/**
 * Whether the app shows its automated-content controls — article voice and
 * the listen controls, the global audio player, audio bulletins and e-paper
 * radio. On, matching the web app (`frontend/src/utils/features.ts`): each
 * still appears only when its switch in CMS → Settings is on, and all of
 * those start off. Set false only alongside the backend's `AI_ENABLED=false`.
 */
export const AI_FEATURES = true;
