// Aurora Archives - Performance Configuration
// Optimise le chargement et la fluidité globale

export const PERFORMANCE_CONFIG = {
  // Ressources critiques chargées immédiatement
  CRITICAL_RESOURCES: [
    '/css/aurora-base.css',
    '/css/aurore-theme-foundation.css',
    '/js/aurora-core.js',
  ],

  // Ressources à charger après l'interaction utilisateur
  DEFERRED_RESOURCES: [
    '/css/aurore-final-polish.css',
    '/css/aurora-ia.css',
    '/js/aurora-features.js',
  ],

  // Compression et optimisation des images
  IMAGE_OPTIMIZATION: {
    webp: true,
    responsive: true,
    lazyLoad: true,
    quality: 85,
  },

  // Stratégie de caching
  CACHE_STRATEGY: {
    version: 1,
    staticCache: 'aurora-static-v1',
    dynamicCache: 'aurora-dynamic-v1',
    maxAge: 86400, // 24h
  },

  // Monitoring et diagnostics
  METRICS: {
    enabled: true,
    trackCLS: true, // Cumulative Layout Shift
    trackFID: true, // First Input Delay
    trackLCP: true, // Largest Contentful Paint
  },

  // Optimisation DOM
  DOM_OPTIMIZATION: {
    virtuelScroll: true,
    lazyRender: true,
    debounceEvents: true,
    debounceDelay: 150,
  },

  // Réduction de bundle
  BUNDLE_CONFIG: {
    splitChunks: true,
    minifyJS: true,
    minifyCSS: true,
    removeDeadCode: true,
  },
};

// Amélioration dynamique des performances
export function optimizePageLoad() {
  // 1. Précharge les ressources critiques
  PERFORMANCE_CONFIG.CRITICAL_RESOURCES.forEach(url => {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = url.includes('.css') ? 'style' : 'script';
    link.href = url;
    document.head.appendChild(link);
  });

  // 2. Lazy-load ressources deferred
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => loadDeferredResources());
  } else {
    window.addEventListener('load', loadDeferredResources);
  }

  // 3. Optimise rendu critique
  optimizeCriticalRender();
}

function loadDeferredResources() {
  PERFORMANCE_CONFIG.DEFERRED_RESOURCES.forEach(url => {
    if (url.includes('.css')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      document.head.appendChild(link);
    } else {
      const script = document.createElement('script');
      script.defer = true;
      script.src = url;
      document.body.appendChild(script);
    }
  });
}

function optimizeCriticalRender() {
  // Réduit les reflows/repaints
  if (document.readyState === 'loading') {
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach(entry => {
        if (entry.duration > 50) {
          console.warn(`⚠️ Expensive operation: ${entry.name} (${entry.duration}ms)`);
        }
      });
    });
    observer.observe({ entryTypes: ['measure', 'navigation'] });
  }
}

// Service Worker Cache Strategy
export function setupCacheStrategy() {
  if ('caches' in window) {
    const strategy = PERFORMANCE_CONFIG.CACHE_STRATEGY;
    
    // Cache CSS et JS
    caches.open(strategy.staticCache).then(cache => {
      PERFORMANCE_CONFIG.CRITICAL_RESOURCES.forEach(url => {
        cache.add(url).catch(() => {
          console.log(`Failed to cache: ${url}`);
        });
      });
    });
  }
}

// Activation
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', optimizePageLoad);
} else {
  optimizePageLoad();
}

setupCacheStrategy();

export default PERFORMANCE_CONFIG;