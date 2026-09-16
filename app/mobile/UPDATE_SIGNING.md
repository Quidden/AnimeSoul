[English](UPDATE_SIGNING.md) | [Русский](UPDATE_SIGNING.ru.md)

# Android updates without losing data

An APK updates an installed AnimeSoul release in place only when applicationId remains `com.animesoul.mobile`, versionCode increases and the APK uses the same permanent release signing key. The release build intentionally fails without that key. Debug has a separate app ID/key and is not the public update channel.

From `app/mobile/`, create the release key once:

```powershell
.\create_release_keystore.ps1
```

The script creates the Git-ignored `android/signing` directory with a PKCS12 key and random password. Keep two protected backups of the entire directory outside the repository. A lost key/password cannot be reconstructed.

For a build server, use:

```text
ANIMESOUL_RELEASE_KEYSTORE=C:\secure\animesoul-release.jks
ANIMESOUL_RELEASE_KEYSTORE_PASSWORD=...
ANIMESOUL_RELEASE_KEY_ALIAS=animesoul
ANIMESOUL_RELEASE_KEY_PASSWORD=...
```

Run assembleRelease with this key for every release and increase versionCode. An in-place update preserves private settings, progress, authorization and library index; visible MP4 files remain in Movies/AnimeSoul. Validate using `adb install -r <apk>` and existing data. Debug APKs update only matching debug builds. [Android guide](README.md).
