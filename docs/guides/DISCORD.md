[English](DISCORD.md) | [Русский](DISCORD.ru.md)

# Discord Rich Presence

An experimental, independent Windows integration, disabled by default. Its **Discord** settings are stored locally in `animesoul:discord-device-v1`, outside profiles and cloud saves.

## Setup

AnimeSoul includes the public Application ID `1554513653909422140`. Leave the Application ID field empty and enable activity sharing. Users do not need to register their own Discord application.

To configure a custom application:

1. Register it at https://discord.com/developers/applications.
2. Upload the logo to Rich Presence Art Assets with the key `animesoul`.
3. Enter its public Application ID in settings, or set `ANIMESOUL_DISCORD_APPLICATION_ID` before starting AnimeSoul.
4. Run Discord on the same PC and enable activity sharing in both applications.

No bot token, OAuth credentials or Discord password is required. The application name comes from its Discord registration. Settings control the anime title, season, episode, logo, line order, timer format and whether paused playback remains visible. In the library, on pause and in text-time mode, the built-in timer shows the current application session duration. The hidden timer mode sends no timer. Without a player, the optional idle presence says that the user is in the library.

The short status shows the anime title during playback regardless of card line order; it shows AnimeSoul when the title is hidden or no playback is active.

## Boundaries

- Browser requests use the local server. Routes validate the client address, Host and Origin; visitors to a shared server cannot control the server's Discord presence. Disable the module when deploying behind a proxy.
- Desktop uses the narrow `pywebview.api.discord_presence` bridge. This does not add a remote-server launch mode.
- Android does not expose these settings or publish presence.
- Playback position comes from the custom/offline player and Kodik events. Sources without timing events do not publish detailed playback activity.
- Updates are limited to once every 15 seconds and identical payloads are skipped. Session timing resets on disable or heartbeat loss, not on ordinary updates.
- Disabling clears presence immediately after the request. Heartbeat loss clears it after 45 seconds. Preferences survive restart, but playback is not restored into presence until a new player update arrives.
- Configuration and playback use local IPC to Discord; AnimeSoul does not need Discord account credentials.

## Troubleshooting

Check that the desktop Discord client is running, activity sharing is enabled, and the Application ID is valid. Logo assets may take time to become available. See the application debug journal for local connection errors.
