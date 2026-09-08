import { Routes, Route, Navigate } from 'react-router-dom';

import AdminLayout from './layouts/AdminLayout';
import PublicLayout from './layouts/PublicLayout';
import AdminLogin from './pages/admin/AdminLogin';
import Dashboard from './pages/admin/Dashboard';
import Articles from './pages/admin/Articles';
import ArticleEditor from './pages/admin/ArticleEditor';
import ReviewQueue from './pages/admin/ReviewQueue';
import { AuditPage, MediaPage, ModerationPage, RolesPage, TaxonomyPage, UsersPage } from './pages/admin/ManagementPages';
import SettingsPage from './pages/admin/SettingsPage';
import AiSuggestionsPage from './pages/admin/AiSuggestions';
import ContentSourcesPage from './pages/admin/ContentSources';
import PendingArticlesPage from './pages/admin/PendingArticles';
import { AdsPage, AnalyticsPage, HomepageSectionsPage, NotificationsAdminPage, PinsPage, TrendingAdminPage, VideosAdminPage } from './pages/admin/DiscoveryPages';
import ArticlePage from './pages/public/ArticlePage';
import Home from './pages/public/Home';
import { BookmarksPage, FollowingPage, HistoryPage } from './pages/public/LibraryPages';
import LocalPage from './pages/public/LocalPage';
import LoginPage from './pages/public/LoginPage';
import { ForgotPasswordPage, RegisterPage, ResetPasswordPage, VerifyEmailPage } from './pages/public/AccountPages';
import NotificationsPage from './pages/public/NotificationsPage';
import PolicyPage from './pages/public/PolicyPage';
import ProfilePage from './pages/public/ProfilePage';
import TrendingPage from './pages/public/TrendingPage';
import SectionPage from './pages/public/SectionPage';
import SearchPage from './pages/public/SearchPage';
import EpaperPage from './pages/public/EpaperPage';
import LiveNewsPage from './pages/public/LiveNewsPage';
import { AuthorPage, DistrictPage, MandalPage, PhotoGalleryPage, TagPage, WebStoriesPage } from './pages/public/DiscoveryPages';
import ShortNewsPage from './pages/public/ShortNewsPage';
import SubmitPage from './pages/public/SubmitPage';
import VideosPage from './pages/public/VideosPage';
import VideoDetailPage from './pages/public/VideoDetailPage';
import SystemStatus from './pages/qa/SystemStatus';
import TeluguRenderTest from './pages/qa/TeluguRenderTest';
import { RequireAuth } from './routes/RequireAuth';

/**
 * Route table.
 *
 * A route appears here only once the screen behind it is real — the brief is
 * explicit that there must be no fake buttons and no dead links (§40, §50).
 *
 * Public URLs follow §4.5: /{category}/{slug}-{shortId}, where the slug is
 * transliterated English and shortId is a 6-char nanoid.
 */
export default function App() {
  return (
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
          <Route path="/admin/settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />

      {/* -------------------------------------------------------------- QA */}
      <Route path="/qa/status" element={<SystemStatus />} />
      <Route path="/qa/telugu-render" element={<TeluguRenderTest />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
