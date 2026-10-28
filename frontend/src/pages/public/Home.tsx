import { useQuery } from "@tanstack/react-query";

import { PageContainer } from "@/components/ui/Layout";
import { EmptyState, QueryState } from "@/components/ui/State";
import * as publicApi from "@/features/public/api";
import { ExploreWow } from "@/features/wow/ExploreWow";
import { HeroBanner } from "@/features/wow/HeroBanner";
import { FeaturedHeroes, NominateCta } from "@/features/wow/LocalHeroes";
import { StoryShotsStrip } from "@/features/wow/StoryShots";
import { WowRadio } from "@/features/wow/WowRadio";
import { useI18n } from "@/i18n";
import { useReaderPrefs } from "@/stores/readerPrefs";
import { useDocumentTitle } from "@/utils/motion";

import { HomeSkeleton } from "./home/HomeSkeleton";

/**
 * Reader home page — the blocks the "WOW Indian Telugu" concept pitch names
 * for the homepage (§2) and the website experience (§5):
 *
 *   Hero banner (rotating top stories, Read / Share)
 *   WOW Radio + Nominate Your Local Hero — the highlighted signature features
 *   Explore WOW (the WOW content categories)
 *   Story Shots (infographic shelf)
 *   Featured Local Heroes
 *
 * Header, search and the category menu live in the shell (PublicLayout); the
 * phone bottom navigation is BottomNav. The news-paper blocks this page used
 * to carry (dense front grid, e-paper promo, topics, polls, mandal block,
 * videos, per-section blocks, bulletin card) are not in the pitch, so they are
 * not rendered here; their own pages (/epaper, /videos, /local, /section/…)
 * are unchanged.
 */
export default function Home() {
  const edition = useReaderPrefs((state) => state.edition);
  const mandal = useReaderPrefs((state) => state.mandal);
  const { t } = useI18n();
  useDocumentTitle(t("page.home"));

  const home = useQuery({
    queryKey: ["public", "home", edition, mandal],
    queryFn: () => publicApi.fetchHome(edition, mandal),
  });

  return (
    <PageContainer
      width="site"
      className="space-y-9 py-6 md:space-y-12 md:py-8"
    >
      <QueryState
        query={home}
        skeleton={<HomeSkeleton />}
        isEmpty={(data) => !data.lead}
        empty={
          <EmptyState title={t("state.empty")} body={t("state.emptyEdition")} />
        }
        errorTitle={t("state.newsFailed")}
      >
        {(data) => (
          <>
            {data.lead ? (
              <HeroBanner stories={[data.lead, ...data.secondary]} />
            ) : null}

            {/* The two signature features, highlighted straight under the banner. */}
            <div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]">
              <WowRadio />
              <NominateCta />
            </div>

            <ExploreWow />

            <StoryShotsStrip />

            <FeaturedHeroes />
          </>
        )}
      </QueryState>
    </PageContainer>
  );
}
