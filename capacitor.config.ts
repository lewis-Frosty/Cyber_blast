import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor wrapper for the Play Store build.
 *
 * The web build is the product; this packages it. Chosen over a Trusted Web
 * Activity because a TWA needs the site reachable to run at all, and Play
 * requires the app to work offline — Capacitor ships `dist/` inside the APK
 * and serves it locally, so a player with no signal still gets a full game
 * and an offline-queued run.
 */
const config: CapacitorConfig = {
  // PERMANENT once published. Chosen 2026-09-10; changing it after the first
  // upload is impossible — it is the Play Store URL and the app's identity.
  appId: 'com.frosty.cyberblast',
  appName: 'Cyber Blast',
  webDir: 'dist',

  android: {
    // The canvas is 480x820 and every screen is laid out for it. Landscape
    // would letterbox into wide dead bars rather than showing more board.
    // Also set in AndroidManifest.xml, which is what actually binds.
    allowMixedContent: false,
  },

  server: {
    // https rather than the http default: the game calls Supabase, and a page
    // served over http:// is a mixed-content origin that some WebViews refuse
    // to let make https requests. It also keeps localStorage — where the auth
    // session and the offline run queue live — on a stable origin across
    // updates, so an app update never silently signs the player out.
    androidScheme: 'https',
  },
};

export default config;
