import { lazy, Suspense, type ComponentType } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';

import { AppErrorBoundary, RouteFallback, ScrollToTop } from './components/app';
import AdminLayout from './layouts/AdminLayout';
import PublicLayout from './layouts/PublicLayout';
import { RequireAuth } from './routes/RequireAuth';

/** Lazy-load one named export from a multi-page module (one chunk per module). */
function named<M extends Record<K, ComponentType>, K extends string>(load: () => Promise<M>, key: K) {
  return lazy(() => load().then((m) => ({ default: m[key] })));
}

// ------------------------------------------------------------------ public
const Home = lazy(() => import('./pages/public/Home'));
const ArticlePage = lazy(() => import('./pages/public/ArticlePage'));
const SectionPage = lazy(() => import('./pages/public/SectionPage'));
const SearchPage = lazy(() => import('./pages/public/SearchPage'));
const TrendingPage = lazy(() => import('./pages/public/TrendingPage'));
const LocalPage = lazy(() => import('./pages/public/LocalPage'));
const NotificationsPage = lazy(() => import('./pages/public/NotificationsPage'));
const LoginPage = lazy(() => import('./pages/public/LoginPage'));
const ProfilePage = lazy(() => import('./pages/public/ProfilePage'));
const SubmitPage = lazy(() => import('./pages/public/SubmitPage'));
const EpaperPage = lazy(() => import('./pages/public/EpaperPage'));
const MyEpaperPage = lazy(() => import('./pages/public/MyEpaperPage'));
const BulletinPage = lazy(() => import('./pages/public/BulletinPage'));
const ContributorApplyPage = lazy(() => import('./pages/public/ContributorApplyPage'));
const LiveNewsPage = lazy(() => import('./pages/public/LiveNewsPage'));
const ShortNewsPage = lazy(() => import('./pages/public/ShortNewsPage'));
const VideosPage = lazy(() => import('./pages/public/VideosPage'));
const VideoDetailPage = lazy(() => import('./pages/public/VideoDetailPage'));
const PolicyPage = lazy(() => import('./pages/public/PolicyPage'));
const NotFoundPage = lazy(() => import('./pages/public/NotFoundPage'));

const accounts = () => import('./pages/public/AccountPages');
const RegisterPage = named(accounts, 'RegisterPage');
const ForgotPasswordPage = named(accounts, 'ForgotPasswordPage');
const ResetPasswordPage = named(accounts, 'ResetPasswordPage');
const VerifyEmailPage = named(accounts, 'VerifyEmailPage');

const library = () => import('./pages/public/LibraryPages');
const BookmarksPage = named(library, 'BookmarksPage');
const HistoryPage = named(library, 'HistoryPage');
const FollowingPage = named(library, 'FollowingPage');

const community = () => import('./pages/public/CommunityPages');
const TopicPage = named(community, 'TopicPage');
const PollPage = named(community, 'PollPage');

const discovery = () => import('./pages/public/DiscoveryPages');
const AuthorPage = named(discovery, 'AuthorPage');
const DistrictPage = named(discovery, 'DistrictPage');
const MandalPage = named(discovery, 'MandalPage');
const PhotoGalleryPage = named(discovery, 'PhotoGalleryPage');
const TagPage = named(discovery, 'TagPage');
const WebStoriesPage = named(discovery, 'WebStoriesPage');

