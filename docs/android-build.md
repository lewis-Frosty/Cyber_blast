# Android build — Cyber Blast

Everything in `android/` is committed and configured. What is **not** in this
repo, and must never be, is the signing key.

> **Why the `.aab` is not built in CI or by Claude Code**
> The build needs the Android Gradle Plugin and the Android SDK, both served
> only from `dl.google.com`. That host is blocked from the agent sandbox
> (403 at the proxy), so the bundle has to be produced on a machine with
> Android Studio. You need one anyway — the release checklist requires a test
> on a genuine low-end physical device, which an emulator does not satisfy.

---

## Locked decisions

| Decision | Value | Reversible? |
|---|---|---|
| Application ID | `com.frosty.cyberblast` | **No, once uploaded to Play.** It is the Play Store URL and the app's identity forever. |
| Wrapper | Capacitor | Yes, but a rewrite. |
| Orientation | Portrait, locked | Yes. |
| Play App Signing | **Enrol on the first release** | Effectively no. |

**Capacitor over a Trusted Web Activity**, deliberately: a TWA needs the site
reachable to run at all. Play requires the app to work offline, and this game
already queues runs offline and replays them later. Capacitor ships `dist/`
inside the APK and serves it locally, so a player with no signal still gets a
complete game.

---

## One-time setup

### 1. Install Android Studio
Includes the SDK, `sdkmanager`, and a JDK. Open it once and let it finish
downloading the SDK for API 36.

### 2. Generate the upload key

```bash
keytool -genkeypair -v \
  -keystore cyber-blast-upload.jks \
  -alias cyber-blast-upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

**Back this file up somewhere you will still have in five years.** Not only in
the repo folder — it is gitignored and one `rm -rf` from gone.

### 3. Point the build at it

```bash
cp android/keystore.properties.example android/keystore.properties
# then edit it: absolute path to the .jks, and the two passwords
```

`keystore.properties`, `*.jks` and `*.keystore` are all gitignored. Anyone
holding them can publish an update to your app under your name.

If the file is missing, `bundleRelease` fails with "signingConfig not found"
rather than quietly producing a debug-signed bundle that Play would reject on
upload. That is intentional — a loud failure at build time is much cheaper
than a confusing rejection at upload time.

---

## Building

```bash
npm run android:bundle
```

That runs the web build, copies `dist/` into the Android project, and produces:

```
android/app/build/outputs/bundle/release/app-release.aab
```

Upload that file to Play Console.

Other commands:

| Command | Does |
|---|---|
| `npm run android:sync` | Rebuild web + copy into the Android project. Run after **any** web change. |
| `npm run android:apk` | Debug APK for sideloading onto a test device. |
| `npm run android:open` | Open the project in Android Studio. |

---

## Before every upload

1. **Bump `versionCode`** in `android/app/build.gradle`. It is an integer and
   must increase on every upload; Play rejects a bundle whose code is less than
   or equal to one already uploaded. `versionName` is the human string
   (`0.9.0` now, `1.0.0` for production).
2. `npm run android:sync` — otherwise you ship the *previous* web build. This
   is the single easiest mistake to make here, because the Android project
   holds a **copy** of `dist/`, not a link to it.
3. Check the app still works with the network off.

---

## Play App Signing — do not skip

On the first release Play Console offers Play App Signing. **Take it.**

Google then holds the app signing key and you only ever handle the *upload*
key. If the upload key is lost, Play support can reset it. Without Play App
Signing, losing your key means **you can never update the app again** — the
listing is frozen and the only path is publishing a new app under a new ID and
losing every install and review.

The release checklist's own warning applies here too: once the app is published
to an open track the signing key is fixed.

---

## Known gaps

- [ ] Launcher icon and splash are Capacitor's defaults. Needs the real C mark
      at every mipmap density.
- [ ] Not yet run on a physical device — required by the checklist, and an
      emulator does not count.
- [ ] `minifyEnabled false`, so no ReTrace mapping file is produced. Correct
      for now: the app is one bundled JS file in a WebView, and R8 would shrink
      only the thin Java wrapper while making its crashes unreadable. Revisit
      only with a reason.
