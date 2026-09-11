import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

import { scrollToTop } from '@/utils/motion';

/**
 * Route-change scroll manager. Mount once inside the router:
 *
 *     <ScrollToTop />
 *
 * On PUSH/REPLACE: scrolls to `location.hash`'s target if any, else to the
 * top, then moves focus to `#main` (without scrolling) so keyboard and
 * screen-reader users land on the new page's content. POP (back/forward) is
 * left alone so the browser's scroll restoration works.
 */
export function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    if (navType === 'POP') return;
    const target = hash ? document.getElementById(hash.slice(1)) : null;
    if (target) target.scrollIntoView();
    else scrollToTop();

    const main = document.getElementById('main');
    if (main) {
      if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
      main.focus({ preventScroll: true });
    }
  }, [pathname, hash, navType]);

  return null;
}