// ------------------------------------------------------------------- admin
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const Articles = lazy(() => import('./pages/admin/Articles'));
const ArticleEditor = lazy(() => import('./pages/admin/ArticleEditor'));
const ReviewQueue = lazy(() => import('./pages/admin/ReviewQueue'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const BulletinsPage = lazy(() => import('./pages/admin/BulletinsPage'));
const KycPage = lazy(() => import('./pages/admin/KycPage'));
const VoicePage = lazy(() => import('./pages/admin/VoicePage'));
const AiSuggestionsPage = lazy(() => import('./pages/admin/AiSuggestions'));
const ContentSourcesPage = lazy(() => import('./pages/admin/ContentSources'));
const PendingArticlesPage = lazy(() => import('./pages/admin/PendingArticles'));

const management = () => import('./pages/admin/ManagementPages');
const AuditPage = named(management, 'AuditPage');
const MediaPage = named(management, 'MediaPage');
const ModerationPage = named(management, 'ModerationPage');
const RolesPage = named(management, 'RolesPage');
const TaxonomyPage = named(management, 'TaxonomyPage');
const UsersPage = named(management, 'UsersPage');

const adminDiscovery = () => import('./pages/admin/DiscoveryPages');
const AdsPage = named(adminDiscovery, 'AdsPage');
const AnalyticsPage = named(adminDiscovery, 'AnalyticsPage');
const HomepageSectionsPage = named(adminDiscovery, 'HomepageSectionsPage');
const NotificationsAdminPage = named(adminDiscovery, 'NotificationsAdminPage');
const PinsPage = named(adminDiscovery, 'PinsPage');
const TrendingAdminPage = named(adminDiscovery, 'TrendingAdminPage');
const VideosAdminPage = named(adminDiscovery, 'VideosAdminPage');

const publishing = () => import('./pages/admin/PublishingPages');
const AdminEpaperPage = named(publishing, 'AdminEpaperPage');
const AdminPollsPage = named(publishing, 'AdminPollsPage');

// ---------------------------------------------------------------------- QA
const SystemStatus = lazy(() => import('./pages/qa/SystemStatus'));
const TeluguRenderTest = lazy(() => import('./pages/qa/TeluguRenderTest'));

/**
 * Route table.
 *
 * A route appears here only once the screen behind it is real — the brief is
 * explicit that there must be no fake buttons and no dead links (§40, §50).
 *
 * Public URLs follow §4.5: /{category}/{slug}-{shortId}, where the slug is
 * transliterated English and shortId is a 6-char nanoid.
 *
 * Every page is a lazy chunk; only the two layouts and RequireAuth ship in the
 * entry bundle. The error boundary resets on navigation (resetKey) instead of
 * remounting the layouts, so header state and scroll survive a route change.
 * The Suspense below is the outer catch-all (admin login, QA pages); each
 * layout wraps its own <Outlet /> in Suspense so the chrome paints first.
 */
export default function App() {
  const { pathname } = useLocation();
  return (
    <>
      <ScrollToTop />
      <AppErrorBoundary resetKey={pathname}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* ---------------------------------------------------------- public */}
            <Route element={<PublicLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/section/:slug" element={<SectionPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/trending" element={<TrendingPage />} />
              <Route path="/local" element={<LocalPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/verify-email" element={<VerifyEmailPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/submit" element={<SubmitPage />} />
              <Route path="/bookmarks" element={<BookmarksPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/following" element={<FollowingPage />} />
              <Route path="/epaper" element={<EpaperPage />} />
              <Route path="/epaper/:date" element={<EpaperPage />} />
              <Route path="/epaper/:date/page/:page" element={<EpaperPage />} />
              <Route path="/my-epaper" element={<MyEpaperPage />} />
              <Route path="/my-epaper/edition/:personalId" element={<EpaperPage />} />
              <Route path="/my-epaper/edition/:personalId/page/:page" element={<EpaperPage />} />
              <Route path="/bulletin" element={<BulletinPage />} />
              <Route path="/contributor" element={<ContributorApplyPage />} />
              <Route path="/topic/:slug" element={<TopicPage />} />
              <Route path="/polls/:id" element={<PollPage />} />
              <Route path="/live" element={<LiveNewsPage />} />
              <Route path="/live-blog" element={<LiveNewsPage />} />
              <Route path="/district/:slug" element={<DistrictPage />} />
              <Route path="/mandal/:slug" element={<MandalPage />} />
              <Route path="/photos" element={<PhotoGalleryPage />} />
              <Route path="/videos" element={<VideosPage />} />
              <Route path="/videos/:id" element={<VideoDetailPage />} />
              <Route path="/short-news" element={<ShortNewsPage />} />
              <Route path="/web-stories" element={<WebStoriesPage />} />
              <Route path="/author/:slug" element={<AuthorPage />} />
              <Route path="/tag/:slug" element={<TagPage />} />

              {/* §12.5 compliance pages — required live at launch. */}
              <Route path="/about" element={<PolicyPage />} />
              <Route path="/contact" element={<PolicyPage />} />
              <Route path="/editorial-policy" element={<PolicyPage />} />
              <Route path="/corrections" element={<PolicyPage />} />
              <Route path="/grievance" element={<PolicyPage />} />
              <Route path="/privacy" element={<PolicyPage />} />
              <Route path="/terms" element={<PolicyPage />} />
              <Route path="/ai-disclosure" element={<PolicyPage />} />

              {/* Article. Must stay last among public routes: `/:category/:slugAndId`
                  is greedy and would otherwise swallow the static paths above. */}
              <Route path="/:category/:slugAndId" element={<ArticlePage />} />

              {/* 404 lives under the public layout so it keeps the site chrome. */}
              <Route path="*" element={<NotFoundPage />} />
            </Route>

            {/* ----------------------------------------------------------- admin */}
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route element={<RequireAuth />}>
              <Route element={<AdminLayout />}>
                <Route path="/admin/dashboard" element={<Dashboard />} />
                <Route path="/admin/articles" element={<Articles />} />
                <Route path="/admin/articles/new" element={<ArticleEditor />} />
                <Route path="/admin/articles/:id/edit" element={<ArticleEditor />} />
                <Route path="/admin/review" element={<ReviewQueue />} />
                <Route path="/admin/pending" element={<PendingArticlesPage />} />
                <Route path="/admin/ai" element={<AiSuggestionsPage />} />
                <Route path="/admin/sources" element={<ContentSourcesPage />} />
                <Route path="/admin/moderation" element={<ModerationPage />} />
                <Route path="/admin/pins" element={<PinsPage />} />
                <Route path="/admin/trending" element={<TrendingAdminPage />} />
                <Route path="/admin/analytics" element={<AnalyticsPage />} />
                <Route path="/admin/videos" element={<VideosAdminPage />} />
                <Route path="/admin/ads" element={<AdsPage />} />
                <Route path="/admin/homepage" element={<HomepageSectionsPage />} />
                <Route path="/admin/notifications" element={<NotificationsAdminPage />} />
                <Route path="/admin/taxonomy" element={<TaxonomyPage />} />
                <Route path="/admin/media" element={<MediaPage />} />
                <Route path="/admin/users" element={<UsersPage />} />
                <Route path="/admin/roles" element={<RolesPage />} />
                <Route path="/admin/audit" element={<AuditPage />} />
                <Route path="/admin/voice" element={<VoicePage />} />
                <Route path="/admin/bulletins" element={<BulletinsPage />} />
                <Route path="/admin/kyc" element={<KycPage />} />
                <Route path="/admin/settings" element={<SettingsPage />} />
                <Route path="/admin/epaper" element={<AdminEpaperPage />} />
                <Route path="/admin/polls" element={<AdminPollsPage />} />
              </Route>
            </Route>
            <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />

            {/* -------------------------------------------------------------- QA */}
            <Route path="/qa/status" element={<SystemStatus />} />
            <Route path="/qa/telugu-render" element={<TeluguRenderTest />} />
          </Routes>
        </Suspense>
      </AppErrorBoundary>
    </>
  );
}
