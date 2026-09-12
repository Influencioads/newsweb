import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { ScrollView, Share, View } from 'react-native';

import { API_BASE, getAccessToken } from '@/api/client';
import type { EpaperEdition } from '@/api/epaper';
import { EpaperArchive } from '@/components/epaper/EpaperArchive';
import { EpaperRadio } from '@/components/epaper/EpaperRadio';
import { EpaperSheet, useEpaperZoom } from '@/components/epaper/EpaperSheet';
import { EpaperToolbar } from '@/components/epaper/EpaperToolbar';
import { EmptyState } from '@/components/Feedback';
import { useI18n } from '@/lib/i18n';
import { space } from '@/lib/theme';
import { makeStyles } from '@/lib/useTheme';
import { ScreenHeader } from '@/ui/ScreenHeader';
import { useToast } from '@/ui/Toast';

/**
 * EpaperReader — the published (and personal) edition, page by page.
 *
 * Split into four pieces in W12: the toolbar, the page sheet with its
 * pinch/pan/double-tap zoom, the radio playlist and the archive rail. What is
 * left here is what belongs to the edition as a whole — which page is open,
 * the share text, and the PDF download.
 */
const SITE = 'https://telugunews.influencioweb.com';

export function EpaperReader({
  edition,
  personal = false,
}: {
  edition: EpaperEdition;
  personal?: boolean;
}) {
  const styles = useStyles();
  const { t, isTelugu } = useI18n();
  const toast = useToast();
  const zoom = useEpaperZoom();
  const [index, setIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);

  const page = edition.pages[index];

  const go = (delta: number) => {
    setIndex((i) => Math.max(0, Math.min(edition.pages.length - 1, i + delta)));
    zoom.reset();
  };

  const share = () => {
    if (!page) return;
    const link = personal
      ? `${SITE}/my-epaper/edition/${edition.id}/page/${page.page_number}`
      : page.share_url;
    void Share.share({
      message: `${edition.title} – ${t('epaper.page')} ${page.page_number}\n${link}`,
    });
  };

  const pdf = `${API_BASE}${
    personal ? `/my-epaper/editions/${edition.id}/pdf` : `/epaper/${edition.edition_date}/pdf`
  }`;

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const directory = new Directory(Paths.cache, 'epaper');
      directory.create({ idempotent: true });
      const destination = new File(directory, `${edition.edition_date}-${edition.id}.pdf`);
      const token = getAccessToken();
      const file = await File.downloadFileAsync(pdf, destination, {
        idempotent: true,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: 'application/pdf',
          dialogTitle: edition.title,
        });
      }
    } catch {
      toast.error(
        isTelugu ? 'PDF డౌన్‌లోడ్ కాలేదు. మళ్లీ ప్రయత్నించండి.' : 'The E-Paper PDF could not be downloaded.',
      );
    } finally {
      setDownloading(false);
    }
  };

  // Both host routes hide the native header, so the empty branch has to bring
  // its own chrome — otherwise there is no way back out of the edition.
  if (!page) {
    return (
      <View style={styles.fill}>
        <ScreenHeader title={edition.title} />
        <EmptyState
          icon="newspaper"
          title={t('epaper.title')}
          body={isTelugu ? 'ఈ ఎడిషన్‌లో పేజీలు లేవు.' : 'This edition has no pages yet.'}
        />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <EpaperToolbar
        title={edition.title}
        pageNumber={page.page_number}
        pageCount={edition.page_count}
        canPrev={index > 0}
        canNext={index < edition.pages.length - 1}
        onPrev={() => go(-1)}
        onNext={() => go(1)}
        onZoomIn={zoom.zoomIn}
        onZoomOut={zoom.zoomOut}
        onShare={share}
        onDownload={() => void downloadPdf()}
        downloading={downloading}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <EpaperSheet
          page={page}
          dateLabel={edition.edition_date}
          zoom={zoom}
          onPageDelta={go}
        />
        {edition.audio_enabled && !personal ? <EpaperRadio date={edition.edition_date} /> : null}
        <EpaperArchive current={edition.id} />
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles(() => ({
  fill: { flex: 1 },
  scroll: { paddingBottom: space.xxl },
}));
