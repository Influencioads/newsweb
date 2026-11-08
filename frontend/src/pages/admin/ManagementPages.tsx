/**
 * Management pages barrel — App.tsx lazy-loads these by name. The
 * implementations live in ./management, one file per screen.
 */
export { AuditPage, RolesPage } from './management/ListPages';
export { UsersAdminPage as UsersPage } from './management/UsersAdminPage';
export { MediaPage } from './management/MediaPage';
export { ModerationPage } from './management/ModerationPage';
export { TaxonomyPage } from './management/TaxonomyPage';
