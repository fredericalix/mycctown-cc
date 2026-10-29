import { useEffect, useRef } from 'react';
import { useAssetStore } from '../stores/useAssetStore';
import { loadInitialAssets } from '../utils/assetLoader';
import { debug } from '../utils/debug';

// `green` matches `running` apps — the dominant case for a healthy org.
// Other colors (blue/red/yellow) are fetched on demand by HexTile when a
// building first needs them.
const INITIAL_COLOR = 'green';

export function useAssetLoader() {
  const isLoaded = useAssetStore((s) => s.isLoaded);
  const setProgress = useAssetStore((s) => s.setProgress);
  const setLoaded = useAssetStore((s) => s.setLoaded);
  const loadingRef = useRef(false);

  useEffect(() => {
    if (isLoaded || loadingRef.current) return;
    loadingRef.current = true;
    const startedAt = performance.now();
    debug.log('asset:initial', `start (color=${INITIAL_COLOR})`);

    loadInitialAssets(INITIAL_COLOR, (pct) => {
      setProgress(pct);
    }).then(({ cache, texture }) => {
      setLoaded(texture, cache, INITIAL_COLOR);
      debug.log(
        'asset:initial',
        `done in ${Math.round(performance.now() - startedAt)}ms (cache size=${cache.size})`,
      );
    });
  }, [isLoaded, setProgress, setLoaded]);
}
